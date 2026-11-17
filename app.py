"""Servidor local do editor de mapas mentais: arquivos estáticos + API JSON."""
import hmac
import json
import mimetypes
import os
import posixpath
import re
import sys
import threading
import time
import uuid
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from store import ID_RE, Store, migrate_legacy, valid_doc, valid_folders

ROOT = Path(__file__).resolve().parent
MAX_BODY = 5_000_000
MAX_LOGIN_BODY = 10_000
START = f"{os.getpid()}-{time.time()}"  # muda a cada partida/reinício do servidor
MAX_FILE = 20_000_000
HISTORY_INTERVAL = 120  # s entre cópias no histórico (autosave grava a cada edição)
FILE_RE = re.compile(r"[a-f0-9]{32}(\.[a-z0-9]{1,10})?")
# só estes tipos abrem no navegador; o resto (inclusive SVG/HTML) sempre baixa como anexo
# login: cookie de sessão, páginas abertas sem login e limite de tentativas erradas (um só, global)
SESSION_COOKIE = "brainstorm_session"
SESSION_RE = re.compile(rf"(?:^|;)\s*{SESSION_COOKIE}=([A-Za-z0-9_-]+)\s*(?:;|$)")
SESSION_TTL = 30 * 86400
PUBLIC = {"/login.html", "/login.js", "/style.css"}  # e /fonts/ (o visual da página de login)
LOGIN_MAX_FAILS, LOGIN_WINDOW = 10, 600
# scripts só do próprio app; estilo inline é usado nos SVG; data:/blob: para exportar PNG e baixar arquivos
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "font-src 'self' data:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'none'; "
       "form-action 'self'; frame-ancestors 'none'")
INLINE = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}


