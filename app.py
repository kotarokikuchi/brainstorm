"""Servidor local do editor de mapas mentais: arquivos estáticos + API JSON."""
import json
import os
import re
import sys
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
ID_RE = re.compile(r"^[a-z0-9-]{1,64}$")
MAX_BODY = 5_000_000


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self._api("GET"):
            return
        super().do_GET()

    def do_PUT(self):
        self._api("PUT") or self._send(404, {"error": "not found"})

    def do_DELETE(self):
        self._api("DELETE") or self._send(404, {"error": "not found"})

    def _api(self, method):
        path = urlsplit(self.path).path
        if path == "/api/maps" and method == "GET":
            self._send(200, self._list())
            return True
        if not path.startswith("/api/maps/"):
            return False
        map_id = path[len("/api/maps/"):]
        if not ID_RE.match(map_id):
            self._send(400, {"error": "invalid id"})
            return True
        file = self.server.data_dir / f"{map_id}.json"
        if method == "GET":
            if not file.exists():
                self._send(404, {"error": "not found"})
            else:
                self._send(200, json.loads(file.read_text("utf-8")))
        elif method == "DELETE":
            if not file.exists():
                self._send(404, {"error": "not found"})
            else:
                file.unlink()
                self._send(204, None)
        elif method == "PUT":
            self._put(map_id, file)
        return True

    def _put(self, map_id, file):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.close_connection = True
            self._send(413, {"error": "too large"})
            return
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError:
            body = None
        if not (isinstance(body, dict) and isinstance(body.get("root"), dict)
                and isinstance(body.get("version"), int)):
            self._send(400, {"error": "invalid map"})
            return
        # ponytail: checagem de versão sem lock; dois PUTs simultâneos no mesmo
        # mapa podem passar juntos. Aceitável para uso pessoal.
        if file.exists():
            stored = json.loads(file.read_text("utf-8")).get("version", 0)
            if body["version"] != stored:
                self._send(409, {"version": stored})
                return
            body["version"] = stored + 1
        else:
            body["version"] = 1
        body["id"] = map_id
        tmp = file.with_suffix(".tmp")
        tmp.write_text(json.dumps(body, ensure_ascii=False), "utf-8")
        os.replace(tmp, file)
        self._send(200, {"version": body["version"]})

    def _list(self):
        items = []
        for f in self.server.data_dir.glob("*.json"):
            try:
                m = json.loads(f.read_text("utf-8"))
                title = m["root"]["text"]
            except (ValueError, KeyError, TypeError):
                continue  # arquivo corrompido não derruba a listagem
            mtime = f.stat().st_mtime
            items.append((mtime, {"id": f.stem, "title": title,
                                  "updated": datetime.fromtimestamp(mtime, timezone.utc).isoformat()}))
        return [item for _, item in sorted(items, key=lambda x: x[0], reverse=True)]

    def _send(self, status, payload):
        data = b"" if payload is None else json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        if payload is not None:
            self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def make_server(data_dir: Path, port: int) -> ThreadingHTTPServer:
    data_dir.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT / "static")))
    server.data_dir = data_dir
    return server


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = make_server(ROOT / "data", port)
    print(f"Abra http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
