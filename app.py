"""Servidor local do editor de mapas mentais: arquivos estáticos + API JSON."""
import json
import mimetypes
import os
import re
import sys
import threading
import time
import uuid
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from store import Store, migrate_legacy

ROOT = Path(__file__).resolve().parent
ID_RE = re.compile(r"^[a-z0-9-]{1,64}$")
MAX_BODY = 5_000_000
START = f"{os.getpid()}-{time.time()}"  # muda a cada partida/reinício do servidor
MAX_FILE = 20_000_000
HISTORY_INTERVAL = 120  # s entre cópias no histórico (autosave grava a cada edição)
FILE_RE = re.compile(r"^[a-f0-9]{32}(\.[a-z0-9]{1,10})?$")
# só estes tipos abrem no navegador; o resto (inclusive SVG/HTML) sempre baixa como anexo
INLINE = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}


# documentos: mapa mental ({root}) ou quadro de desenho ({type: "board", title, elements})
def valid_doc(body):
    if not (isinstance(body, dict) and isinstance(body.get("version"), int)):
        return False
    if body.get("type", "map") == "board":
        return isinstance(body.get("elements"), list) and isinstance(body.get("title", ""), str)
    return body.get("type", "map") == "map" and isinstance(body.get("root"), dict)


# pastas: {version, folders: [{id, name, parent}], place: {id do documento: id da pasta}}
# (fica fora dos documentos: mover não mexe na versão de um mapa aberto em outra aba)