class Handler(SimpleHTTPRequestHandler):
    timeout = 30  # s sem tráfego: conexão parada não segura uma thread para sempre
    server_version, sys_version = "Brainstorm", ""  # sem a versão do Python no cabeçalho Server

    def end_headers(self):
        # arquivos do app: o navegador sempre confere se mudaram (304 barato) em vez de usar JS antigo do cache;
        # respostas da API (dados do usuário) não ficam em cache nenhum. Exceção: o anexo entregue com
        # sucesso (id único, nunca muda) fica 1 h só no cache do próprio navegador, senão cada redesenho
        # baixaria as imagens de novo; erros (401, 404) nunca ficam em cache e o "Sair" limpa o cache
        path = urlsplit(getattr(self, "path", "")).path
        self.send_header("Cache-Control", getattr(self, "cache_control", None)
                         or ("no-store" if path.startswith("/api/") else "no-cache"))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)
        super().end_headers()

    def do_GET(self):
        if self._foreign_host() or self._gate("GET") or self._api("GET"):
            return
        super().do_GET()

    def do_HEAD(self):
        if self._foreign_host() or self._gate("HEAD"):
            return
        super().do_HEAD()

    def list_directory(self, path):
        self.send_error(404)  # sem listagem de pastas

    def do_PUT(self):
        self._foreign_host() or self._foreign_origin() or self._gate("PUT") or self._api("PUT") or self._send(404, {"error": "not found"})

    def do_POST(self):
        self._foreign_host() or self._foreign_origin() or self._gate("POST") or self._api("POST") or self._send(404, {"error": "not found"})

    def do_DELETE(self):
        self._foreign_host() or self._foreign_origin() or self._gate("DELETE") or self._api("DELETE") or self._send(404, {"error": "not found"})

    # ---- Login (só quando BRAINSTORM_USER/BRAINSTORM_PASSWORD estão definidos) ----
    def _gate(self, method):
        # True = já respondeu: login/logout, ou falta de sessão (401 na API, página de login no resto)
        path = urlsplit(self.path).path
        if path == "/api/login" and method == "POST":
            self._login()
            return True
        if path == "/api/logout" and method == "POST":
            self._logout()
            return True
        # público só se o arquivo que será servido (translate_path desfaz "%2e", ".." e "//") é o mesmo
        # conferido aqui: /fonts/../app.js não passa
        public = (path in PUBLIC or path.startswith("/fonts/")) and path == posixpath.normpath(unquote(path)) \
            and self.translate_path(self.path) == os.path.join(self.directory, path[1:])
        if not self.server.auth or public or self._logged_in():
            return False
        if path.startswith("/api/"):
            self._send(401, {"error": "login required"})
        else:
            self.send_response(302)
            self.send_header("Location", "/login.html")
            self.send_header("Content-Length", "0")
            self.end_headers()
        return True

    def _token(self):
        # só o nosso cookie: outro cookie malformado no mesmo cabeçalho (localhost divide cookies entre portas)
        # não derruba a sessão
        m = SESSION_RE.search(self.headers.get("Cookie") or "")
        return m and m[1]

    def _logged_in(self):
        token = self._token()
        return bool(token) and self.server.store.session_ok(token)

    def _login(self):
        if not self.server.auth:
            self._send(404, {"error": "login disabled"})
            return
        length = self._length(MAX_LOGIN_BODY)
        if length is None:
            return
        now = time.time()
        # a tentativa é reservada (contada como erro) antes de conferir a senha, na mesma trava da
        # checagem: tentativas simultâneas não passam do limite; acertar zera a contagem. Contagem única
        # (o app tem um usuário só): por endereço, um processo local trocaria de 127.x.y.z a cada tentativa
        with self.server.login_lock:
            fails = [t for t in self.server.login_fails if now - t < LOGIN_WINDOW]
            locked = len(fails) >= LOGIN_MAX_FAILS
            self.server.login_fails = fails if locked else fails + [now]
        if locked:
            self._send(429, {"error": "too many attempts"}, {"Retry-After": str(int(LOGIN_WINDOW - (now - fails[0])) + 1)})
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, RecursionError):
            body = {}
        user, password = (body.get(k) if isinstance(body, dict) else None for k in ("user", "password"))
        want_user, want_password = self.server.auth
        # compara os dois sempre e em tempo constante: a resposta não indica qual dos dois errou
        ok = isinstance(user, str) and isinstance(password, str)
        ok = hmac.compare_digest((user if ok else "").encode(), want_user.encode()) & \
            hmac.compare_digest((password if ok else "").encode(), want_password.encode()) & ok
        if not ok:
            time.sleep(self.server.login_delay)  # atrasa quem tenta adivinhar (o erro já foi contado)
            self._send(401, {"error": "invalid credentials"})
            return
        with self.server.login_lock:
            self.server.login_fails = []
        token = self.server.store.create_session(SESSION_TTL)
        # HttpOnly: o JavaScript não lê; SameSite=Strict: outros sites não mandam o cookie
        self._send(200, {"ok": True}, {"Set-Cookie": f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL}"})

    def _logout(self):
        token = self._token()
        if token:
            self.server.store.end_session(token)
        # Clear-Site-Data: tira do navegador as imagens/anexos guardados em cache durante a sessão
        self._send(204, None, {"Set-Cookie": f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
                               "Clear-Site-Data": '"cache"'})

    def _length(self, limit):
        # tamanho do corpo, ou None (já respondeu). Só dígitos: int() aceitaria "-1", e read(-1) lê sem limite
        raw = self.headers.get("Content-Length") or "0"
        if not re.fullmatch(r"[0-9]+", raw):
            self.close_connection = True
            self._send(400, {"error": "invalid Content-Length"})
        elif len(raw) > 18 or int(raw) > limit:
            self.close_connection = True
            self._send(413, {"error": "too large"})
        else:
            return int(raw)

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
        if path == "/api/session" and method == "GET":  # a página sabe se mostra o botão Sair
            self._send(200, {"auth": bool(self.server.auth)})
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
        if not ID_RE.fullmatch(map_id):
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
        length = self._length(MAX_BODY)
        if length is None:
            return
        try:
            body = json.loads(self.rfile.read(length))
        except (ValueError, RecursionError):
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
        if not ID_RE.fullmatch(map_id):
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
        if not re.fullmatch(r"[0-9]{1,9}", version):
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
            length = self._length(MAX_FILE)
            if length is None:
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
        if not FILE_RE.fullmatch(file_id):
            self._send(400, {"error": "invalid file id"})
            return
        path = folder / file_id
        if not path.is_file() or not self.server.store.exists(map_id):
            self._send(404, {"error": "not found"})
            return
        data = path.read_bytes()
        inline = INLINE.get(path.suffix)
        self.cache_control = "private, max-age=3600"
        self.send_response(200)
        self.send_header("Content-Type", inline or "application/octet-stream")
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
        length = self._length(MAX_BODY)
        if length is None:
            return
        try:
            body = json.loads(self.rfile.read(length))
        except (ValueError, RecursionError):
            body = None
        if not valid_folders(body):
            self._send(400, {"error": "invalid folders"})
            return
        ok, saved = self.server.store.put_folders(body)
        self._send(200 if ok else 409, saved)

    def _send(self, status, payload, headers=None):
        data = b"" if payload is None else json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        if payload is not None:
            self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)


