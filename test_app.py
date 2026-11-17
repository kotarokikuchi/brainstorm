import contextlib
from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from app import Handler, load_env, make_server, watch

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
        # protege contra DNS rebinding: só aceita Host local
        self.assertEqual(self.req("GET", "/api/maps", headers={"Host": "evil.com"})[0], 403)
        body = {"version": 0, "root": {"text": "a", "children": []}}
        self.assertEqual(self.req("PUT", "/api/maps/abc", body, headers={"Host": "evil.com:80"})[0], 403)
        self.assertEqual(self.req("GET", "/api/maps/abc")[0], 404)
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

    def test_trash_keeps_history_until_permanent_delete(self):
        self.server.history_interval = 0
        self.put_text(0, "a")
        self.put_text(1, "b")
        self.req("DELETE", "/api/maps/abc")
        self.req("POST", "/api/trash/abc/restore", raw=b"")
        self.assertEqual(len(self.req("GET", "/api/maps/abc/history")[1]), 1, "histórico volta junto")
        self.req("DELETE", "/api/maps/abc")
        self.req("DELETE", "/api/trash/abc")
        self.assertEqual(self.req("GET", "/api/maps/abc/history")[1], [], "apagar de vez leva o histórico")

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

    def test_saving_trashed_document_and_permanent_delete(self):
        self.make_map()
        _, info = self.upload("abc", "foto.png", b"x")
        self.req("DELETE", "/api/maps/abc")
        # aba antiga ainda salvando o documento apagado em outra aba: não recria por baixo da lixeira
        self.assertEqual(self.req("PUT", "/api/maps/abc", {"version": 1, "root": {"text": "b", "children": []}})[0], 410)
        self.assertEqual(self.req("POST", "/api/trash/zzz/restore", raw=b"")[0], 404)
        self.assertEqual(self.req("DELETE", "/api/trash/abc")[0], 204)
        self.assertEqual(self.req("GET", "/api/trash")[1], [])
        self.assertFalse((self.data / "attachments" / "abc").exists(), "anexos saem junto")
        self.assertEqual(self.req("DELETE", "/api/trash/abc")[0], 404)
        self.assertEqual(self.req("DELETE", "/api/trash/..%2Fx")[0], 400)
        self.make_map()  # o id fica livre de novo
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
        self.assertEqual(self.req("GET", f"/api/maps/abc/files/{info['id']}")[0], 404, "documento na lixeira não serve arquivos")

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


class AuthTest(unittest.TestCase):
    """Com BRAINSTORM_USER/BRAINSTORM_PASSWORD: tudo exige login, menos a página de login."""

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
        self.assertEqual((status, headers.get("Location")), (302, "/login.html"), "abrir o app leva ao login")
        self.assertEqual(self.call("GET", "/app.js")[0], 302)
        for public in ("/login.html", "/style.css", "/fonts/kalam-latin-400-normal.woff2"):
            self.assertEqual(self.call("GET", public)[0], 200, public)

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
        self.assertEqual(status, 429, "10 erros em 10 min bloqueiam até a senha certa")
        self.assertIn("Retry-After", headers)

    def test_logout_ends_the_session(self):
        c = self.cookie()
        status, headers, _ = self.call("POST", "/api/logout", cookie=c)
        self.assertEqual(status, 204)
        self.assertIn("Max-Age=0", headers["Set-Cookie"])
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
        self.assertEqual(sorted(value), ["fp", "salt"], "scrypt com sal")
        self.assertNotIn(hashlib.sha256(b"s3gredo \xc3\xa7").hexdigest(), json.dumps(value))

    def test_concurrent_attempts_cannot_pass_the_limit(self):
        self.server.login_delay = 0.3
        with ThreadPoolExecutor(30) as pool:
            codes = list(pool.map(lambda _: self.login(password="errada")[0], range(30)))
        self.assertEqual(codes.count(401), 10, "só 10 tentativas chegam a conferir a senha")
        self.assertEqual(codes.count(429), 20)
        self.assertEqual(self.login()[0], 429)

    def test_correct_login_clears_the_failure_count(self):
        for _ in range(9):
            self.login(password="errada")
        self.assertEqual(self.login()[0], 200)
        self.assertEqual(self.login(password="errada")[0], 401, "contagem zerada: não bloqueia")

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


class MigrationTest(unittest.TestCase):
    """Formato antigo (um .json por documento) importado para o banco na primeira partida."""

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
        self.assertTrue((self.data / "attachments" / "t" / ("e" * 32 + ".png")).exists(), "anexos da lixeira também")
        backups = list(self.data.glob("legacy-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(sorted(p.name for p in backups[0].iterdir()), ["a.json", "bad.json", "files", "folders", "history", "trash"],
                         "nada apagado: o formato antigo inteiro vai para o backup (inclusive o corrompido)")
        self.assertFalse((self.data / "a.json").exists())

    def test_second_start_does_not_import_again(self):
        self.server.shutdown()
        self.server.server_close()
        self.server = make_server(self.data, 0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.assertEqual(len(list(self.data.glob("legacy-*"))), 1)
        self.assertEqual(len(self.get("/api/maps")[1]), 1)


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
