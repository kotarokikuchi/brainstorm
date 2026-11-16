import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from app import Handler, make_server

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

    def test_body_too_large_is_413(self):
        status, _ = self.req("PUT", "/api/maps/abc", raw=b"x", headers={"Content-Length": "5000001"})
        self.assertEqual(status, 413)


if __name__ == "__main__":
    unittest.main()