def make_server(data_dir: Path, port: int, host: str = "127.0.0.1", files_dir: Path | None = None,
                auth: tuple[str, str] | None = None) -> ThreadingHTTPServer:
    # banco em <dados>/brainstorm.db; anexos em <dados>/attachments (ou files_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    store = Store(data_dir / "brainstorm.db", files_dir or data_dir / "attachments")
    if migrated := migrate_legacy(store, data_dir):
        print(f"{migrated} documentos do formato antigo importados para o banco (backup em {data_dir}/legacy-*)", flush=True)
    server = ThreadingHTTPServer((host, port), partial(Handler, directory=str(ROOT / "static")))
    server.store = store
    server.auth = auth  # (usuário, senha) ou None = sem login
    if auth:
        store.reset_sessions_if_auth_changed(*auth)  # trocou usuário/senha: todo mundo entra de novo
    server.login_delay, server.login_fails, server.login_lock = 1.0, [], threading.Lock()
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


def load_env(path):
    """Lê KEY=valor do .env (comentários, aspas e "export" opcionais); variável já definida no ambiente vence."""
    if not path.is_file():
        return
    for line in path.read_text("utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.removeprefix("export ").partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        os.environ.setdefault(key, value)


def main():
    load_env(ROOT / ".env")
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    # BRAINSTORM_HOST/BRAINSTORM_DATA: no Docker, escuta em 0.0.0.0 dentro do container e guarda em /data
    # BRAINSTORM_FILES: pasta dos anexos (ex.: um disco externo); padrão <dados>/attachments
    host = os.environ.get("BRAINSTORM_HOST", "127.0.0.1")
    files = os.environ.get("BRAINSTORM_FILES")
    user, password = os.environ.get("BRAINSTORM_USER", ""), os.environ.get("BRAINSTORM_PASSWORD", "")
    if bool(user) != bool(password):
        sys.exit("Defina BRAINSTORM_USER e BRAINSTORM_PASSWORD juntos (no .env ou no ambiente), ou nenhum dos dois.")
    if not user:
        print("Aviso: sem BRAINSTORM_USER/BRAINSTORM_PASSWORD, o app abre sem login.", flush=True)
    server = make_server(Path(os.environ.get("BRAINSTORM_DATA") or ROOT / "data"), port, host,
                         Path(files) if files else None, (user, password) if user else None)
    # recarrega sozinho ao editar o servidor (HTML/CSS/JS já vêm frescos a cada F5)
    watch([Path(__file__).resolve()], restart)
    print(f"Abra http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
