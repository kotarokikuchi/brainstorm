"""Brainstorm storage: SQLite (documents, history, trash, folders) + attachments folder.

Everything that is not an attached file lives in a single database (easy to copy/archive); images and
attachments live in <attachments folder>/<document id>/<file>.
"""
import hashlib
import json
import re
import secrets
import shutil
from contextlib import contextmanager
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

HISTORY_MAX = 50  # versions kept per document
ID_RE = re.compile(r"[a-z0-9-]{1,64}")  # document and folder id (always used with fullmatch)
MAX_FOLDERS = 2000

SCHEMA = """
CREATE TABLE IF NOT EXISTS docs (
    id      TEXT PRIMARY KEY,
    type    TEXT NOT NULL,             -- map | board | skill
    title   TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated REAL NOT NULL,             -- epoch of the last write
    deleted REAL,                      -- NULL = active; set = in the trash since then
    body    TEXT NOT NULL              -- document JSON
);
CREATE TABLE IF NOT EXISTS history (
    doc_id  TEXT NOT NULL,
    version INTEGER NOT NULL,
    saved   REAL NOT NULL,             -- when this version was saved
    body    TEXT NOT NULL,
    label   TEXT,                      -- NULL = automatic version; set = named version (never pruned)
    PRIMARY KEY (doc_id, version)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,       -- sha256 of the cookie (the cookie itself is never stored)
    expires    REAL NOT NULL
);
-- settings holding secrets (LLM keys, backup storage): never included in the backup
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""
SCHEMA_VERSION = 1  # meta.schema: bumped on every table change (restore refuses a backup with a newer schema)

EMPTY_FOLDERS = {"version": 0, "folders": [], "place": {}}


def migrate(db):
    """Create what is missing (tables, columns) and bump meta.schema; used when opening the database and on restore."""
    db.executescript(SCHEMA)
    if "label" not in [c[1] for c in db.execute("PRAGMA table_info(history)")]:
        db.execute("ALTER TABLE history ADD COLUMN label TEXT")  # database created before named versions existed
    db.execute("INSERT INTO meta VALUES ('schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value "
               "WHERE CAST(meta.value AS INTEGER) < CAST(excluded.value AS INTEGER)", (str(SCHEMA_VERSION),))


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


def doc_type(body):
    return body["type"] if body.get("type") in ("board", "skill") else "map"


def doc_title(body):
    return body.get("title", "") if body.get("type") in ("board", "skill") else body["root"].get("text", "")


def doc_size(body):
    # map topics or board elements (shown in the history)
    if body.get("type") == "skill":
        return len(body["content"])
    count = lambda n: 1 + sum(count(c) for c in n.get("children", []))
    return len(body["elements"]) if body.get("type") == "board" else count(body["root"])


def load_json(raw):
    """JSON from outside (request body, backup, old format), or None if it is not acceptable. Besides
    invalid JSON, rejects NaN/Infinity (including 1e400; the browser cannot read it) and a lone surrogate
    ("\\ud800": it does not encode to UTF-8, so the database and the response would drop the connection)."""
    try:
        data = json.loads(raw)
        json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
    except (ValueError, TypeError, RecursionError):  # UnicodeError is also a ValueError
        return None
    return data


def valid_tags(tags):
    return (isinstance(tags, list) and len(tags) <= 30 and len(set(map(str, tags))) == len(tags)
            and all(isinstance(t, str) and 0 < len(t) <= 40 and t == t.strip() for t in tags))


# documents: mind map ({root}), drawing board ({type: "board", title, elements})
# or skill ({type: "skill", title, tags, content})
def valid_doc(body):
    if not (isinstance(body, dict) and isinstance(body.get("version"), int)):
        return False
    if body.get("type") == "skill":
        return (isinstance(body.get("title"), str) and len(body["title"]) <= 200
                and valid_tags(body.get("tags")) and isinstance(body.get("content"), str))
    if body.get("type", "map") == "board":
        return isinstance(body.get("elements"), list) and isinstance(body.get("title", ""), str)
    return (body.get("type", "map") == "map" and isinstance(body.get("root"), dict)
            and isinstance(body["root"].get("text", ""), str))


# folders: {version, folders: [{id, name, parent}], place: {document id: folder id}}
# (kept outside the documents: moving does not touch the version of a map open in another tab)
def valid_folders(body):
    if not (isinstance(body, dict) and isinstance(body.get("version"), int)
            and isinstance(body.get("folders"), list) and len(body["folders"]) <= MAX_FOLDERS
            and isinstance(body.get("place"), dict)):
        return False
    parents = {}
    for f in body["folders"]:
        if not (isinstance(f, dict) and isinstance(f.get("id"), str) and ID_RE.fullmatch(f["id"])
                and isinstance(f.get("name"), str) and 0 < len(f["name"].strip()) <= 200
                and (f.get("parent") is None or isinstance(f.get("parent"), str))):
            return False
        if f["id"] in parents:
            return False
        parents[f["id"]] = f.get("parent")
    checked = set()  # folders whose path to the root was already checked: each one is walked only once
    for fid in parents:  # the parent must exist and there can be no cycle (a folder inside itself)
        seen, cur = set(), fid
        while cur is not None and cur not in checked:
            if cur in seen or cur not in parents:
                return False
            seen.add(cur)
            cur = parents[cur]
        checked |= seen
    return all(isinstance(k, str) and ID_RE.fullmatch(k) and isinstance(v, str) and v in parents
               for k, v in body["place"].items())


def _with_id(row, doc_id):
    # the id always comes from the row: a restored body with another id would make the page save to another route
    if not row:
        return None
    body = json.loads(row["body"])
    return {**body, "id": doc_id} if isinstance(body, dict) else body


class Store:
    def __init__(self, db_path: Path, files_dir: Path):
        self.db_path, self.files_dir = Path(db_path), Path(files_dir)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.files_dir.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.execute("PRAGMA journal_mode=WAL")  # reads do not wait for writes
            migrate(db)

    @contextmanager
    def _db(self):
        # one connection per operation (the server is multithreaded); each "with" = one transaction
        db = sqlite3.connect(self.db_path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def files(self, doc_id):
        return self.files_dir / doc_id

    # ---- documents ----
    def get(self, doc_id):
        with self._db() as db:
            row = db.execute("SELECT body FROM docs WHERE id = ? AND deleted IS NULL", (doc_id,)).fetchone()
        return _with_id(row, doc_id)

    def exists(self, doc_id):
        return self.get(doc_id) is not None

    def put(self, doc_id, body, history_interval):
        """Save if body["version"] is the current version. Returns ("ok", new), ("conflict", current) or ("trashed", None)."""
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")  # version check and write with no other write in between
            row = db.execute("SELECT version, updated, deleted, body FROM docs WHERE id = ?", (doc_id,)).fetchone()
            if row and row["deleted"] is not None:
                return "trashed", None
            stored = row["version"] if row else 0
            if body["version"] != stored:
                return "conflict", stored
            if row:
                self._snapshot(db, doc_id, row, history_interval)
            body["version"], body["id"] = stored + 1, doc_id
            db.execute(
                "INSERT INTO docs (id, type, title, version, updated, deleted, body) VALUES (?, ?, ?, ?, ?, NULL, ?) "
                "ON CONFLICT(id) DO UPDATE SET type=excluded.type, title=excluded.title, version=excluded.version, "
                "updated=excluded.updated, body=excluded.body",
                (doc_id, doc_type(body), doc_title(body), body["version"], time.time(), json.dumps(body, ensure_ascii=False)))
        return "ok", body["version"]

    def _snapshot(self, db, doc_id, row, interval):
        # keep the version about to be overwritten, at most one every `interval` seconds
        last = db.execute("SELECT MAX(saved) FROM history WHERE doc_id = ? AND label IS NULL", (doc_id,)).fetchone()[0]
        if last is not None and time.time() - last < interval:
            return
        db.execute("INSERT INTO history (doc_id, version, saved, body) VALUES (?, ?, ?, ?) ON CONFLICT(doc_id, version) DO NOTHING",
                   (doc_id, row["version"], row["updated"], row["body"]))  # does not erase the label of a named version
        db.execute("DELETE FROM history WHERE doc_id = ? AND label IS NULL AND version NOT IN "
                   "(SELECT version FROM history WHERE doc_id = ? AND label IS NULL ORDER BY version DESC LIMIT ?)",
                   (doc_id, doc_id, HISTORY_MAX))

    def list_docs(self):
        with self._db() as db:
            rows = db.execute("SELECT id, title, type, updated, CASE WHEN type = 'skill' THEN body END AS body "
                              "FROM docs WHERE deleted IS NULL ORDER BY updated DESC").fetchall()
        out = [{"id": r["id"], "title": r["title"], "type": r["type"], "updated": iso(r["updated"])} for r in rows]
        for item, r in zip(out, rows):
            if r["body"]:
                item["tags"] = json.loads(r["body"]).get("tags", [])
        return out

    def duplicate(self, doc_id, suffix=" (copy)"):
        body = self.get(doc_id)
        if body is None:
            return None
        new_id = f"{doc_id[:48]}-copy-{uuid.uuid4().hex[:6]}"
        if body.get("type") in ("board", "skill"):
            body["title"] = f"{body.get('title', '')}{suffix}"
        else:
            body["root"]["text"] = f"{body['root'].get('text', '')}{suffix}"
        body["version"] = 0
        if self.files(doc_id).exists():
            shutil.copytree(self.files(doc_id), self.files(new_id))  # images/attachments point to the document
        self.put(new_id, body, 0)
        return new_id

    # ---- trash: the document only gets a date in "deleted"; history and attachments stay where they are ----
    def delete(self, doc_id):
        with self._db() as db:
            return db.execute("UPDATE docs SET deleted = ? WHERE id = ? AND deleted IS NULL", (time.time(), doc_id)).rowcount > 0

    def trash(self):
        with self._db() as db:
            rows = db.execute("SELECT id, title, deleted FROM docs WHERE deleted IS NOT NULL ORDER BY deleted DESC").fetchall()
        return [{"id": r["id"], "title": r["title"], "deleted": iso(r["deleted"])} for r in rows]

    def restore(self, doc_id):
        with self._db() as db:
            return db.execute("UPDATE docs SET deleted = NULL WHERE id = ? AND deleted IS NOT NULL", (doc_id,)).rowcount > 0

    def purge(self, doc_id):
        with self._db() as db:
            gone = db.execute("DELETE FROM docs WHERE id = ? AND deleted IS NOT NULL", (doc_id,)).rowcount > 0
            if gone:
                db.execute("DELETE FROM history WHERE doc_id = ?", (doc_id,))
        if gone:
            shutil.rmtree(self.files(doc_id), ignore_errors=True)
        return gone

    # ---- history ----
    def history(self, doc_id):
        with self._db() as db:
            rows = db.execute("SELECT version, saved, body, label FROM history WHERE doc_id = ? ORDER BY version DESC", (doc_id,)).fetchall()
        out = []
        for r in rows:
            try:
                body = json.loads(r["body"])
                title, nodes = doc_title(body), doc_size(body)
            except (ValueError, KeyError, TypeError, AttributeError, RecursionError):
                title, nodes = "", 0  # a malformed version does not break the whole list
            out.append({"version": r["version"], "saved": iso(r["saved"]), "title": title, "nodes": nodes, "label": r["label"]})
        return out

    def label_version(self, doc_id, label):
        """Name the current version of the document (None keeps the existing name). Returns the version, or None if the document does not exist."""
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT version, updated, body FROM docs WHERE id = ? AND deleted IS NULL", (doc_id,)).fetchone()
            if not row:
                return None
            db.execute("INSERT INTO history (doc_id, version, saved, body, label) VALUES (?, ?, ?, ?, ?) "
                       "ON CONFLICT(doc_id, version) DO UPDATE SET label = COALESCE(excluded.label, history.label)",
                       (doc_id, row["version"], row["updated"], row["body"], label))
        return row["version"]

    def history_version(self, doc_id, version):
        with self._db() as db:
            row = db.execute("SELECT body FROM history WHERE doc_id = ? AND version = ?", (doc_id, version)).fetchone()
        return _with_id(row, doc_id)

    # ---- login sessions (they survive server restarts) ----
    @staticmethod
    def _hash(token):
        return hashlib.sha256(token.encode()).hexdigest()

    def create_session(self, ttl):
        token = secrets.token_urlsafe(32)
        with self._db() as db:
            db.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
            db.execute("INSERT INTO sessions VALUES (?, ?)", (self._hash(token), time.time() + ttl))
        return token

    def session_ok(self, token):
        with self._db() as db:
            row = db.execute("SELECT expires FROM sessions WHERE token_hash = ?", (self._hash(token),)).fetchone()
        return bool(row) and row["expires"] > time.time()

    def reset_sessions_if_auth_changed(self, user, password):
        # fingerprint of the credentials with scrypt (slow) and a random salt for this installation: a copy of
        # the database (e.g. an external backup) cannot be used to test passwords quickly. If it changed, drop the sessions.
        with self._db() as db:
            row = db.execute("SELECT value FROM meta WHERE key = 'auth_fingerprint'").fetchone()
            stored = json.loads(row["value"]) if row and row["value"].startswith("{") else None
            salt = bytes.fromhex(stored["salt"]) if stored else secrets.token_bytes(16)
            fp = hashlib.scrypt(f"{user}\0{password}".encode(), salt=salt, n=2**14, r=8, p=1).hex()
            if not stored or not secrets.compare_digest(stored["fp"], fp):
                db.execute("DELETE FROM sessions")
                db.execute("INSERT OR REPLACE INTO meta VALUES ('auth_fingerprint', ?)",
                           (json.dumps({"salt": salt.hex(), "fp": fp}),))

    def end_session(self, token):
        with self._db() as db:
            db.execute("DELETE FROM sessions WHERE token_hash = ?", (self._hash(token),))

    # ---- settings: one JSON per key ----
    def setting(self, key):
        with self._db() as db:
            row = db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else None

    def set_setting(self, key, value):
        with self._db() as db:
            if value is None:
                db.execute("DELETE FROM settings WHERE key = ?", (key,))
            else:
                db.execute("INSERT OR REPLACE INTO settings VALUES (?, ?)", (key, json.dumps(value, ensure_ascii=False)))

    # ---- folders: the whole tree in one JSON (validated by the server) ----
    def folders(self):
        with self._db() as db:
            row = db.execute("SELECT value FROM meta WHERE key = 'folders'").fetchone()
        return json.loads(row["value"]) if row else dict(EMPTY_FOLDERS)

    def put_folders(self, body):
        """Save if the version matches. Returns (True, saved) or (False, current)."""
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT value FROM meta WHERE key = 'folders'").fetchone()
            stored = json.loads(row["value"]) if row else dict(EMPTY_FOLDERS)
            if body["version"] != stored.get("version", 0):
                return False, stored
            body["version"] += 1
            db.execute("INSERT OR REPLACE INTO meta VALUES ('folders', ?)", (json.dumps(body, ensure_ascii=False),))
        return True, body


# ---- Migration from the old format (one .json per document) ----
def _read_json(file):
    if file.is_symlink():
        return None
    try:
        data = load_json(file.read_bytes())
    except OSError:
        return None
    return data if isinstance(data, dict) else None


def _real_dir(path):
    # a real directory: symlinks are not followed (they could point outside the data)
    return path.is_dir() and not path.is_symlink()


def migrate_legacy(store: Store, data_dir: Path):
    """Import data/*.json, history/, trash/, files/ and folders/ into the database and the attachments folder.

    Only what passes the same validation as the API (id, document, folders) and is not a symlink gets in.
    Nothing is deleted: the old format is moved whole into data/legacy-<date>/. Safe to run again
    after an interruption (INSERT OR IGNORE; an attachment already copied is not copied again).
    Returns how many documents were imported (0 if there was nothing old).
    """
    data_dir = Path(data_dir)
    docs = sorted(data_dir.glob("*.json"))
    old_dirs = [data_dir / n for n in ("history", "trash", "files", "folders") if (data_dir / n).exists()]
    if not docs and not old_dirs:
        return 0
    imported = 0
    with store._db() as db:
        def add_doc(doc_id, file, deleted):
            body = _read_json(file)
            if not (ID_RE.fullmatch(doc_id) and valid_doc(body)):
                return False  # invalid id or corrupted: stays in the backup only
            body["id"] = doc_id
            cur = db.execute("INSERT OR IGNORE INTO docs VALUES (?, ?, ?, ?, ?, ?, ?)",
                             (doc_id, doc_type(body), doc_title(body), body["version"], file.stat().st_mtime, deleted,
                              json.dumps(body, ensure_ascii=False)))
            return cur.rowcount > 0

        def add_history(doc_id, folder):
            for f in folder.glob("*.json") if _real_dir(folder) else []:
                body = _read_json(f)
                if body is not None and re.fullmatch(r"[0-9]{1,9}", f.stem):
                    db.execute("INSERT OR IGNORE INTO history (doc_id, version, saved, body) VALUES (?, ?, ?, ?)",
                               (doc_id, int(f.stem), f.stat().st_mtime, json.dumps(body, ensure_ascii=False)))

        for f in docs:
            if add_doc(f.stem, f, None):
                imported += 1
                add_history(f.stem, data_dir / "history" / f.stem)
        trash = data_dir / "trash"
        for box in sorted(trash.iterdir()) if _real_dir(trash) else []:
            # in the trash with the same id as an active document: stays in the backup only
            if _real_dir(box) and (box / "map.json").exists() and add_doc(box.name, box / "map.json", box.stat().st_mtime):
                imported += 1
                add_history(box.name, box / "history")
        tree = _read_json(data_dir / "folders" / "tree.json") if _real_dir(data_dir / "folders") else None
        if valid_folders(tree):
            db.execute("INSERT OR IGNORE INTO meta VALUES ('folders', ?)", (json.dumps(tree, ensure_ascii=False),))

    # attachments: copied (the original stays in the backup); with the database already written, an interruption loses nothing
    sources = [(d.name, d) for d in (data_dir / "files").iterdir()] if _real_dir(data_dir / "files") else []
    sources += [(b.name, b / "files") for b in trash.iterdir() if _real_dir(b)] if _real_dir(trash) else []
    skip_links = lambda folder, names: [n for n in names if (Path(folder) / n).is_symlink()]
    for doc_id, src in sources:
        if ID_RE.fullmatch(doc_id) and _real_dir(src) and not store.files(doc_id).exists():
            shutil.copytree(src, store.files(doc_id), ignore=skip_links)

    backup = data_dir / f"legacy-{time.strftime('%Y%m%d-%H%M%S')}"
    backup.mkdir()
    for p in docs + old_dirs:
        shutil.move(str(p), backup / p.name)
    return imported
