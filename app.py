"""Servidor local do editor de mapas mentais: arquivos estáticos + API JSON."""
import json
import mimetypes
import os
import re
import shutil
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
ID_RE = re.compile(r"^[a-z0-9-]{1,64}$")
MAX_BODY = 5_000_000
START = f"{os.getpid()}-{time.time()}"  # muda a cada partida/reinício do servidor
MAX_FILE = 20_000_000
HISTORY_INTERVAL = 120  # s entre cópias no histórico (autosave grava a cada edição)
HISTORY_MAX = 50        # versões guardadas por mapa
FILE_RE = re.compile(r"^[a-f0-9]{32}(\.[a-z0-9]{1,10})?$")
# só estes tipos abrem no navegador; o resto (inclusive SVG/HTML) sempre baixa como anexo
INLINE = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}


def read_map(file):
    # JSON do mapa como dict; None se o arquivo estiver corrompido
    try:
        data = json.loads(file.read_text("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self._foreign_host() or self._api("GET"):
            return
        super().do_GET()

    def do_PUT(self):
        self._foreign_host() or self._foreign_origin() or self._api("PUT") or self._send(404, {"error": "not found"})

    def do_POST(self):
        self._foreign_host() or self._foreign_origin() or self._api("POST") or self._send(404, {"error": "not found"})

    def do_DELETE(self):
        self._foreign_host() or self._foreign_origin() or self._api("DELETE") or self._send(404, {"error": "not found"})

    def _foreign_origin(self):
        # escrita vinda de outra origem (página de outro site aberta no navegador) é recusada
        port = self.server.server_address[1]
        if self.headers.get("Origin") in (None, f"http://127.0.0.1:{port}", f"http://localhost:{port}"):
            return False
        self._send(403, {"error": "forbidden origin"})
        return True

    def _foreign_host(self):
        # bloqueia DNS rebinding: um site externo apontando para 127.0.0.1 chega com outro Host
        port = self.server.server_address[1]
        if self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}"):
            return False
        self._send(403, {"error": "forbidden host"})
        return True

    def _api(self, method):
        path = urlsplit(self.path).path
        if path == "/api/trash" or path.startswith("/api/trash/"):
            self._trash(method, path[len("/api/trash"):].strip("/"))
            return True
        if path == "/api/events" and method == "GET":
            self._events()
            return True
        if path == "/api/maps" and method == "GET":
            self._send(200, self._list())
            return True
        if not path.startswith("/api/maps/"):
            return False
        map_id, _, sub = path[len("/api/maps/"):].partition("/")
        if not ID_RE.match(map_id):
            self._send(400, {"error": "invalid id"})
            return True
        if sub == "duplicate" and method == "POST":
            self._duplicate(map_id)
            return True
        if sub == "history" or sub.startswith("history/"):
            self._history(method, map_id, sub)
            return True
        if sub:
            self._files(method, map_id, sub)
            return True
        file = self.server.data_dir / f"{map_id}.json"
        if method == "GET":
            if not file.exists():
                self._send(404, {"error": "not found"})
            else:
                data = read_map(file)
                self._send(*((200, data) if data is not None else (500, {"error": "corrupt map file"})))
        elif method == "DELETE":
            if not file.exists():
                self._send(404, {"error": "not found"})
            else:
                self._to_trash(map_id)
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
            data = read_map(file)
            if data is None:  # não sobrescreve um arquivo que não conseguimos ler
                self._send(500, {"error": "corrupt map file"})
                return
            stored = data.get("version", 0)
            if body["version"] != stored:
                self._send(409, {"version": stored})
                return
            body["version"] = stored + 1
            self._snapshot(map_id, file, stored)
        else:
            body["version"] = 1
        body["id"] = map_id
        tmp = file.with_suffix(".tmp")
        tmp.write_text(json.dumps(body, ensure_ascii=False), "utf-8")
        os.replace(tmp, file)
        self._send(200, {"version": body["version"]})

    # ---- Lixeira: data/trash/<id>/ guarda map.json, files/ e history/ do mapa apagado ----
    def _parts(self, map_id):
        d = self.server.data_dir
        return [(d / f"{map_id}.json", "map.json"), (d / "files" / map_id, "files"), (d / "history" / map_id, "history")]

    def _to_trash(self, map_id):
        box = self.server.data_dir / "trash" / map_id
        shutil.rmtree(box, ignore_errors=True)  # apagar de novo o mesmo id substitui o anterior
        box.mkdir(parents=True)
        for src, name in self._parts(map_id):
            if src.exists():
                shutil.move(src, box / name)

    def _trash(self, method, rest):
        root = self.server.data_dir / "trash"
        if not rest:
            if method != "GET":
                self._send(404, {"error": "not found"})
                return
            items = []
            for box in root.glob("*") if root.exists() else []:
                data = read_map(box / "map.json") if (box / "map.json").exists() else None
                if data is None:
                    continue
                mtime = box.stat().st_mtime
                items.append((mtime, {"id": box.name, "title": data["root"].get("text", ""),
                                      "deleted": datetime.fromtimestamp(mtime, timezone.utc).isoformat()}))
            self._send(200, [i for _, i in sorted(items, key=lambda x: x[0], reverse=True)])
            return
        map_id, _, action = rest.partition("/")
        if not ID_RE.match(map_id):
            self._send(400, {"error": "invalid id"})
            return
        box = root / map_id
        if not box.is_dir():
            self._send(404, {"error": "not found"})
            return
        if method == "DELETE" and not action:
            shutil.rmtree(box)
            self._send(204, None)
        elif method == "POST" and action == "restore":
            if (self.server.data_dir / f"{map_id}.json").exists():
                self._send(409, {"error": "a map with this id already exists"})
                return
            for dst, name in self._parts(map_id):
                if (box / name).exists():
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(box / name, dst)
            shutil.rmtree(box)
            self._send(200, {"id": map_id})
        else:
            self._send(404, {"error": "not found"})

    def _duplicate(self, map_id):
        d = self.server.data_dir
        data = read_map(d / f"{map_id}.json") if (d / f"{map_id}.json").exists() else None
        if data is None:
            self._send(404, {"error": "not found"})
            return
        new_id = f"{map_id[:48]}-copia-{uuid.uuid4().hex[:6]}"
        data.update(id=new_id, version=1)
        data["root"]["text"] = f"{data['root'].get('text', '')} (cópia)"
        (d / f"{new_id}.json").write_text(json.dumps(data, ensure_ascii=False), "utf-8")
        if (d / "files" / map_id).exists():
            shutil.copytree(d / "files" / map_id, d / "files" / new_id)  # imagens/anexos apontam para o mapa
        self._send(201, {"id": new_id})

    def _snapshot(self, map_id, file, version):
        # guarda a versão que vai ser sobrescrita, no máximo uma a cada HISTORY_INTERVAL s
        folder = self.server.data_dir / "history" / map_id
        folder.mkdir(parents=True, exist_ok=True)
        snaps = sorted(folder.glob("*.json"), key=lambda p: int(p.stem))
        if snaps and time.time() - snaps[-1].stat().st_mtime < self.server.history_interval:
            return
        shutil.copy2(file, folder / f"{version}.json")  # mantém a data em que aquela versão foi gravada
        for old in sorted(folder.glob("*.json"), key=lambda p: int(p.stem))[:-HISTORY_MAX]:
            old.unlink()

    def _history(self, method, map_id, sub):
        # GET /api/maps/<id>/history (lista) e /api/maps/<id>/history/<versão> (conteúdo)
        folder = self.server.data_dir / "history" / map_id
        if method != "GET":
            self._send(404, {"error": "not found"})
            return
        _, _, version = sub.partition("/")
        if not version:
            items = []
            for f in sorted(folder.glob("*.json"), key=lambda p: int(p.stem), reverse=True):
                data = read_map(f)
                if data is None:
                    continue
                count = lambda n: 1 + sum(count(c) for c in n.get("children", []))
                saved = datetime.fromtimestamp(f.stat().st_mtime, timezone.utc).isoformat()
                items.append({"version": int(f.stem), "saved": saved,
                              "title": data["root"].get("text", ""), "nodes": count(data["root"])})
            self._send(200, items)
            return
        if not version.isdigit():
            self._send(400, {"error": "invalid version"})
            return
        data = read_map(folder / f"{version}.json") if (folder / f"{version}.json").exists() else None
        self._send(*((200, data) if data is not None else (404, {"error": "not found"})))

    def _files(self, method, map_id, sub):
        # /api/maps/<id>/files (POST) e /api/maps/<id>/files/<arquivo> (GET)
        folder = self.server.data_dir / "files" / map_id
        if method == "POST" and sub == "files":
            # cabeçalho próprio obrigatório: o navegador faz preflight (que não autorizamos) para outros sites
            if "X-Filename" not in self.headers:
                self._send(400, {"error": "missing X-Filename"})
                return
            if not (self.server.data_dir / f"{map_id}.json").exists():
                self._send(404, {"error": "map not found"})
                return
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

    def _static_stamp(self):
        # carimbo = partida do servidor + arquivo mais recente de static/
        try:
            newest = max((p.stat().st_mtime for p in self.server.static_dir.rglob("*") if p.is_file()), default=0)
        except FileNotFoundError:
            return None  # editor trocando o arquivo neste instante: tenta no próximo ciclo
        return f"{START}-{newest}"

    def _events(self):
        # Server-Sent Events: a página recarrega quando o carimbo muda (static/ editado ou servidor reiniciado)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        last, beat = None, time.monotonic()
        try:
            while True:
                stamp = self._static_stamp()
                if stamp and stamp != last:
                    self.wfile.write(f"data: {stamp}\n\n".encode())
                    last, beat = stamp, time.monotonic()
                elif time.monotonic() - beat > 15:
                    self.wfile.write(b": ping\n\n")  # detecta aba fechada e libera a thread
                    beat = time.monotonic()
                time.sleep(0.5)
        except (BrokenPipeError, ConnectionResetError):
            pass

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
    server.static_dir = ROOT / "static"
    server.history_interval = HISTORY_INTERVAL
    return server


def watch(paths, on_change, interval=1.0):
    """Chama on_change (uma vez) quando o mtime de algum dos arquivos muda. Roda numa thread daemon."""
    def loop():
        before = [p.stat().st_mtime for p in paths]
        while True:
            time.sleep(interval)
            try:
                now = [p.stat().st_mtime for p in paths]
            except FileNotFoundError:
                continue  # editor salvando (arquivo trocado no meio): tenta de novo
            if now != before:
                on_change()
                return
    threading.Thread(target=loop, daemon=True).start()


def restart():
    print("app.py mudou — reiniciando o servidor…", flush=True)
    os.execv(sys.executable, [sys.executable, *sys.argv])


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = make_server(ROOT / "data", port)
    # recarrega sozinho ao editar o servidor (HTML/CSS/JS já vêm frescos a cada F5)
    watch([Path(__file__).resolve()], restart)
    print(f"Abra http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
