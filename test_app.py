import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from app import Handler, make_server, watch

Handler.log_message = lambda *a: None  # silencia o log de requisições nos testes


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
        self.assertEqual(list(self.data.iterdir()), [])

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

    def test_corrupt_file_skipped_in_list(self):
        (self.data / "bad.json").write_text("{")
        status, lst = self.req("GET", "/api/maps")
        self.assertEqual((status, lst), (200, []))

    def test_foreign_host_is_403(self):
        # protege contra DNS rebinding: só aceita Host local
        self.assertEqual(self.req("GET", "/api/maps", headers={"Host": "evil.com"})[0], 403)
        body = {"version": 0, "root": {"text": "a", "children": []}}
        self.assertEqual(self.req("PUT", "/api/maps/abc", body, headers={"Host": "evil.com:80"})[0], 403)
        self.assertEqual(list(self.data.iterdir()), [])
        port = self.server.server_address[1]
        self.assertEqual(self.req("GET", "/api/maps", headers={"Host": f"localhost:{port}"})[0], 200)
        # porta publicada diferente (Docker): o nome local é o que importa
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
        # sem X-Filename seria um POST "simples" (sem preflight) vindo de qualquer site
        self.assertEqual(self.req("POST", "/api/maps/abc/files", raw=b"x", headers={"Content-Type": "text/plain"})[0], 400)
        evil = {"X-Filename": "a.png", "Origin": "http://evil.example"}
        self.assertEqual(self.req("POST", "/api/maps/abc/files", raw=b"x", headers=evil)[0], 403)
        self.assertEqual(self.req("PUT", "/api/maps/abc", {"version": 1, "root": {"text": "b", "children": []}},
                                  headers={"Origin": "http://evil.example"})[0], 403)
        self.assertEqual(self.req("DELETE", "/api/maps/abc", headers={"Origin": "http://evil.example"})[0], 403)
        port = self.server.server_address[1]
        ok = {"X-Filename": "a.png", "Origin": f"http://127.0.0.1:{port}"}
        self.assertEqual(self.req("POST", "/api/maps/abc/files", raw=b"x", headers=ok)[0], 201)
        # a origem precisa ser o próprio endereço da página (outra porta local também é outro site)
        other = {"X-Filename": "a.png", "Origin": "http://localhost:3000"}
        self.assertEqual(self.req("POST", "/api/maps/abc/files", raw=b"x", headers=other)[0], 403)
        docker = {"X-Filename": "a.png", "Host": "localhost:8080", "Origin": "http://localhost:8080"}
        self.assertEqual(self.req("POST", "/api/maps/abc/files", raw=b"x", headers=docker)[0], 201)
        self.assertFalse((self.data / "files" / "zzz").exists())
        self.assertEqual(self.upload("zzz", "a.png", b"x")[0], 404, "mapa inexistente")

    def test_events_stream_announces_static_changes(self):
        static = self.data / "static"
        static.mkdir()
        (static / "app.js").write_text("1")
        self.server.static_dir = static
        with urllib.request.urlopen(self.base + "/api/events", timeout=5) as resp:
            self.assertEqual(resp.headers["Content-Type"], "text/event-stream")
            first = resp.readline()
            self.assertTrue(first.startswith(b"data: "), first)
            resp.readline()  # linha em branco que fecha o evento
            st = (static / "app.js").stat()
            os.utime(static / "app.js", (st.st_atime, st.st_mtime + 5))
            second = resp.readline()
            self.assertTrue(second.startswith(b"data: "), second)
            self.assertNotEqual(first, second, "mudança em static/ gera novo carimbo")

    def test_corrupt_map_file_gives_clear_500(self):
        (self.data / "ruim.json").write_text("{")
        self.assertEqual(self.req("GET", "/api/maps/ruim"), (500, {"error": "corrupt map file"}))
        status, body = self.req("PUT", "/api/maps/ruim", {"version": 0, "root": {"text": "a", "children": []}})
        self.assertEqual((status, body), (500, {"error": "corrupt map file"}))
        self.assertEqual((self.data / "ruim.json").read_text(), "{", "arquivo corrompido não é sobrescrito")

    def put_text(self, version, text):
        return self.req("PUT", "/api/maps/abc", {"version": version, "root": {"text": text, "children": []}})

    def test_history_keeps_previous_versions(self):
        self.server.history_interval = 0
        for v in range(3):
            self.put_text(v, f"v{v}")
        status, items = self.req("GET", "/api/maps/abc/history")
        self.assertEqual(status, 200)
        self.assertEqual([i["version"] for i in items], [2, 1], "mais recente primeiro")
        self.assertEqual((items[0]["title"], items[0]["nodes"]), ("v1", 1))
        self.assertIn("saved", items[0])
        status, old = self.req("GET", "/api/maps/abc/history/1")
        self.assertEqual((status, old["root"]["text"]), (200, "v0"))
        self.assertEqual(self.req("GET", "/api/maps/abc/history/99")[0], 404)
        self.assertEqual(self.req("GET", "/api/maps/abc/history/..%2Fx")[0], 400)

    def test_history_is_throttled_and_capped(self):
        for v in range(3):  # intervalo padrão (2 min): só a primeira gravação guarda cópia
            self.put_text(v, f"v{v}")
        self.assertEqual(len(self.req("GET", "/api/maps/abc/history")[1]), 1)
        self.server.history_interval = 0
        for v in range(3, 60):
            self.put_text(v, f"v{v}")
        items = self.req("GET", "/api/maps/abc/history")[1]
        self.assertEqual(len(items), 50, "no máximo 50 versões")
        self.assertEqual(items[0]["version"], 59)

    def test_deleting_map_removes_its_history(self):
        self.server.history_interval = 0
        self.put_text(0, "a")
        self.put_text(1, "b")
        self.req("DELETE", "/api/maps/abc")
        self.assertFalse((self.data / "history" / "abc").exists())

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
        self.assertEqual(self.raw_get(f"/api/maps/abc/files/{info['id']}")[0], 200, "arquivos voltam junto")
        self.assertEqual(self.req("GET", "/api/trash")[1], [])

    def test_restore_conflict_and_permanent_delete(self):
        self.make_map()
        self.req("DELETE", "/api/maps/abc")
        self.make_map()  # outro mapa com o mesmo id
        self.assertEqual(self.req("POST", "/api/trash/abc/restore", raw=b"")[0], 409)
        self.assertEqual(self.req("DELETE", "/api/trash/abc")[0], 204)
        self.assertEqual(self.req("GET", "/api/trash")[1], [])
        self.assertFalse((self.data / "trash" / "abc").exists())
        self.assertEqual(self.req("DELETE", "/api/trash/abc")[0], 404)
        self.assertEqual(self.req("DELETE", "/api/trash/..%2Fx")[0], 400)

    def test_duplicate_copies_map_and_files(self):
        self.make_map()
        _, info = self.upload("abc", "foto.png", b"x")
        status, body = self.req("POST", "/api/maps/abc/duplicate", raw=b"")
        self.assertEqual(status, 201)
        new = body["id"]
        self.assertRegex(new, r"^[a-z0-9-]{1,64}$")
        self.assertNotEqual(new, "abc")
        status, m = self.req("GET", f"/api/maps/{new}")
        self.assertEqual((status, m["root"]["text"], m["version"], m["id"]), (200, "a (cópia)", 1, new))
        self.assertEqual(self.raw_get(f"/api/maps/{new}/files/{info['id']}")[0], 200, "arquivos copiados")
        self.assertEqual(self.req("POST", "/api/maps/zzz/duplicate", raw=b"")[0], 404)

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
        self.assertEqual(self.req("GET", f"/api/maps/{dup['id']}")[1]["title"], "Quadro 2 (cópia)")
        self.req("DELETE", "/api/maps/qd")
        self.assertEqual(self.req("GET", "/api/trash")[1][0]["title"], "Quadro 2")

    def test_static_files_are_revalidated(self):
        # sem isso o navegador reaproveita JS antigo (cache heurístico) depois de uma atualização
        status, headers, _ = self.raw_get("/app.js")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Cache-Control"), "no-cache")
        self.assertIn("Last-Modified", headers)

    def test_deleting_map_removes_its_files(self):
        self.req("PUT", "/api/maps/abc", {"version": 0, "root": {"text": "a", "children": []}})
        _, info = self.upload("abc", "foto.png", b"x")
        self.assertEqual(self.req("DELETE", "/api/maps/abc")[0], 204)
        self.assertEqual(self.req("GET", f"/api/maps/abc/files/{info['id']}")[0], 404)
        self.assertFalse((self.data / "files" / "abc").exists())

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
        self.assertEqual(self.req("PUT", "/api/folders", tree)[0], 409, "versão velha")
        bad = [
            {**tree, "version": 1, "folders": [{"id": "f1", "name": "  ", "parent": None}], "place": {}},
            {**tree, "version": 1, "folders": [{"id": "f1", "name": "a", "parent": "zz"}], "place": {}},
            {**tree, "version": 1, "folders": [{"id": "f1", "name": "a", "parent": "f2"}, {"id": "f2", "name": "b", "parent": "f1"}], "place": {}},
            {**tree, "version": 1, "place": {"abc": "nao-existe"}},
            {**tree, "version": 1, "folders": [{"id": "../x", "name": "a", "parent": None}], "place": {}},
        ]
        for b in bad:
            self.assertEqual(self.req("PUT", "/api/folders", b)[0], 400, b)
        self.assertEqual([m["id"] for m in self.req("GET", "/api/maps")[1]], [], "pastas não aparecem como documento")


class WatchTest(unittest.TestCase):
    def test_watch_calls_back_when_file_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "app.py"
            f.write_text("a")
            changed = threading.Event()
            watch([f], changed.set, interval=0.05)
            self.assertFalse(changed.wait(0.2), "sem mudança, sem callback")
            f.write_text("b")
            os.utime(f, (f.stat().st_atime, f.stat().st_mtime + 5))
            self.assertTrue(changed.wait(2), "mudança dispara o callback")


if __name__ == "__main__":
    unittest.main()
