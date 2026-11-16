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

    def test_deleting_map_removes_its_files(self):
        self.req("PUT", "/api/maps/abc", {"version": 0, "root": {"text": "a", "children": []}})
        _, info = self.upload("abc", "foto.png", b"x")
        self.assertEqual(self.req("DELETE", "/api/maps/abc")[0], 204)
        self.assertEqual(self.req("GET", f"/api/maps/abc/files/{info['id']}")[0], 404)
        self.assertFalse((self.data / "files" / "abc").exists())

    def test_body_too_large_is_413(self):
        status, _ = self.req("PUT", "/api/maps/abc", raw=b"x", headers={"Content-Length": "5000001"})
        self.assertEqual(status, 413)


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
