"""Local server for the mind-map editor: static files + JSON API."""
import hmac
import ipaddress
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

from backup import NAME_RE, Backup, BackupError, Busy, NotConfigured, clean_config, hint, text_ok
from s3 import S3Error
from store import ID_RE, Store, load_json, migrate_legacy, valid_doc, valid_folders

ROOT = Path(__file__).resolve().parent
MAX_BODY = 5_000_000
MAX_LOGIN_BODY = 10_000
START = f"{os.getpid()}-{time.time()}"  # changes on every server start/restart
MAX_FILE = 20_000_000
HISTORY_INTERVAL = 120  # seconds between history snapshots (autosave writes on every edit)
FILE_RE = re.compile(r"[a-f0-9]{32}(\.[a-z0-9]{1,10})?")
# only these types open in the browser; everything else (including SVG/HTML) is always downloaded as an attachment
# login: session cookie, pages open without login, and the failed-attempt limit (a single, global one)
SESSION_COOKIE = "brainstorm_session"
SESSION_RE = re.compile(rf"(?:^|;)\s*{SESSION_COOKIE}=([A-Za-z0-9_-]+)\s*(?:;|$)")
SESSION_TTL = 30 * 86400
PUBLIC = {"/login.html", "/login.js", "/style.css", "/i18n.js"}  # plus /fonts/ and /locales/ (look and texts of the login page)
PUBLIC_DIRS = ("/fonts/", "/locales/")
# the one from .env.example (and the one it shipped with before v1.7.2): the app refuses to start with them
EXAMPLE_PASSWORDS = {"change-this-password", "troque-esta-senha"}
LOGIN_MAX_FAILS, LOGIN_WINDOW = 10, 600
# scripts only from the app itself; inline style is used in SVGs; data:/blob: to export PNG and download files
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "font-src 'self' data:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'none'; "
       "form-action 'self'; frame-ancestors 'none'")
LLM_PROVIDERS = ("anthropic", "openai", "gemini", "deepseek", "openrouter", "custom")  # custom = OpenAI-compatible (baseUrl)
INLINE = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}


