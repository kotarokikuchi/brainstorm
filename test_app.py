import contextlib
from concurrent.futures import ThreadPoolExecutor
import http.client
import io
import json
import os
import socket
import sqlite3
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

import app
from app import Handler, load_env, make_server, watch
from store import Store, migrate_legacy

Handler.log_message = lambda *a: None  # silence the request log in tests


def raw_request(port, head, body=b""):
    """Hand-written request (headers urllib does not let us send). Returns (status, whole response)."""
    with socket.create_connection(("127.0.0.1", port), timeout=0.5) as s:
        s.sendall(f"{head}\nHost: 127.0.0.1\n\n".replace("\n", "\r\n").encode())
        data = b""
        try:
            # a server that refuses on the headers answers without waiting for the body (and with no unread body there is no RST)
            data = s.recv(65536)
        except TimeoutError:
            s.sendall(body)
        s.settimeout(5)
        s.shutdown(socket.SHUT_WR)
        while chunk := s.recv(65536):
            data += chunk
    return int(data.split()[1]), data


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        self.server = make_server(self.data, 0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def raw_get(self, path):
        with urllib.request.urlopen(self.base + path) as resp:
            return resp.status, dict(resp.headers), resp.read()

    def upload(self, map_id, name, data):
        return self.req("POST", f"/api/maps/{map_id}/files", raw=data, headers={"X-Filename": name})

    def make_map(self, map_id="abc"):
        self.req("PUT", f"/api/maps/{map_id}", {"version": 0, "root": {"text": "a", "children": []}})

    def req(self, method, path, body=None, raw=None, headers=None):
        data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
        r = urllib.request.Request(self.base + path, data=data, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(r) as resp:
                text = resp.read().decode()
                return resp.status, (json.loads(text) if text else None)
        except urllib.error.HTTPError as e:
            with e:
                text = e.read().decode()
            return e.code, (json.loads(text) if text.startswith("{") else None)

    def test_crud_roundtrip(self):
        body = {"version": 0, "layout": "map", "root": {"text": "Ção 🚀", "children": []}}
        self.assertEqual(self.req("PUT", "/api/maps/abc", body), (200, {"version": 1}))
        status, m = self.req("GET", "/api/maps/abc")
        self.assertEqual(status, 200)
        self.assertEqual(m["root"]["text"], "Ção 🚀")
        self.assertEqual(m["version"], 1)
        self.assertEqual(m["id"], "abc")
        status, lst = self.req("GET", "/api/maps")
        self.assertEqual(status, 200)
        self.assertEqual([(x["id"], x["title"]) for x in lst], [("abc", "Ção 🚀")])
        self.assertEqual(self.req("DELETE", "/api/maps/abc")[0], 204)
        self.assertEqual(self.req("GET", "/api/maps/abc")[0], 404)
        self.assertEqual(self.req("DELETE", "/api/maps/abc")[0], 404)

    def test_invalid_id_is_400(self):
        body = {"version": 0, "root": {"text": "x", "children": []}}
        self.assertEqual(self.req("GET", "/api/maps/..%2Fx")[0], 400)
        self.assertEqual(self.req("PUT", "/api/maps/ABC", body)[0], 400)
        self.assertEqual(self.req("GET", "/api/maps")[1], [])

    def test_invalid_json_is_400(self):
        self.assertEqual(self.req("PUT", "/api/maps/abc", raw=b"nope")[0], 400)
        self.assertEqual(self.req("PUT", "/api/maps/abc", {"version": 0})[0], 400)
        self.assertEqual(self.req("PUT", "/api/maps/abc", {"root": {}})[0], 400)

    def test_stale_version_is_409(self):
        body = {"version": 0, "root": {"text": "a", "children": []}}
        self.assertEqual(self.req("PUT", "/api/maps/abc", body), (200, {"version": 1}))
        self.assertEqual(self.req("PUT", "/api/maps/abc", body), (409, {"version": 1}))
        self.assertEqual(self.req("GET", "/api/maps/abc")[1]["version"], 1)
        body["version"] = 1
        self.assertEqual(self.req("PUT", "/api/maps/abc", body), (200, {"version": 2}))

    def test_storage_is_one_database_plus_attachments_folder(self):
        self.make_map()
        _, info = self.upload("abc", "foto.png", b"x")
        self.assertTrue((self.data / "brainstorm.db").is_file())
        self.assertEqual((self.data / "attachments" / "abc" / info["id"]).read_bytes(), b"x")
        self.assertEqual(sorted(p.name for p in self.data.iterdir() if not p.name.startswith("brainstorm.db")), ["attachments"])

    def test_foreign_host_is_403(self):
        # protects against DNS rebinding: only a local Host is accepted
        self.assertEqual(self.req("GET", "/api/maps", headers={"Host": "evil.com"})[0], 403)
        body = {"version": 0, "root": {"text": "a", "children": []}}
        self.assertEqual(self.req("PUT", "/api/maps/abc", body, headers={"Host": "evil.com:80"})[0], 403)
        self.assertEqual(self.req("GET", "/api/maps/abc")[0], 404)
        port = self.server.server_address[1]
        self.assertEqual(self.req("GET", "/api/maps", headers={"Host": f"localhost:{port}"})[0], 200)
        # different published port (Docker): the local name is what matters
        self.assertEqual(self.req("GET", "/api/maps", headers={"Host": "127.0.0.1:8080"})[0], 200)
        self.assertEqual(self.req("GET", "/api/maps", headers={"Host": "localhost"})[0], 200)
        for evil in ("localhost.evil.com:80", "127.0.0.1.evil.com", "localhost:80x", "evil.com:127.0.0.1"):
            self.assertEqual(self.req("GET", "/api/maps", headers={"Host": evil})[0], 403, evil)

    def test_upload_image_is_served_inline(self):
        self.make_map()
        png = b"\x89PNG\r\n\x1a\n" + b"x" * 100
        status, info = self.upload("abc", "foto.PNG", png)
        self.assertEqual(status, 201)
        self.assertRegex(info["id"], r"^[a-f0-9]{32}\.png$")
        self.assertEqual((info["name"], info["size"], info["type"]), ("foto.PNG", len(png), "image/png"))
        status, headers, body = self.raw_get(f"/api/maps/abc/files/{info['id']}")
        self.assertEqual((status, body), (200, png))
        self.assertEqual(headers["Content-Type"], "image/png")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertNotIn("Content-Disposition", headers)

    def test_non_image_files_always_download(self):
        self.make_map()
        for name in ("pagina.html", "desenho.svg", "notas.txt", "sem-extensao"):
            status, info = self.upload("abc", name, b"<script>alert(1)</script>")
            self.assertEqual(status, 201, name)
            status, headers, _ = self.raw_get(f"/api/maps/abc/files/{info['id']}")
            self.assertEqual(headers["Content-Type"], "application/octet-stream", name)
            self.assertEqual(headers["Content-Disposition"], "attachment", name)

    def test_file_ids_and_map_ids_are_validated(self):
        self.make_map()
        self.assertEqual(self.upload("../x", "a.png", b"x")[0], 400)
        self.assertEqual(self.req("GET", "/api/maps/abc/files/..%2F..%2Fapp.py")[0], 400)
        self.assertEqual(self.req("GET", "/api/maps/abc/files/" + "0" * 32 + ".png")[0], 404)

    def test_upload_too_large_is_413(self):
        self.make_map()
        status, _ = self.req("POST", "/api/maps/abc/files", raw=b"x",
                             headers={"X-Filename": "a.bin", "Content-Length": "20000001"})
        self.assertEqual(status, 413)

    def test_cross_site_upload_is_blocked(self):
        self.make_map()
        # without X-Filename it would be a "simple" POST (no preflight) coming from any site
        self.assertEqual(self.req("POST", "/api/maps/abc/files", raw=b"x", headers={"Content-Type": "text/plain"})[0], 400)
        evil = {"X-Filename": "a.png", "Origin": "http://evil.example"}
        self.assertEqual(self.req("POST", "/api/maps/abc/files", raw=b"x", headers=evil)[0], 403)
        self.assertEqual(self.req("PUT", "/api/maps/abc", {"version": 1, "root": {"text": "b", "children": []}},
                                  headers={"Origin": "http://evil.example"})[0], 403)
        self.assertEqual(self.req("DELETE", "/api/maps/abc", headers={"Origin": "http://evil.example"})[0], 403)
        port = self.server.server_address[1]
        ok = {"X-Filename": "a.png", "Origin": f"http://127.0.0.1:{port}"}
        self.assertEqual(self.req("POST", "/api/maps/abc/files", raw=b"x", headers=ok)[0], 201)
        # the origin must be the page's own address (another local port is also another site)
        other = {"X-Filename": "a.png", "Origin": "http://localhost:3000"}
        self.assertEqual(self.req("POST", "/api/maps/abc/files", raw=b"x", headers=other)[0], 403)
        docker = {"X-Filename": "a.png", "Host": "localhost:8080", "Origin": "http://localhost:8080"}
        self.assertEqual(self.req("POST", "/api/maps/abc/files", raw=b"x", headers=docker)[0], 201)
        self.assertFalse((self.data / "files" / "zzz").exists())
        self.assertEqual(self.upload("zzz", "a.png", b"x")[0], 404, "nonexistent map")

    def test_events_stream_announces_static_changes(self):
        static = self.data / "static"
        static.mkdir()
        (static / "app.js").write_text("1")
        self.server.static_dir = static
        # very short idle-connection timeout: the stream only writes and must not be cut off by it
        with mock.patch.object(Handler, "timeout", 1), urllib.request.urlopen(self.base + "/api/events", timeout=5) as resp:
            self.assertEqual(resp.headers["Content-Type"], "text/event-stream")
            self.assertEqual(resp.headers.get_all("Cache-Control"), ["no-store"], "a single value")
            first = resp.readline()
            self.assertTrue(first.startswith(b"data: "), first)
            resp.readline()  # blank line that ends the event
            time.sleep(1.5)
            st = (static / "app.js").stat()
            os.utime(static / "app.js", (st.st_atime, st.st_mtime + 5))
            second = resp.readline()
            self.assertTrue(second.startswith(b"data: "), second)
            self.assertNotEqual(first, second, "a change in static/ produces a new stamp")

    def put_text(self, version, text):
        return self.req("PUT", "/api/maps/abc", {"version": version, "root": {"text": text, "children": []}})

    def test_history_keeps_previous_versions(self):
        self.server.history_interval = 0
        for v in range(3):
            self.put_text(v, f"v{v}")
        status, items = self.req("GET", "/api/maps/abc/history")
        self.assertEqual(status, 200)
        self.assertEqual([i["version"] for i in items], [2, 1], "most recent first")
        self.assertEqual((items[0]["title"], items[0]["nodes"]), ("v1", 1))
        self.assertIn("saved", items[0])
        status, old = self.req("GET", "/api/maps/abc/history/1")
        self.assertEqual((status, old["root"]["text"]), (200, "v0"))
        self.assertEqual(self.req("GET", "/api/maps/abc/history/99")[0], 404)
        self.assertEqual(self.req("GET", "/api/maps/abc/history/..%2Fx")[0], 400)

    def test_history_is_throttled_and_capped(self):
        for v in range(3):  # default interval (2 min): only the first write keeps a copy
            self.put_text(v, f"v{v}")
        self.assertEqual(len(self.req("GET", "/api/maps/abc/history")[1]), 1)
        self.server.history_interval = 0
        for v in range(3, 60):
            self.put_text(v, f"v{v}")
        items = self.req("GET", "/api/maps/abc/history")[1]
        self.assertEqual(len(items), 50, "at most 50 versions")
        self.assertEqual(items[0]["version"], 59)

    def test_trash_keeps_history_until_permanent_delete(self):
        self.server.history_interval = 0
        self.put_text(0, "a")
        self.put_text(1, "b")
        self.req("DELETE", "/api/maps/abc")
        self.req("POST", "/api/trash/abc/restore", raw=b"")
        self.assertEqual(len(self.req("GET", "/api/maps/abc/history")[1]), 1, "history comes back too")
        self.req("DELETE", "/api/maps/abc")
        self.req("DELETE", "/api/trash/abc")
        self.assertEqual(self.req("GET", "/api/maps/abc/history")[1], [], "permanent delete takes the history with it")

    def test_delete_goes_to_trash_and_restores_everything(self):
        self.make_map()
        _, info = self.upload("abc", "foto.png", b"x")
        self.assertEqual(self.req("DELETE", "/api/maps/abc")[0], 204)
        self.assertEqual(self.req("GET", "/api/maps/abc")[0], 404)
        status, trash = self.req("GET", "/api/trash")
        self.assertEqual(status, 200)
        self.assertEqual([(t["id"], t["title"]) for t in trash], [("abc", "a")])
        self.assertIn("deleted", trash[0])
        self.assertEqual(self.req("POST", "/api/trash/abc/restore", raw=b""), (200, {"id": "abc"}))
        self.assertEqual(self.req("GET", "/api/maps/abc")[0], 200)
        self.assertEqual(self.raw_get(f"/api/maps/abc/files/{info['id']}")[0], 200, "files come back too")
        self.assertEqual(self.req("GET", "/api/trash")[1], [])

    def test_saving_trashed_document_and_permanent_delete(self):
        self.make_map()
        _, info = self.upload("abc", "foto.png", b"x")
        self.req("DELETE", "/api/maps/abc")
        # an old tab still saving a document deleted in another tab: must not recreate it behind the trash
        self.assertEqual(self.req("PUT", "/api/maps/abc", {"version": 1, "root": {"text": "b", "children": []}})[0], 410)
        self.assertEqual(self.req("POST", "/api/trash/zzz/restore", raw=b"")[0], 404)
        self.assertEqual(self.req("DELETE", "/api/trash/abc")[0], 204)
        self.assertEqual(self.req("GET", "/api/trash")[1], [])
        self.assertFalse((self.data / "attachments" / "abc").exists(), "attachments go too")
        self.assertEqual(self.req("DELETE", "/api/trash/abc")[0], 404)
        self.assertEqual(self.req("DELETE", "/api/trash/..%2Fx")[0], 400)
        self.make_map()  # the id is free again
        self.assertEqual(self.raw_get("/api/maps/abc")[0], 200)

    def test_duplicate_copies_map_and_files(self):
        self.make_map()
        _, info = self.upload("abc", "foto.png", b"x")
        status, body = self.req("POST", "/api/maps/abc/duplicate", raw=b"")
        self.assertEqual(status, 201)
        new = body["id"]
        self.assertRegex(new, r"^[a-z0-9-]{1,64}$")
        self.assertNotEqual(new, "abc")
        status, m = self.req("GET", f"/api/maps/{new}")
        self.assertEqual((status, m["root"]["text"], m["version"], m["id"]), (200, "a (copy)", 1, new))
        self.assertEqual(self.raw_get(f"/api/maps/{new}/files/{info['id']}")[0], 200, "files copied")
        self.assertEqual(self.req("POST", "/api/maps/zzz/duplicate", raw=b"")[0], 404)

    def test_duplicate_takes_the_title_suffix_from_the_client(self):
        self.make_map()
        def title(**kw):
            status, body = self.req("POST", "/api/maps/abc/duplicate", **kw)
            self.assertEqual(status, 201)
            return self.req("GET", f"/api/maps/{body['id']}")[1]["root"]["text"]
        self.assertEqual(title(body={"suffix": " (copy)"}), "a (copy)")
        self.assertEqual(title(body={"suffix": " (コピー)"}), "a (コピー)")
        for bad in ({"suffix": "x" * 41}, {"suffix": "a\nb"}, {"suffix": "a\x00"}, {"suffix": 5}, {"suffix": ""}, {}, [], "texto"):
            self.assertEqual(title(body=bad), "a (copy)", bad)
        self.assertEqual(title(raw=b"{nao e json"), "a (copy)")
        self.assertEqual(self.req("POST", "/api/maps/abc/duplicate", raw=b"x" * 10_001)[0], 413, "body is limited")
        self.req("PUT", "/api/maps/qd", self.board())
        _, dup = self.req("POST", "/api/maps/qd/duplicate", {"suffix": " (copia)"})
        self.assertEqual(self.req("GET", f"/api/maps/{dup['id']}")[1]["title"], "Quadro (copia)")

    def board(self, version=0, title="Quadro", elements=None):
        return {"version": version, "type": "board", "title": title, "elements": elements or []}

    def test_board_is_a_document_like_maps(self):
        self.assertEqual(self.req("PUT", "/api/maps/qd", self.board(elements=[{"id": "e1"}])), (200, {"version": 1}))
        status, doc = self.req("GET", "/api/maps/qd")
        self.assertEqual((status, doc["type"], doc["title"], len(doc["elements"])), (200, "board", "Quadro", 1))
        lst = {i["id"]: i for i in self.req("GET", "/api/maps")[1]}
        self.assertEqual((lst["qd"]["type"], lst["qd"]["title"]), ("board", "Quadro"))
        self.make_map()
        self.assertEqual(self.req("GET", "/api/maps")[1][0]["type"], "map")

    def test_board_validation(self):
        self.assertEqual(self.req("PUT", "/api/maps/qd", {"version": 0, "type": "board", "title": "x", "elements": {}})[0], 400)
        self.assertEqual(self.req("PUT", "/api/maps/qd", {"version": 0, "type": "board", "title": 3, "elements": []})[0], 400)
        self.assertEqual(self.req("PUT", "/api/maps/qd", {"version": 0, "type": "outro", "root": {}})[0], 400)

    def test_board_duplicate_history_and_trash(self):
        self.server.history_interval = 0
        self.req("PUT", "/api/maps/qd", self.board(0, "Quadro", [{"id": "a"}]))
        self.req("PUT", "/api/maps/qd", self.board(1, "Quadro 2", [{"id": "a"}, {"id": "b"}]))
        hist = self.req("GET", "/api/maps/qd/history")[1]
        self.assertEqual((hist[0]["title"], hist[0]["nodes"]), ("Quadro", 1))
        _, dup = self.req("POST", "/api/maps/qd/duplicate", raw=b"")
        self.assertEqual(self.req("GET", f"/api/maps/{dup['id']}")[1]["title"], "Quadro 2 (copy)")
        self.req("DELETE", "/api/maps/qd")
        self.assertEqual(self.req("GET", "/api/trash")[1][0]["title"], "Quadro 2")

    def skill(self, version=0, **kw):
        return {"version": version, "type": "skill", "title": "Revisão", "tags": ["code", "review"], "content": "# Oi", **kw}

    def test_skill_roundtrip(self):
        self.assertEqual(self.req("PUT", "/api/maps/sk", self.skill()), (200, {"version": 1}))
        status, doc = self.req("GET", "/api/maps/sk")
        self.assertEqual((status, doc["type"], doc["tags"], doc["content"]), (200, "skill", ["code", "review"], "# Oi"))
        lst = {i["id"]: i for i in self.req("GET", "/api/maps")[1]}
        self.assertEqual({k: lst["sk"][k] for k in ("type", "title", "tags")}, {"type": "skill", "title": "Revisão", "tags": ["code", "review"]})
        self.make_map()
        self.assertNotIn("tags", {i["id"]: i for i in self.req("GET", "/api/maps")[1]}["abc"])

    def test_skill_invalid(self):
        bad = [{"tags": "a"}, {"tags": [""]}, {"tags": ["x" * 41]}, {"tags": [" a"]}, {"tags": [str(i) for i in range(31)]},
               {"tags": ["a", "a"]}, {"content": 5}, {"title": "t" * 201}]
        for kw in bad:
            self.assertEqual(self.req("PUT", "/api/maps/sk", self.skill(**kw))[0], 400, kw)

    def test_duplicate_skill(self):
        self.req("PUT", "/api/maps/sk", self.skill())
        _, dup = self.req("POST", "/api/maps/sk/duplicate", raw=b"")
        self.assertEqual(self.req("GET", f"/api/maps/{dup['id']}")[1]["title"], "Revisão (copy)")

    def test_named_version(self):
        self.server.history_interval = 0
        self.put_text(0, "a")
        self.put_text(1, "b")
        self.assertEqual(self.req("POST", "/api/maps/abc/history", {"label": "v1"}), (201, {"version": 2}))
        self.assertEqual(self.req("GET", "/api/maps/abc/history")[1][0]["label"], "v1")
        self.put_text(2, "c")
        hist = self.req("GET", "/api/maps/abc/history")[1]
        self.assertEqual([(h["version"], h["label"]) for h in hist], [(2, "v1"), (1, None)])
        self.assertEqual(self.req("POST", "/api/maps/abc/history", raw=b"")[0], 201, "no label")

    def test_history_post_keeps_label_and_validates_body(self):
        self.server.history_interval = 0
        self.put_text(0, "a")
        self.req("POST", "/api/maps/abc/history", {"label": "v1"})
        self.assertEqual(self.req("POST", "/api/maps/abc/history", {})[0], 201)
        self.assertEqual(self.req("GET", "/api/maps/abc/history")[1][0]["label"], "v1", "no label does not erase the existing one")
        for raw in (b"{oops", b"[1]", b'"x"', b"null"):
            self.assertEqual(self.req("POST", "/api/maps/abc/history", raw=raw)[0], 400, raw)
        self.put_text(1, "b")
        self.req("POST", "/api/maps/abc/history", {"label": "   "})
        self.assertIsNone(self.req("GET", "/api/maps/abc/history")[1][0]["label"], "only spaces = no label")

    def test_named_version_survives_prune(self):
        self.server.history_interval = 0
        self.put_text(0, "a")
        self.req("POST", "/api/maps/abc/history", {"label": "keep"})
        with mock.patch("store.HISTORY_MAX", 3):
            for v in range(1, 7):
                self.put_text(v, f"v{v}")
        hist = self.req("GET", "/api/maps/abc/history")[1]
        self.assertEqual(len([h for h in hist if h["label"] is None]), 3)
        self.assertEqual([h["version"] for h in hist if h["label"]], [1])

    def test_label_validation(self):
        self.make_map()
        self.assertEqual(self.req("POST", "/api/maps/abc/history", {"label": "x" * 101})[0], 400)
        self.assertEqual(self.req("POST", "/api/maps/abc/history", {"label": 5})[0], 400)
        self.assertEqual(self.req("POST", "/api/maps/abc/history", {"label": "a\nb"})[0], 400)
        self.assertEqual(self.req("POST", "/api/maps/nope/history", {"label": "x"})[0], 404)

    def test_skill_history_counts_characters(self):
        self.server.history_interval = 0
        self.req("PUT", "/api/maps/sk", self.skill())
        self.req("PUT", "/api/maps/sk", self.skill(1, content="abc"))
        self.assertEqual(self.req("GET", "/api/maps/sk/history")[1][0]["nodes"], 4)

    def test_label_column_migration(self):
        db = self.data / "old.db"
        with contextlib.closing(sqlite3.connect(db)) as c, c:
            c.executescript("CREATE TABLE history (doc_id TEXT NOT NULL, version INTEGER NOT NULL, saved REAL NOT NULL, "
                            "body TEXT NOT NULL, PRIMARY KEY (doc_id, version));")
        store = Store(db, self.data / "f")
        store.put("abc", {"version": 0, "root": {"text": "a", "children": []}}, 0)
        self.assertEqual(store.label_version("abc", "x"), 1)
        self.assertIsNone(store.label_version("nope", "x"))
        self.assertEqual(store.history("abc")[0]["label"], "x")

    def test_schema_version_and_settings(self):
        store = self.server.store
        with store._db() as db:
            self.assertEqual(db.execute("SELECT value FROM meta WHERE key = 'schema'").fetchone()[0], "1")
            db.execute("UPDATE meta SET value = '7' WHERE key = 'schema'")
        Store(store.db_path, store.files_dir)  # reopening does not lower the version
        with store._db() as db:
            self.assertEqual(db.execute("SELECT value FROM meta WHERE key = 'schema'").fetchone()[0], "7")
        self.assertIsNone(store.setting("x"))
        store.set_setting("x", {"a": "ç"})
        self.assertEqual(store.setting("x"), {"a": "ç"})
        store.set_setting("x", None)
        self.assertIsNone(store.setting("x"))

    # ---- Settings: LLM keys ----
    def test_llm_key_never_comes_back(self):
        status, items = self.req("GET", "/api/settings/llm")
        self.assertEqual(status, 200)
        self.assertEqual([p["id"] for p in items], ["anthropic", "openai", "gemini", "deepseek", "openrouter", "custom"])
        self.assertFalse(any(p["configured"] for p in items))
        key = "sk-ant-segredo-a9F2"
        status, saved = self.req("PUT", "/api/settings/llm/anthropic", {"key": key, "model": "claude-x"})
        self.assertEqual(status, 200)
        self.assertEqual(saved, {"id": "anthropic", "configured": True, "keyHint": "…a9F2", "model": "claude-x", "baseUrl": "", "default": False})
        _, _, raw = self.raw_get("/api/settings/llm")
        self.assertNotIn(b"segredo", raw)
        self.assertNotIn(b"segredo", self.raw_get("/")[2])
        # without "key": keep the current key and only change the model
        self.assertEqual(self.req("PUT", "/api/settings/llm/anthropic", {"model": "outro"})[1]["keyHint"], "…a9F2")
        self.assertEqual(self.server.store.setting("llm")["providers"]["anthropic"]["key"], key)
        self.assertEqual(self.req("DELETE", "/api/settings/llm/anthropic")[0], 204)
        self.assertFalse(self.req("GET", "/api/settings/llm")[1][0]["configured"])

    def test_llm_default_provider(self):
        defaults = lambda: [p["id"] for p in self.req("GET", "/api/settings/llm")[1] if p["default"]]
        self.assertEqual(defaults(), [])
        # without a key it cannot be the default
        self.assertEqual(self.req("PUT", "/api/settings/llm/openai", {"default": True})[0], 400)
        self.req("PUT", "/api/settings/llm/openai", {"key": "sk-openai-1111"})
        self.req("PUT", "/api/settings/llm/deepseek", {"key": "sk-deepseek-2222"})
        status, saved = self.req("PUT", "/api/settings/llm/openai", {"default": True})
        self.assertEqual((status, saved["default"]), (200, True))
        self.assertEqual(defaults(), ["openai"])
        self.req("PUT", "/api/settings/llm/deepseek", {"default": True})
        self.assertEqual(defaults(), ["deepseek"])  # a single default
        self.assertEqual(self.req("PUT", "/api/settings/llm/openai", {"default": False})[0], 400)
        # removing the default's key: no default is left
        self.req("DELETE", "/api/settings/llm/deepseek")
        self.assertEqual(defaults(), [])

    def test_llm_validation(self):
        for body in ({"key": ""}, {"key": "x" * 501}, {"key": 5}, {"key": "a\nb"}, {"model": "m" * 201},
                     {"baseUrl": "ftp://x"}, {"baseUrl": "javascript:alert(1)"}, {"baseUrl": "http://" + "x" * 500}, []):
            self.assertEqual(self.req("PUT", "/api/settings/llm/custom", body)[0], 400, body)
        self.assertEqual(self.req("PUT", "/api/settings/llm/nope", {"key": "k"})[0], 404)
        self.assertEqual(self.req("DELETE", "/api/settings/llm/nope")[0], 404)
        self.assertEqual(self.req("PUT", "/api/settings/llm/custom", {"key": "k" * 20, "baseUrl": "http://localhost:11434/v1"})[1]["baseUrl"],
                         "http://localhost:11434/v1")
        self.assertEqual(self.req("PUT", "/api/settings/llm/openai", {"key": "short"})[1]["keyHint"], "…", "a short key does not show its tail")

    # ---- Settings: backup ----
    BACKUP = {"endpoint": "https://s3.eu-central-2.wasabisys.com", "region": "eu-central-2", "bucket": "meu-bucket",
              "prefix": "brainstorm/", "accessKey": "AKIDEXEMPLO", "secretKey": "segredo-do-storage-x9Z1",
              "interval": 24, "keep": 14, "enabled": True}

    def test_backup_settings_never_return_the_secret(self):
        status, view = self.req("GET", "/api/settings/backup")
        self.assertEqual((status, view["configured"], view["prefix"], view["interval"], view["keep"]), (200, False, "brainstorm/", 24, 14))
        status, view = self.req("PUT", "/api/settings/backup", self.BACKUP)
        self.assertEqual(status, 200)
        self.assertNotIn("secretKey", view)
        self.assertEqual((view["secretHint"], view["configured"], view["accessKey"]), ("…x9Z1", True, "AKIDEXEMPLO"))
        self.assertNotIn(b"segredo-do-storage", self.raw_get("/api/settings/backup")[2])
        keep = {k: v for k, v in self.BACKUP.items() if k != "secretKey"}
        self.assertEqual(self.req("PUT", "/api/settings/backup", {**keep, "keep": 3})[1]["secretHint"], "…x9Z1", "without secretKey: keeps it")
        self.assertEqual(self.server.backup.config()["secretKey"], "segredo-do-storage-x9Z1")
        self.assertEqual(self.req("PUT", "/api/settings/backup", {**self.BACKUP, "endpoint": "http://s3.wasabisys.com"})[0], 400, "https only")
        self.assertEqual(self.req("PUT", "/api/settings/backup", raw=b"nope")[0], 400)

    def test_backup_without_storage_is_400(self):
        self.assertEqual(self.req("POST", "/api/backup/run")[0], 400)
        self.assertEqual(self.req("GET", "/api/backup/list")[0], 400)
        self.assertEqual(self.req("GET", "/api/backup/run")[0], 404)

    def test_restore_name_must_be_one_of_our_backups(self):
        self.server.store.set_setting("backup", self.BACKUP)
        for name in ("../brainstorm-2026-01-01-000000.tar.gz", "brainstorm-2026-01-01-000000.tar.gz/../x", "x/brainstorm-2026-01-01-000000.tar.gz",
                     "brainstorm-2026-01-01-0000.tar.gz", "brainstorm-2026-01-01-000000.tar.gz\n", 5, None):
            self.assertEqual(self.req("POST", "/api/backup/restore", {"name": name})[0], 400, name)
        self.assertEqual(self.req("POST", "/api/backup/restore", raw=b"[]")[0], 400)

    def test_static_files_are_revalidated(self):
        # without this the browser reuses stale JS (heuristic cache) after an update
        status, headers, _ = self.raw_get("/app.js")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Cache-Control"), "no-cache")
        self.assertIn("Last-Modified", headers)

    def test_deleting_map_removes_its_files(self):
        self.req("PUT", "/api/maps/abc", {"version": 0, "root": {"text": "a", "children": []}})
        _, info = self.upload("abc", "foto.png", b"x")
        self.assertEqual(self.req("DELETE", "/api/maps/abc")[0], 204)
        self.assertEqual(self.req("GET", f"/api/maps/abc/files/{info['id']}")[0], 404, "a document in the trash does not serve files")

    def test_body_too_large_is_413(self):
        status, _ = self.req("PUT", "/api/maps/abc", raw=b"x", headers={"Content-Length": "5000001"})
        self.assertEqual(status, 413)

    def test_folders_roundtrip_version_and_validation(self):
        self.assertEqual(self.req("GET", "/api/folders"), (200, {"version": 0, "folders": [], "place": {}}))
        tree = {"version": 0, "folders": [{"id": "f1", "name": "Trabalho", "parent": None},
                                          {"id": "f2", "name": "Clientes", "parent": "f1"}], "place": {"abc": "f2"}}
        status, saved = self.req("PUT", "/api/folders", tree)
        self.assertEqual((status, saved["version"]), (200, 1))
        self.assertEqual(self.req("GET", "/api/folders")[1]["place"], {"abc": "f2"})
        self.assertEqual(self.req("PUT", "/api/folders", tree)[0], 409, "stale version")
        bad = [
            {**tree, "version": 1, "folders": [{"id": "f1", "name": "  ", "parent": None}], "place": {}},
            {**tree, "version": 1, "folders": [{"id": "f1", "name": "a", "parent": "zz"}], "place": {}},
            {**tree, "version": 1, "folders": [{"id": "f1", "name": "a", "parent": "f2"}, {"id": "f2", "name": "b", "parent": "f1"}], "place": {}},
            {**tree, "version": 1, "place": {"abc": "nao-existe"}},
            {**tree, "version": 1, "folders": [{"id": "../x", "name": "a", "parent": None}], "place": {}},
        ]
        for b in bad:
            self.assertEqual(self.req("PUT", "/api/folders", b)[0], 400, b)
        self.assertEqual([m["id"] for m in self.req("GET", "/api/maps")[1]], [], "folders do not show up as documents")


    def test_content_length_must_be_a_plain_number(self):
        self.make_map()
        port = self.server.server_address[1]
        doc = json.dumps({"version": 1, "root": {"text": "b", "children": []}}).encode()
        tree = json.dumps({"version": 0, "folders": [], "place": {}}).encode()
        for bad in ("-1", "abc", "+5", "1_0", "²"):  # int() would accept "-1", "+5" and "1_0"
            for head, body in ((f"PUT /api/maps/abc HTTP/1.1\nContent-Length: {bad}", doc),
                               (f"PUT /api/folders HTTP/1.1\nContent-Length: {bad}", tree),
                               (f"POST /api/maps/abc/files HTTP/1.1\nX-Filename: a.bin\nContent-Length: {bad}", b"x" * 10)):
                self.assertEqual(raw_request(port, head, body)[0], 400, head)
        self.assertEqual(raw_request(port, "PUT /api/maps/abc HTTP/1.1\nContent-Length: " + "9" * 5000, doc)[0], 413)
        self.assertEqual(self.req("GET", "/api/maps/abc")[1]["version"], 1, "nothing was saved")
        self.assertEqual(list((self.data / "attachments").iterdir()), [])

    def test_idle_connection_is_closed(self):
        self.assertTrue(Handler.timeout and Handler.timeout <= 60, "a stalled connection does not hold a thread forever")
        with mock.patch.object(Handler, "timeout", 0.2), socket.create_connection(self.server.server_address, timeout=5) as s:
            self.assertEqual(s.recv(1), b"", "the server closes a connection that sends nothing")

    def test_security_headers(self):
        _, headers, body = self.raw_get("/login.html")
        self.assertEqual((headers["X-Content-Type-Options"], headers["X-Frame-Options"], headers["Referrer-Policy"]),
                         ("nosniff", "DENY", "no-referrer"))
        csp = headers["Content-Security-Policy"]
        for part in ("default-src 'self'", "script-src 'self';", "object-src 'none'", "frame-ancestors 'none'"):
            self.assertIn(part, csp)
        self.assertNotIn(b"<script>", body, "script-src 'self': no scripts inside the page")
        self.assertEqual(self.raw_get("/login.js")[0], 200)
        self.assertEqual(headers["Server"].strip(), "Brainstorm", "no Python version")
        _, headers, _ = self.raw_get("/api/maps")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual((headers["X-Content-Type-Options"], headers["X-Frame-Options"]), ("nosniff", "DENY"))
        self.make_map()
        _, info = self.upload("abc", "foto.png", b"x")
        _, headers, _ = self.raw_get(f"/api/maps/abc/files/{info['id']}")
        self.assertEqual(headers["Cache-Control"], "private, max-age=3600", "attachment: browser-only cache")
        r = urllib.request.Request(self.base + f"/api/maps/abc/files/{'0' * 32}.png")
        with self.assertRaises(urllib.error.HTTPError) as missing:
            urllib.request.urlopen(r)
        self.assertEqual((missing.exception.code, missing.exception.headers["Cache-Control"]), (404, "no-store"), "errors are not cached")
        missing.exception.close()

    def test_no_directory_listing(self):
        self.assertEqual(self.req("GET", "/fonts/")[0], 404)

    def test_input_validation(self):
        self.assertEqual(self.req("PUT", "/api/maps/abc", {"version": 0, "root": {"text": ["x"]}})[0], 400, "the title is text")
        deep = b"[" * 200_000  # RecursionError in json.loads
        self.assertEqual(self.req("PUT", "/api/maps/abc", raw=deep)[0], 400)
        self.assertEqual(self.req("PUT", "/api/folders", raw=deep)[0], 400)
        self.make_map()
        for version in ("9" * 30, "%C2%B2", "1%0A"):  # overflows the SQLite integer; "²".isdigit() is True
            self.assertEqual(self.req("GET", f"/api/maps/abc/history/{version}")[0], 400, version)

    def test_nan_and_lone_surrogates_are_400(self):
        # NaN/Infinity are not JSON (the browser could not open the document); a lone surrogate does not encode to UTF-8
        lone = b'"\\ud800"'
        for raw in (b'{"version": 0, "root": {"text": "a", "children": [], "x": NaN}}',
                    b'{"version": 0, "root": {"text": "a", "children": [], "x": -Infinity}}',
                    b'{"version": 0, "root": {"text": "a", "children": [], "x": 1e400}}',
                    b'{"version": 0, "root": {"text": ' + lone + b', "children": []}}'):
            self.assertEqual(self.req("PUT", "/api/maps/abc", raw=raw)[0], 400, raw)
        folders = b'{"version": 0, "folders": [{"id": "f1", "name": ' + lone + b', "parent": null}], "place": {}}'
        self.assertEqual(self.req("PUT", "/api/folders", raw=folders)[0], 400)
        self.assertEqual(self.req("PUT", "/api/settings/llm/openai", raw=b'{"key": "abc", "model": NaN}')[0], 400)
        self.assertEqual(self.req("GET", "/api/maps")[1], [], "nothing saved")
        ok = b'{"version": 0, "root": {"text": "\\ud83d\\ude80", "children": []}}'  # valid pair (emoji)
        self.assertEqual(self.req("PUT", "/api/maps/abc", raw=ok)[0], 200)
        self.assertEqual(self.req("GET", "/api/maps/abc")[1]["root"]["text"], "\U0001f680")

    def test_folder_validation_limits(self):
        folder = lambda i, parent: {"id": f"f{i}", "name": "p", "parent": parent}
        tree = lambda folders, place=None: {"version": 0, "folders": folders, "place": place or {}}
        bad = [
            tree([folder(i, None) for i in range(2001)]),
            tree([folder(1, None)], {"abc": []}),  # a value that cannot even be a key: it used to raise TypeError
            tree([{"id": "f1\n", "name": "p", "parent": None}]),
            tree([folder(i, f"f{i + 1}") for i in range(1999)] + [folder(1999, "f0")]),  # long cycle
        ]
        for b in bad:
            self.assertEqual(self.req("PUT", "/api/folders", b)[0], 400, str(b)[:80])
        chain = tree([folder(i, f"f{i + 1}") for i in range(1999)] + [folder(1999, None)], {"abc": "f0"})
        started = time.monotonic()
        self.assertEqual(self.req("PUT", "/api/folders", chain)[0], 200, "2000 folders nested one inside the other")
        self.assertLess(time.monotonic() - started, 1, "linear cycle check")

    def test_document_id_always_comes_from_the_row(self):
        # a restored backup may carry another id in the body; the page builds its routes from doc.id
        self.server.history_interval = 0
        self.put_text(0, "a")
        self.put_text(1, "b")
        with self.server.store._db() as db:
            for table in ("docs", "history"):
                db.execute(f"UPDATE {table} SET body = json_set(body, '$.id', '../settings/backup')")
        self.assertEqual(self.req("GET", "/api/maps/abc")[1]["id"], "abc")
        self.assertEqual(self.req("GET", "/api/maps/abc/history/1")[1]["id"], "abc")

    def test_history_survives_a_malformed_version(self):
        self.server.history_interval = 0
        self.req("PUT", "/api/maps/abc", {"version": 0, "root": {"text": "a", "children": ["x"]}})
        self.assertEqual(self.put_text(1, "b")[0], 200)
        self.assertEqual(self.put_text(2, "c")[0], 200)
        status, hist = self.req("GET", "/api/maps/abc/history")
        self.assertEqual(status, 200)
        self.assertEqual([(h["version"], h["title"], h["nodes"]) for h in hist], [(2, "b", 1), (1, "", 0)])


class AuthTest(unittest.TestCase):
    """With BRAINSTORM_USER/BRAINSTORM_PASSWORD: everything requires login except the login page."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        self.start()

    def start(self):
        self.server = make_server(self.data, 0, auth=("ana", "s3gredo ç"))
        self.server.login_delay = 0
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def stop(self):
        self.server.shutdown()
        self.server.server_close()

    def tearDown(self):
        self.stop()
        self.tmp.cleanup()

    def call(self, method, path, body=None, cookie=None, headers=None):
        h = {**(headers or {}), **({"Cookie": cookie} if cookie else {})}
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        opener = urllib.request.build_opener(NoRedirect)
        try:
            with opener.open(req) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            with e:
                return e.code, dict(e.headers), e.read()

    def login(self, user="ana", password="s3gredo ç"):
        return self.call("POST", "/api/login", {"user": user, "password": password})

    def cookie(self):
        status, headers, _ = self.login()
        self.assertEqual(status, 200)
        return headers["Set-Cookie"].split(";")[0]

    def test_everything_needs_login_except_the_login_page(self):
        self.assertEqual(self.call("GET", "/api/maps")[0], 401)
        self.assertEqual(self.call("PUT", "/api/maps/abc", {"version": 0, "root": {"text": "a", "children": []}})[0], 401)
        status, headers, _ = self.call("GET", "/")
        self.assertEqual((status, headers.get("Location")), (302, "/login.html"), "opening the app redirects to login")
        self.assertEqual(self.call("GET", "/app.js")[0], 302)
        status, headers, _ = self.call("GET", f"/api/maps/abc/files/{'0' * 32}.png")
        self.assertEqual((status, headers["Cache-Control"]), (401, "no-store"), "an attachment 401 is not cached")
        for public in ("/login.html", "/style.css", "/fonts/kalam-latin-400-normal.woff2"):
            self.assertEqual(self.call("GET", public)[0], 200, public)

    def test_login_page_texts_are_public(self):
        # the login page loads i18n.js and the dictionaries without a session; everything else stays closed
        for public in ("/i18n.js", "/locales/pt-BR.js"):
            self.assertEqual(self.call("GET", public)[0], 200, public)
        self.assertEqual(self.call("GET", "/locales/nao-existe.js")[0], 404, "language without a dictionary: 404, not the login")
        for path in ("/locales/../app.js", "/locales/%2e%2e/app.js", "/locales/..%2fapp.js", "//locales/../index.html",
                     "/i18n.js/../app.js", "/locales/./../app.js", "/locales//../app.js", "/locales"):
            self.assertEqual(self.call("GET", path)[0], 302, path)
            self.assertEqual(self.call("HEAD", path)[0], 302, path)

    def test_login_sets_a_safe_cookie_and_unlocks_the_app(self):
        status, headers, _ = self.login()
        self.assertEqual(status, 200)
        cookie = headers["Set-Cookie"]
        for flag in ("HttpOnly", "SameSite=Strict", "Path=/", "Max-Age="):
            self.assertIn(flag, cookie)
        c = cookie.split(";")[0]
        self.assertEqual(self.call("GET", "/api/maps", cookie=c)[0], 200)
        self.assertEqual(self.call("GET", "/", cookie=c)[0], 200)
        self.assertEqual(json.loads(self.call("GET", "/api/session", cookie=c)[2]), {"auth": True})
        self.assertEqual(self.call("GET", "/api/maps", cookie="brainstorm_session=inventado")[0], 401)

    def test_wrong_credentials_and_lockout(self):
        self.assertEqual(self.login(password="errada")[0], 401)
        self.assertEqual(self.login(user="outro")[0], 401)
        self.assertEqual(self.call("POST", "/api/login", {"user": 1, "password": None})[0], 401)
        self.assertEqual(self.call("POST", "/api/login", None)[0], 401)
        for _ in range(6):
            self.login(password="errada")
        status, headers, _ = self.login()
        self.assertEqual(status, 429, "10 failures in 10 min lock out even the right password")
        self.assertIn("Retry-After", headers)

    def test_logout_ends_the_session(self):
        c = self.cookie()
        status, headers, _ = self.call("POST", "/api/logout", cookie=c)
        self.assertEqual(status, 204)
        self.assertIn("Max-Age=0", headers["Set-Cookie"])
        self.assertEqual(headers["Clear-Site-Data"], '"cache"', "Log out clears the cached images")
        self.assertEqual(self.call("GET", "/api/maps", cookie=c)[0], 401)

    def test_session_survives_server_restart(self):
        c = self.cookie()
        self.stop()
        self.start()
        self.assertEqual(self.call("GET", "/api/maps", cookie=c)[0], 200)

    def test_changing_the_password_ends_all_sessions(self):
        c = self.cookie()
        self.stop()
        self.server = make_server(self.data, 0, auth=("ana", "senha nova"))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.assertEqual(self.call("GET", "/api/maps", cookie=c)[0], 401)

    def test_database_has_no_fast_hash_of_the_password(self):
        import hashlib, sqlite3
        db = sqlite3.connect(self.data / "brainstorm.db")
        value = json.loads(db.execute("SELECT value FROM meta WHERE key = 'auth_fingerprint'").fetchone()[0])
        db.close()
        self.assertEqual(sorted(value), ["fp", "salt"], "scrypt with salt")
        self.assertNotIn(hashlib.sha256(b"s3gredo \xc3\xa7").hexdigest(), json.dumps(value))

    def test_concurrent_attempts_cannot_pass_the_limit(self):
        self.server.login_delay = 0.3
        with ThreadPoolExecutor(30) as pool:
            codes = list(pool.map(lambda _: self.login(password="errada")[0], range(30)))
        self.assertEqual(codes.count(401), 10, "only 10 attempts get as far as checking the password")
        self.assertEqual(codes.count(429), 20)
        self.assertEqual(self.login()[0], 429)

    def test_correct_login_clears_the_failure_count(self):
        for _ in range(9):
            self.login(password="errada")
        self.assertEqual(self.login()[0], 200)
        self.assertEqual(self.login(password="errada")[0], 401, "count reset: no lockout")

    def test_login_from_another_site_is_blocked(self):
        status, headers, _ = self.call("POST", "/api/login", {"user": "ana", "password": "s3gredo ç"}, headers={"Origin": "http://evil.example"})
        self.assertEqual(status, 403)
        self.assertNotIn("Set-Cookie", headers)

    def test_without_credentials_the_app_is_open(self):
        self.stop()
        self.server = make_server(self.data, 0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.assertEqual(self.call("GET", "/api/maps")[0], 200)
        self.assertEqual(json.loads(self.call("GET", "/api/session")[2]), {"auth": False})


    def test_public_paths_cannot_reach_other_files(self):
        for path in ("/fonts/../app.js", "/fonts/%2e%2e/app.js", "/fonts/..%2fapp.js", "//fonts/../index.html",
                     "/fonts/%2E%2E/index.html", "/login.html/../app.js", "/fonts/./../app.js", "/fonts//../app.js"):
            self.assertEqual(self.call("GET", path)[0], 302, path)
            self.assertEqual(self.call("HEAD", path)[0], 302, path)
        self.assertEqual(self.call("GET", "/login.js")[0], 200)
        c = self.cookie()
        self.assertEqual(self.call("GET", "/fonts/../app.js", cookie=c)[0], 200, "with a session, it still serves")

    def test_settings_need_login_and_same_origin(self):
        for method, path in (("GET", "/api/settings/llm"), ("PUT", "/api/settings/llm/openai"), ("DELETE", "/api/settings/llm/openai"),
                             ("GET", "/api/settings/backup"), ("PUT", "/api/settings/backup"), ("POST", "/api/backup/run"),
                             ("GET", "/api/backup/list"), ("POST", "/api/backup/restore")):
            self.assertEqual(self.call(method, path, {"key": "k" * 20} if method != "GET" else None)[0], 401, path)
        c = self.cookie()
        evil = {"Origin": "http://evil.example"}
        for method, path in (("PUT", "/api/settings/llm/openai"), ("DELETE", "/api/settings/llm/openai"), ("PUT", "/api/settings/backup"),
                             ("POST", "/api/backup/run"), ("POST", "/api/backup/restore")):
            self.assertEqual(self.call(method, path, {"key": "k" * 20}, cookie=c, headers=evil)[0], 403, path)
        self.assertIsNone(self.server.store.setting("llm"))
        self.assertEqual(self.call("PUT", "/api/settings/llm/openai", {"key": "k" * 20}, cookie=c)[0], 200)

    def test_head_goes_through_the_same_checks(self):
        self.assertEqual(self.call("HEAD", "/app.js")[0], 302)
        self.assertEqual(self.call("HEAD", "/api/maps")[0], 401)
        self.assertEqual(self.call("HEAD", "/login.html", headers={"Host": "evil.com"})[0], 403)
        self.assertEqual(self.call("HEAD", "/login.html")[0], 200)
        self.assertEqual(self.call("HEAD", "/app.js", cookie=self.cookie())[0], 200)

    def test_login_with_a_lone_surrogate_is_401(self):
        raw = b'{"user": "ana", "password": "\\ud800"}'
        req = urllib.request.Request(self.base + "/api/login", data=raw, method="POST")
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req)
        e.exception.close()
        self.assertEqual(e.exception.code, 401)

    def test_login_body_is_limited_before_reading(self):
        port = self.server.server_address[1]
        body = json.dumps({"user": "ana", "password": "s3gredo ç"}).encode()
        for bad in ("-1", "abc"):
            status, data = raw_request(port, f"POST /api/login HTTP/1.1\nContent-Length: {bad}", body)
            self.assertEqual(status, 400, bad)
            self.assertNotIn(b"Set-Cookie", data)
        self.assertEqual(raw_request(port, "POST /api/login HTTP/1.1\nContent-Length: 10001", body)[0], 413)

    def test_lockout_is_global_not_per_address(self):
        # a local process chooses the source address (127.x.y.z): each one must not get a fresh limit
        port, codes = self.server.server_address[1], []
        for i in range(11):
            conn = http.client.HTTPConnection("127.0.0.1", port, source_address=(f"127.0.0.{i + 2}", 0))
            conn.request("POST", "/api/login", json.dumps({"user": "ana", "password": "errada"}))
            codes.append(conn.getresponse().status)
            conn.close()
        self.assertEqual(codes, [401] * 10 + [429])
        self.assertEqual(self.server.login_fails.__class__, list, "single count: it does not grow with the addresses")

    def test_other_malformed_cookies_do_not_log_out(self):
        c = self.cookie()
        for header in (f"ruim[chave]=1; {c}; outro=x", f"{c};a b c", f"x=1;{c}"):
            self.assertEqual(self.call("GET", "/api/maps", cookie=header)[0], 200, header)
        for header in (f"x{c}", c + "$", "brainstorm_session="):
            self.assertEqual(self.call("GET", "/api/maps", cookie=header)[0], 401, header)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class EnvFileTest(unittest.TestCase):
    def test_env_file_is_read_and_real_env_wins(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / ".env"
            env.write_text('# comentário\nBRAINSTORM_T1=um\nexport BRAINSTORM_T2="dois = 2"\nBRAINSTORM_T3=\'tres\'\nlixo\n')
            os.environ["BRAINSTORM_T1"] = "do ambiente"
            try:
                load_env(env)
                self.assertEqual([os.environ[k] for k in ("BRAINSTORM_T1", "BRAINSTORM_T2", "BRAINSTORM_T3")], ["do ambiente", "dois = 2", "tres"])
            finally:
                for k in ("BRAINSTORM_T1", "BRAINSTORM_T2", "BRAINSTORM_T3"):
                    os.environ.pop(k, None)


class MainTest(unittest.TestCase):
    """Refusals at startup (main), without opening a port: make_server is replaced by a fake server."""

    class Out(io.StringIO):
        flushed = ""

        def flush(self):
            self.flushed = self.getvalue()

    def main(self, **env):
        # returns (refusal message or None, umask after main, output already flushed)
        clean = {k: v for k, v in os.environ.items() if not k.startswith("BRAINSTORM_")}
        server = mock.Mock(**{"serve_forever.side_effect": KeyboardInterrupt})
        out, old = self.Out(), os.umask(0o022)
        try:
            with mock.patch.dict(os.environ, {**clean, **env}, clear=True), mock.patch("sys.argv", ["app.py", "0"]), \
                    mock.patch("app.load_env"), mock.patch("app.watch"), mock.patch("app.make_server", return_value=server), \
                    contextlib.redirect_stdout(out):
                app.main()
            refused = None
        except SystemExit as e:
            refused = str(e.code)
        finally:
            umask = os.umask(old)
        return refused, umask, out.flushed

    def test_no_login_on_a_network_address_is_refused(self):
        for host in ("0.0.0.0", "192.168.0.10", "::", ""):
            refused, _, _ = self.main(BRAINSTORM_HOST=host)
            self.assertIn("BRAINSTORM_ALLOW_NO_LOGIN", refused or "", host)
        for host in ("127.0.0.1", "127.0.0.2", "localhost", "::1"):
            self.assertIsNone(self.main(BRAINSTORM_HOST=host)[0], host)
        self.assertIsNone(self.main()[0], "default: 127.0.0.1")
        self.assertIsNone(self.main(BRAINSTORM_HOST="0.0.0.0", BRAINSTORM_ALLOW_NO_LOGIN="1")[0])
        self.assertIsNotNone(self.main(BRAINSTORM_HOST="0.0.0.0", BRAINSTORM_ALLOW_NO_LOGIN="sim")[0], "only 1 allows it")
        self.assertIsNone(self.main(BRAINSTORM_HOST="0.0.0.0", BRAINSTORM_USER="ana", BRAINSTORM_PASSWORD="s3gredo ç")[0])

    def test_example_password_is_refused(self):
        refused, _, _ = self.main(BRAINSTORM_USER="ana", BRAINSTORM_PASSWORD="change-this-password")
        self.assertIn(".env.example", refused or "")
        refused, _, _ = self.main(BRAINSTORM_USER="ana", BRAINSTORM_PASSWORD="troque-esta-senha")
        self.assertIn(".env.example", refused or "", "the example password of older versions is refused too")
        example = (Path(app.__file__).with_name(".env.example")).read_text()
        self.assertIn("BRAINSTORM_PASSWORD=change-this-password", example, "the refusal follows the example")


class MigrationTest(unittest.TestCase):
    """Old format (one .json per document) imported into the database on first start."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        d = self.data
        mp = lambda text, v: json.dumps({"version": v, "root": {"text": text, "children": []}})
        (d / "a.json").write_text(mp("Ativo", 3))
        (d / "bad.json").write_text("{")
        (d / "history" / "a").mkdir(parents=True)
        (d / "history" / "a" / "2.json").write_text(mp("Antes", 2))
        (d / "files" / "a").mkdir(parents=True)
        (d / "files" / "a" / ("f" * 32 + ".png")).write_bytes(b"img")
        (d / "trash" / "t" / "files").mkdir(parents=True)
        (d / "trash" / "t" / "map.json").write_text(json.dumps({"version": 1, "type": "board", "title": "Lixo", "elements": []}))
        (d / "trash" / "t" / "files" / ("e" * 32 + ".png")).write_bytes(b"old")
        (d / "folders").mkdir()
        (d / "folders" / "tree.json").write_text(json.dumps({"version": 4, "folders": [{"id": "p", "name": "Pasta", "parent": None}], "place": {"a": "p"}}))
        with contextlib.redirect_stdout(io.StringIO()):
            self.server = make_server(d, 0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path) as r:
                body = r.read()
                return r.status, (json.loads(body) if r.headers.get_content_type() == "application/json" else body)
        except urllib.error.HTTPError as e:
            return e.code, None

    def test_everything_is_imported_and_old_files_are_kept(self):
        self.assertEqual([(m["id"], m["title"]) for m in self.get("/api/maps")[1]], [("a", "Ativo")])
        self.assertEqual(self.get("/api/maps/a")[1]["version"], 3)
        self.assertEqual([h["version"] for h in self.get("/api/maps/a/history")[1]], [2])
        self.assertEqual(self.get(f"/api/maps/a/files/{'f' * 32}.png"), (200, b"img"))
        self.assertEqual([(t["id"], t["title"]) for t in self.get("/api/trash")[1]], [("t", "Lixo")])
        self.assertEqual(self.get("/api/folders")[1]["place"], {"a": "p"})
        self.assertTrue((self.data / "attachments" / "t" / ("e" * 32 + ".png")).exists(), "trash attachments too")
        backups = list(self.data.glob("legacy-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(sorted(p.name for p in backups[0].iterdir()), ["a.json", "bad.json", "files", "folders", "history", "trash"],
                         "nothing deleted: the whole old format goes to the backup (including the corrupted file)")
        self.assertFalse((self.data / "a.json").exists())

    def test_second_start_does_not_import_again(self):
        self.server.shutdown()
        self.server.server_close()
        self.server = make_server(self.data, 0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.assertEqual(len(list(self.data.glob("legacy-*"))), 1)
        self.assertEqual(len(self.get("/api/maps")[1]), 1)


class MigrationSafetyTest(unittest.TestCase):
    """Importing the old format only accepts what the API would accept and does not follow symlinks."""

    def test_bad_ids_symlinks_and_invalid_folders_stay_in_the_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, outside = Path(tmp) / "data", Path(tmp) / "outside"
            d.mkdir()
            outside.mkdir()
            (outside / "secret.png").write_bytes(b"segredo")
            mp = json.dumps({"version": 1, "root": {"text": "Mapa", "children": []}})
            for name in ("a", "b", "Bad Id", "x" * 65):
                (d / f"{name}.json").write_text(mp)
            (d / "num.json").write_text(json.dumps({"version": 1, "root": {"text": 5}}))
            (d / "link.json").symlink_to(outside / "secret.png")
            (d / "files" / "a").mkdir(parents=True)
            (d / "files" / "a" / ("f" * 32 + ".png")).write_bytes(b"img")
            (d / "files" / "a" / ("e" * 32 + ".png")).symlink_to(outside / "secret.png")
            (d / "files" / "a" / "sub").symlink_to(outside, target_is_directory=True)
            (d / "files" / "b").symlink_to(outside, target_is_directory=True)
            (d / "files" / "Bad Id").mkdir()
            (d / "folders").mkdir()
            (d / "folders" / "tree.json").write_text(json.dumps({"version": 1, "folders": [], "place": {"a": "nao-existe"}}))
            store = Store(d / "brainstorm.db", d / "attachments")
            self.assertEqual(migrate_legacy(store, d), 2)
            self.assertEqual(sorted(m["id"] for m in store.list_docs()), ["a", "b"])
            self.assertEqual(sorted(p.name for p in (d / "attachments").rglob("*")), ["a", "f" * 32 + ".png"])
            self.assertEqual(store.folders(), {"version": 0, "folders": [], "place": {}})
            backup = next(d.glob("legacy-*"))
            self.assertEqual(len(list(backup.iterdir())), 8, "nothing deleted: everything in the backup")
            self.assertEqual((outside / "secret.png").read_bytes(), b"segredo")


class WatchTest(unittest.TestCase):
    def test_watch_calls_back_when_file_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "app.py"
            f.write_text("a")
            changed = threading.Event()
            watch([f], changed.set, interval=0.05)
            self.assertFalse(changed.wait(0.2), "no change, no callback")
            f.write_text("b")
            os.utime(f, (f.stat().st_atime, f.stat().st_mtime + 5))
            self.assertTrue(changed.wait(2), "a change triggers the callback")


if __name__ == "__main__":
    unittest.main()