def valid_folders(body):
    if not (isinstance(body, dict) and isinstance(body.get("version"), int)
            and isinstance(body.get("folders"), list) and isinstance(body.get("place"), dict)):
        return False
    parents = {}
    for f in body["folders"]:
        if not (isinstance(f, dict) and isinstance(f.get("id"), str) and ID_RE.match(f["id"])
                and isinstance(f.get("name"), str) and 0 < len(f["name"].strip()) <= 200
                and (f.get("parent") is None or isinstance(f.get("parent"), str))):
            return False
        if f["id"] in parents:
            return False
        parents[f["id"]] = f.get("parent")
    for fid in parents:  # pai precisa existir e não pode haver ciclo (pasta dentro dela mesma)
        seen, cur = set(), fid
        while cur is not None:
            if cur in seen or cur not in parents:
                return False
            seen.add(cur)
            cur = parents[cur]
    return all(isinstance(k, str) and ID_RE.match(k) and v in parents for k, v in body["place"].items())


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # arquivos do app: o navegador sempre confere se mudaram (304 barato) em vez de usar JS antigo do cache
        if not urlsplit(self.path).path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

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
        # escrita vinda de outra origem (página de outro site aberta no navegador) é recusada:
        # a origem tem de ser o próprio endereço da página (Host já validado como local)
        if self.headers.get("Origin") in (None, f"http://{self.headers.get('Host')}"):
            return False
        self._send(403, {"error": "forbidden origin"})
        return True

    def _foreign_host(self):
        # bloqueia DNS rebinding: um site externo apontando para 127.0.0.1 chega com outro Host.
        # Vale qualquer porta: no Docker a porta publicada pode ser outra que a do container.
        name, sep, port = (self.headers.get("Host") or "").rpartition(":")
        if not sep:
            name, port = self.headers.get("Host") or "", ""
        if name in ("127.0.0.1", "localhost") and (port == "" or port.isdigit()):
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
        if path == "/api/folders" and method in ("GET", "PUT"):
            self._folders(method)
            return True
        if path == "/api/maps" and method == "GET":
            self._send(200, self.server.store.list_docs())
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
        store = self.server.store
        if method == "GET":
            data = store.get(map_id)
            self._send(*((200, data) if data is not None else (404, {"error": "not found"})))
        elif method == "DELETE":
            self._send(*((204, None) if store.delete(map_id) else (404, {"error": "not found"})))
        elif method == "PUT":
            self._put(map_id)
        return True

    def _put(self, map_id):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.close_connection = True
            self._send(413, {"error": "too large"})
            return
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError:
            body = None
        if not valid_doc(body):
            self._send(400, {"error": "invalid map"})
            return
        result, version = self.server.store.put(map_id, body, self.server.history_interval)
        if result == "trashed":  # apagado em outra aba: não recria por baixo da lixeira
            self._send(410, {"error": "document is in the trash"})
        elif result == "conflict":
            self._send(409, {"version": version})
        else:
            self._send(200, {"version": version})

    # ---- Lixeira: o documento continua no banco com a data de exclusão ----
    def _trash(self, method, rest):
        store = self.server.store
        if not rest:
            self._send(*((200, store.trash()) if method == "GET" else (404, {"error": "not found"})))
            return
        map_id, _, action = rest.partition("/")
        if not ID_RE.match(map_id):
            self._send(400, {"error": "invalid id"})
            return
        if method == "DELETE" and not action:
            self._send(*((204, None) if store.purge(map_id) else (404, {"error": "not found"})))
        elif method == "POST" and action == "restore":
            self._send(*((200, {"id": map_id}) if store.restore(map_id) else (404, {"error": "not found"})))
        else:
            self._send(404, {"error": "not found"})

    def _duplicate(self, map_id):
        new_id = self.server.store.duplicate(map_id)
        self._send(*((201, {"id": new_id}) if new_id else (404, {"error": "not found"})))

    def _history(self, method, map_id, sub):
        # GET /api/maps/<id>/history (lista) e /api/maps/<id>/history/<versão> (conteúdo)
        if method != "GET":
            self._send(404, {"error": "not found"})
            return
        _, _, version = sub.partition("/")
        if not version:
            self._send(200, self.server.store.history(map_id))
            return
        if not version.isdigit():
            self._send(400, {"error": "invalid version"})
            return
        data = self.server.store.history_version(map_id, int(version))
        self._send(*((200, data) if data is not None else (404, {"error": "not found"})))

    def _files(self, method, map_id, sub):
        # /api/maps/<id>/files (POST) e /api/maps/<id>/files/<arquivo> (GET); só de documento ativo
        folder = self.server.store.files(map_id)
        if method == "POST" and sub == "files":
            # cabeçalho próprio obrigatório: o navegador faz preflight (que não autorizamos) para outros sites
            if "X-Filename" not in self.headers:
                self._send(400, {"error": "missing X-Filename"})
                return
            if not self.server.store.exists(map_id):
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
        if not path.is_file() or not self.server.store.exists(map_id):
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

    def _folders(self, method):
        if method == "GET":
            self._send(200, self.server.store.folders())
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.close_connection = True
            self._send(413, {"error": "too large"})
            return
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError:
            body = None
        if not valid_folders(body):
            self._send(400, {"error": "invalid folders"})
            return
        ok, saved = self.server.store.put_folders(body)
        self._send(200 if ok else 409, saved)

    def _send(self, status, payload):
        data = b"" if payload is None else json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        if payload is not None:
            self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def make_server(data_dir: Path, port: int, host: str = "127.0.0.1", files_dir: Path | None = None) -> ThreadingHTTPServer:
    # banco em <dados>/brainstorm.db; anexos em <dados>/attachments (ou files_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    store = Store(data_dir / "brainstorm.db", files_dir or data_dir / "attachments")
    if migrated := migrate_legacy(store, data_dir):
        print(f"{migrated} documentos do formato antigo importados para o banco (backup em {data_dir}/legacy-*)", flush=True)
    server = ThreadingHTTPServer((host, port), partial(Handler, directory=str(ROOT / "static")))
    server.store = store
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
    # GALHO_HOST/GALHO_DATA: no Docker, escuta em 0.0.0.0 dentro do container e guarda em /data
    # GALHO_FILES: pasta dos anexos (ex.: um disco externo); padrão <dados>/attachments
    host = os.environ.get("GALHO_HOST", "127.0.0.1")
    files = os.environ.get("GALHO_FILES")
    server = make_server(Path(os.environ.get("GALHO_DATA") or ROOT / "data"), port, host, Path(files) if files else None)
    # recarrega sozinho ao editar o servidor (HTML/CSS/JS já vêm frescos a cada F5)
    watch([Path(__file__).resolve()], restart)
    print(f"Abra http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
