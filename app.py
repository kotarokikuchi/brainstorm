"""Servidor local do editor de mapas mentais: arquivos estáticos + API JSON."""
import json
import mimetypes
import os
import re
import shutil
import sys
import uuid
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
ID_RE = re.compile(r"^[a-z0-9-]{1,64}$")
MAX_BODY = 5_000_000
MAX_FILE = 20_000_000
FILE_RE = re.compile(r"^[a-f0-9]{32}(\.[a-z0-9]{1,10})?$")
# só estes tipos abrem no navegador; o resto (inclusive SVG/HTML) sempre baixa como anexo
INLINE = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self._foreign_host() or self._api("GET"):
            return
        super().do_GET()

    def do_PUT(self):
        self._foreign_host() or self._api("PUT") or self._send(404, {"error": "not found"})

    def do_POST(self):
        self._foreign_host() or self._api("POST") or self._send(404, {"error": "not found"})

    def do_DELETE(self):
        self._foreign_host() or self._api("DELETE") or self._send(404, {"error": "not found"})

    def _foreign_host(self):
        # bloqueia DNS rebinding: um site externo apontando para 127.0.0.1 chega com outro Host
        port = self.server.server_address[1]
        if self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}"):
            return False
        self._send(403, {"error": "forbidden host"})
        return True

    def _api(self, method):
        path = urlsplit(self.path).path
        if path == "/api/maps" and method == "GET":
            self._send(200, self._list())
            return True
        if not path.startswith("/api/maps/"):
            return False
        map_id, _, sub = path[len("/api/maps/"):].partition("/")
        if not ID_RE.match(map_id):
            self._send(400, {"error": "invalid id"})
            return True
        if sub:
            self._files(method, map_id, sub)
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
                shutil.rmtree(self.server.data_dir / "files" / map_id, ignore_errors=True)
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

    def _files(self, method, map_id, sub):
        # /api/maps/<id>/files (POST) e /api/maps/<id>/files/<arquivo> (GET)
        folder = self.server.data_dir / "files" / map_id
        if method == "POST" and sub == "files":
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_FILE:
                self.close_connection = True
                self._send(413, {"error": "too large"})
                return
            name = unquote(self.headers.get("X-Filename") or "arquivo")
            ext = Path(name).suffix.lower()
            if not re.fullmatch(r"\.[a-z0-9]{1,10}", ext):
                ext = ""
            file_id = uuid.uuid4().hex + ext
            folder.mkdir(parents=True, exist_ok=True)
            (folder / file_id).write_bytes(self.rfile.read(length))
            kind = INLINE.get(ext) or mimetypes.guess_type(name)[0] or "application/octet-stream"
            self._send(201, {"id": file_id, "name": name, "size": length, "type": kind})
            return
        prefix, _, file_id = sub.partition("/")
        if method != "GET" or prefix != "files" or not file_id:
            self._send(404, {"error": "not found"})
            return
        if not FILE_RE.match(file_id):
            self._send(400, {"error": "invalid file id"})
            return
        path = folder / file_id
        if not path.is_file():
            self._send(404, {"error": "not found"})
            return
        data = path.read_bytes()
        inline = INLINE.get(path.suffix)
        self.send_response(200)
        self.send_header("Content-Type", inline or "application/octet-stream")
        self.send_header("X-Content-Type-Options", "nosniff")
        if not inline:
            self.send_header("Content-Disposition", "attachment")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

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