class Handler(SimpleHTTPRequestHandler):
    timeout = 30  # seconds without traffic: a stalled connection does not hold a thread forever
    server_version, sys_version = "Brainstorm", ""  # no Python version in the Server header

    def end_headers(self):
        # app files: the browser always revalidates them (cheap 304) instead of using stale cached JS;
        # API responses (user data) are never cached. Exception: an attachment delivered
        # successfully (unique id, never changes) is cached for 1 h in the browser only, otherwise every
        # redraw would download the images again; errors (401, 404) are never cached and "Log out" clears the cache
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
        self.send_error(404)  # no directory listing

    def do_PUT(self):
        self._foreign_host() or self._foreign_origin() or self._gate("PUT") or self._api("PUT") or self._send(404, {"error": "not found"})

    def do_POST(self):
        self._foreign_host() or self._foreign_origin() or self._gate("POST") or self._api("POST") or self._send(404, {"error": "not found"})

    def do_DELETE(self):
        self._foreign_host() or self._foreign_origin() or self._gate("DELETE") or self._api("DELETE") or self._send(404, {"error": "not found"})

    # ---- Login (only when BRAINSTORM_USER/BRAINSTORM_PASSWORD are set) ----
    def _gate(self, method):
        # True = already responded: login/logout, or no session (401 on the API, login page for the rest)
        path = urlsplit(self.path).path
        if path == "/api/login" and method == "POST":
            self._login()
            return True
        if path == "/api/logout" and method == "POST":
            self._logout()
            return True
        # public only if the file that will be served (translate_path resolves "%2e", ".." and "//") is the same
        # one checked here: /fonts/../app.js does not pass
        public = (path in PUBLIC or path.startswith(PUBLIC_DIRS)) and path == posixpath.normpath(unquote(path)) \
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
        # only our own cookie: another malformed cookie in the same header (localhost shares cookies across ports)
        # must not break the session
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
        # the attempt is reserved (counted as a failure) before checking the password, under the same lock as
        # the check: simultaneous attempts cannot get past the limit; a correct login resets the count. A single
        # global count (the app has one user): per address, a local process could switch 127.x.y.z on every attempt
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
        # always compare both, in constant time: the response does not reveal which one was wrong
        ok = isinstance(user, str) and isinstance(password, str)
        # surrogatepass: a lone surrogate in the JSON becomes bytes (and fails to match) instead of crashing the request
        ok = hmac.compare_digest((user if ok else "").encode(errors="surrogatepass"), want_user.encode()) & \
            hmac.compare_digest((password if ok else "").encode(errors="surrogatepass"), want_password.encode()) & ok
        if not ok:
            time.sleep(self.server.login_delay)  # slows down guessing (the failure was already counted)
            self._send(401, {"error": "invalid credentials"})
            return
        with self.server.login_lock:
            self.server.login_fails = []
        token = self.server.store.create_session(SESSION_TTL)
        # HttpOnly: JavaScript cannot read it; SameSite=Strict: other sites do not send the cookie
        self._send(200, {"ok": True}, {"Set-Cookie": f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL}"})

    def _logout(self):
        token = self._token()
        if token:
            self.server.store.end_session(token)
        # Clear-Site-Data: drops the images/attachments cached in the browser during the session
        self._send(204, None, {"Set-Cookie": f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
                               "Clear-Site-Data": '"cache"'})

    def _length(self, limit):
        # body size, or None (already responded). Digits only: int() would accept "-1", and read(-1) reads without limit
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
        # a write coming from another origin (a page from another site open in the browser) is refused:
        # the origin must be the page's own address (Host already validated as local)
        if self.headers.get("Origin") in (None, f"http://{self.headers.get('Host')}"):
            return False
        self._send(403, {"error": "forbidden origin"})
        return True

    def _foreign_host(self):
        # blocks DNS rebinding: an external site pointing to 127.0.0.1 arrives with a different Host.
        # Any port is accepted: in Docker the published port may differ from the container's.
        name, sep, port = (self.headers.get("Host") or "").rpartition(":")
        if not sep:
            name, port = self.headers.get("Host") or "", ""
        if name in ("127.0.0.1", "localhost") and (port == "" or port.isdigit()):
            return False
        self._send(403, {"error": "forbidden host"})
        return True

    def _api(self, method):
        path = urlsplit(self.path).path
        if path.startswith(("/api/settings/", "/api/backup/")):
            self._settings(method, path)
            return True
        if self.server.backup.restoring and method in ("PUT", "POST", "DELETE") and path.startswith(("/api/maps", "/api/folders", "/api/trash")):
            # restore in progress: the page autosave retries on its own
            self._send(503, {"error": "restore in progress"}, {"Retry-After": "5"})
            return True
        if path == "/api/trash" or path.startswith("/api/trash/"):
            self._trash(method, path[len("/api/trash"):].strip("/"))
            return True
        if path == "/api/session" and method == "GET":  # lets the page know whether to show the Log out button
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
        body = load_json(self.rfile.read(length))
        if not valid_doc(body):
            self._send(400, {"error": "invalid map"})
            return
        result, version = self.server.store.put(map_id, body, self.server.history_interval)
        if result == "trashed":  # deleted in another tab: do not recreate it behind the trash
            self._send(410, {"error": "document is in the trash"})
        elif result == "conflict":
            self._send(409, {"version": version})
        else:
            self._send(200, {"version": version})

    # ---- Trash: the document stays in the database with its deletion date ----
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
        # optional body {"suffix": "..."}: what to append to the title (in the UI language); invalid or missing = default
        responded, body = self._json()
        if responded:
            return
        suffix = body.get("suffix") if isinstance(body, dict) else None
        if not isinstance(suffix, str) or not 0 < len(suffix) <= 40 or not suffix.isprintable():
            suffix = " (cópia)"
        new_id = self.server.store.duplicate(map_id, suffix)
        self._send(*((201, {"id": new_id}) if new_id else (404, {"error": "not found"})))

    def _history(self, method, map_id, sub):
        # GET /api/maps/<id>/history (list) and /api/maps/<id>/history/<version> (content)
        _, _, version = sub.partition("/")
        if method == "POST" and not version:
            self._label_version(map_id)
            return
        if method != "GET":
            self._send(404, {"error": "not found"})
            return
        if not version:
            self._send(200, self.server.store.history(map_id))
            return
        if not re.fullmatch(r"[0-9]{1,9}", version):
            self._send(400, {"error": "invalid version"})
            return
        data = self.server.store.history_version(map_id, int(version))
        self._send(*((200, data) if data is not None else (404, {"error": "not found"})))

    def _label_version(self, map_id):
        # optional body {"label": "..."}: names the current version; missing or empty = no name
        length = self._length(MAX_LOGIN_BODY)
        if length is None:
            return
        raw = self.rfile.read(length)
        label = None
        if raw:
            body = load_json(raw)
            if not isinstance(body, dict):
                self._send(400, {"error": "invalid body"})
                return
            label = body.get("label")
        if label is not None and not (isinstance(label, str) and len(label) <= 100 and label.isprintable()):
            self._send(400, {"error": "invalid label"})
            return
        if label is not None:
            label = label.strip()
        version = self.server.store.label_version(map_id, label or None)
        self._send(*((201, {"version": version}) if version is not None else (404, {"error": "not found"})))

    def _files(self, method, map_id, sub):
        # /api/maps/<id>/files (POST) and /api/maps/<id>/files/<file> (GET); active documents only
        folder = self.server.store.files(map_id)
        if method == "POST" and sub == "files":
            # custom header required: the browser sends a preflight (which we do not authorize) for other sites
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
        # stamp = server start + newest file in static/ + restores done
        try:
            newest = max((p.stat().st_mtime for p in self.server.static_dir.rglob("*") if p.is_file()), default=0)
        except FileNotFoundError:
            return None  # an editor is swapping the file right now: try again on the next cycle
        return f"{START}-{newest}-{self.server.backup.restores}"  # a restore also reloads the tabs

    def _events(self):
        # Server-Sent Events: the page reloads when the stamp changes (static/ edited or server restarted)
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
                    self.wfile.write(b": ping\n\n")  # detects a closed tab and frees the thread
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
        body = load_json(self.rfile.read(length))
        if not valid_folders(body):
            self._send(400, {"error": "invalid folders"})
            return
        ok, saved = self.server.store.put_folders(body)
        self._send(200 if ok else 409, saved)

    def _json(self, limit=MAX_LOGIN_BODY):
        # (responded?, body): body is None if it is not valid JSON (see load_json)
        length = self._length(limit)
        if length is None:
            return True, None
        return False, load_json(self.rfile.read(length))

    # ---- Settings (secrets are never returned: only the masked tail) ----
    def _settings(self, method, path):
        kind, _, rest = path[len("/api/settings/"):].partition("/") if path.startswith("/api/settings/") else ("", "", "")
        if kind == "llm":
            self._llm(method, rest)
        elif kind == "backup" and not rest and method in ("GET", "PUT"):
            self._backup_config(method)
        elif path == "/api/backup/restore" and method == "POST":
            responded, body = self._json()
            if responded:
                return
            name = body.get("name") if isinstance(body, dict) else None
            if not (isinstance(name, str) and NAME_RE.fullmatch(name)):
                self._send(400, {"error": "invalid backup name"})
                return
            self._backup_call(lambda: self.server.backup.restore(name), view=True)
        elif path in ("/api/backup/run", "/api/backup/list") and method == ("POST" if path.endswith("run") else "GET"):
            self._backup_call(self.server.backup.run if path.endswith("run") else self.server.backup.list, path.endswith("run"))
        else:
            self._send(404, {"error": "not found"})

    def _backup_config(self, method):
        backup = self.server.backup
        if method == "PUT":
            responded, body = self._json()
            if responded:
                return
            cfg = clean_config(body)
            if cfg is None:
                self._send(400, {"error": "invalid backup settings"})
                return
            with self.server.settings_lock:
                backup.save_config(cfg)
        self._send(200, backup.view())

    def _backup_call(self, action, view=False):
        # backup now / bucket listing: synchronous; storage error = 502 with the short message
        try:
            result = action()
        except Busy:
            self._send(409, {"error": "a backup or restore is already running"})
        except NotConfigured:
            self._send(400, {"error": "backup storage is not configured"})
        except (BackupError, S3Error) as e:
            self._send(502, {"error": str(e)})
        except Exception as e:  # type only: the message could contain secrets
            print(f"backup call failed: {type(e).__name__}", flush=True)
            self._send(500, {"error": "unexpected error"})
        else:
            self._send(200, self.server.backup.view() if view else result)

    def _llm(self, method, pid):
        store = self.server.store
        if method == "GET" and not pid:
            providers = (store.setting("llm") or {}).get("providers", {})
            default = (store.setting("llm") or {}).get("default")
            self._send(200, [llm_view(p, providers.get(p, {}), default) for p in LLM_PROVIDERS])
            return
        if pid not in LLM_PROVIDERS or method not in ("PUT", "DELETE"):
            self._send(404, {"error": "not found"})
            return
        body = None
        if method == "PUT":
            responded, body = self._json()
            if responded:
                return
            if not valid_llm(body):
                self._send(400, {"error": "invalid provider settings"})
                return
        with self.server.settings_lock:  # read-modify-write with no other write in between
            llm = store.setting("llm") or {"providers": {}}
            if body is None:
                llm["providers"].pop(pid, None)
                if llm.get("default") == pid:  # without a key it cannot stay the default
                    llm.pop("default")
            else:
                current = llm["providers"].setdefault(pid, {})
                current.update({k: v.strip() for k, v in body.items() if k in ("key", "model", "baseUrl")})
                if body.get("default"):
                    if not current.get("key"):
                        self._send(400, {"error": "provider has no key"})
                        return
                    llm["default"] = pid
            store.set_setting("llm", llm)
        self._send(*((204, None) if body is None else (200, llm_view(pid, llm["providers"][pid], llm.get("default")))))

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


def valid_llm(body):
    # missing key = keep it; empty is not valid (use DELETE to remove)
    return (isinstance(body, dict)
            and ("key" not in body or (text_ok(body["key"], 500) and body["key"].strip() != ""))
            and ("model" not in body or text_ok(body["model"], 200))
            and ("default" not in body or body["default"] is True)  # the default only changes by choosing another one
            and ("baseUrl" not in body or (text_ok(body["baseUrl"], 500)
                                           and (body["baseUrl"] == "" or re.match(r"https?://[^\s/]", body["baseUrl"])))))


def llm_view(pid, p, default=None):
    return {"id": pid, "configured": bool(p.get("key")), "keyHint": hint(p.get("key", "")),
            "model": p.get("model", ""), "baseUrl": p.get("baseUrl", ""), "default": pid == default}


def make_server(data_dir: Path, port: int, host: str = "127.0.0.1", files_dir: Path | None = None,
                auth: tuple[str, str] | None = None) -> ThreadingHTTPServer:
    # database in <data>/brainstorm.db; attachments in <data>/attachments (or files_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    store = Store(data_dir / "brainstorm.db", files_dir or data_dir / "attachments")
    if migrated := migrate_legacy(store, data_dir):
        print(f"{migrated} documents from the old format imported into the database (backup in {data_dir}/legacy-*)", flush=True)
    server = ThreadingHTTPServer((host, port), partial(Handler, directory=str(ROOT / "static")))
    server.store = store
    server.auth = auth  # (user, password) or None = no login
    if auth:
        store.reset_sessions_if_auth_changed(*auth)  # user/password changed: everyone has to log in again
    server.login_delay, server.login_fails, server.login_lock = 1.0, [], threading.Lock()
    server.settings_lock = threading.Lock()
    server.backup = Backup(store)  # the schedule only starts in main() (tests never back up on their own)
    server.data_dir = data_dir
    server.static_dir = ROOT / "static"
    server.history_interval = HISTORY_INTERVAL
    return server


def watch(paths, on_change, interval=1.0):
    """Call on_change (once) when the mtime of any of the files changes. Runs in a daemon thread."""
    def loop():
        before = [p.stat().st_mtime for p in paths]
        while True:
            time.sleep(interval)
            try:
                now = [p.stat().st_mtime for p in paths]
            except FileNotFoundError:
                continue  # an editor is saving (file swapped midway): try again
            if now != before:
                on_change()
                return
    threading.Thread(target=loop, daemon=True).start()


def restart():
    print("app.py changed — restarting the server…", flush=True)
    os.execv(sys.executable, [sys.executable, *sys.argv])


def load_env(path):
    """Read KEY=value from .env (comments, quotes and "export" are optional); a variable already set in the environment wins."""
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


def loopback(host):
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host == "localhost"  # "" (all interfaces) and other names: network


def main():
    load_env(ROOT / ".env")
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    # BRAINSTORM_HOST/BRAINSTORM_DATA: in Docker, listens on 0.0.0.0 inside the container and stores in /data
    # BRAINSTORM_FILES: attachments folder (e.g. an external disk); default <data>/attachments
    host = os.environ.get("BRAINSTORM_HOST", "127.0.0.1")
    files = os.environ.get("BRAINSTORM_FILES")
    user, password = os.environ.get("BRAINSTORM_USER", ""), os.environ.get("BRAINSTORM_PASSWORD", "")
    if bool(user) != bool(password):
        sys.exit("Set BRAINSTORM_USER and BRAINSTORM_PASSWORD together (in .env or in the environment), or neither.")
    if password in EXAMPLE_PASSWORDS:
        sys.exit("BRAINSTORM_PASSWORD is still the example password from .env.example: change it to your own.")
    if not user and not loopback(host) and os.environ.get("BRAINSTORM_ALLOW_NO_LOGIN") != "1":
        sys.exit(f"Without BRAINSTORM_USER/BRAINSTORM_PASSWORD the app opens without login, and BRAINSTORM_HOST={host!r} accepts "
                 "connections from other machines. Set the login or, if only this machine can reach the port (e.g. Docker "
                 "published on 127.0.0.1), BRAINSTORM_ALLOW_NO_LOGIN=1.")
    if not user:
        print("Warning: without BRAINSTORM_USER/BRAINSTORM_PASSWORD, the app opens without login.", flush=True)
    server = make_server(Path(os.environ.get("BRAINSTORM_DATA") or ROOT / "data"), port, host,
                         Path(files) if files else None, (user, password) if user else None)
    server.backup.start()
    # reloads itself when the server is edited (HTML/CSS/JS are already fresh on every F5)
    watch([Path(__file__).resolve()], restart)
    print(f"Open http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
