"""Backup to Wasabi (or another S3): one .tar.gz per backup with the secret-free database + the attachments folder.

Schedule (a thread started only by the app's main()), retention of the last N, and restore. A lock allows
one backup/restore at a time. Temporary files live inside the attachments folder (same disk as the heaviest
data), in dot-prefixed folders: the server and the backup itself ignore them (a document id never has a dot).
"""
import hashlib
import json
import os
import re
import shutil
import sqlite3
import tarfile
import threading
import time
from contextlib import closing, suppress
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from s3 import S3, S3Error
from store import ID_RE, SCHEMA_VERSION, load_json, migrate, valid_doc

NAME_RE = re.compile(r"brainstorm-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz")
INTERVALS = (6, 12, 24, 168)  # hours
DEFAULTS = {"endpoint": "", "region": "", "bucket": "", "prefix": "brainstorm/", "accessKey": "", "secretKey": "",
            "interval": 24, "keep": 14, "enabled": False}
TICK = 60            # seconds between schedule checks
ERROR_RETRY = 3600   # seconds to wait after a failed automatic backup
MARGIN = 100 << 20   # bytes of free-disk margin when extracting a restore


class Busy(Exception):
    """Another backup/restore is in progress."""


class NotConfigured(Exception):
    pass


class BackupError(Exception):
    """Failure with a short message, no secrets (goes to the status and to the screen)."""


def hint(secret):
    # only the tail of the secret, and not even that if it is too short (it would reveal almost everything)
    return "…" + secret[-4:] if len(secret) > 8 else "…" if secret else ""


def text_ok(v, limit):
    return isinstance(v, str) and len(v) <= limit and v.isprintable()


def clean_config(body):
    """Validated backup configuration (secretKey only if it was sent), or None if anything is invalid."""
    if not isinstance(body, dict):
        return None
    cfg = {}
    for k in ("endpoint", "region", "bucket", "prefix", "accessKey"):
        if not text_ok(body.get(k), 500):
            return None
        cfg[k] = body[k].strip()
    url = urlsplit(cfg["endpoint"])
    try:
        url.port  # a port that is not a number
    except ValueError:
        return None
    cfg["endpoint"] = cfg["endpoint"].rstrip("/")
    if cfg["endpoint"] and not (url.scheme == "https" and url.hostname and "@" not in url.netloc
                                and url.path in ("", "/") and not url.query and not url.fragment):
        return None  # https:// only, and only the address (the bucket goes in the path)
    if not re.fullmatch(r"([a-z0-9-]{1,40})?", cfg["region"]) or not re.fullmatch(r"([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])?", cfg["bucket"]):
        return None
    if len(cfg["prefix"]) > 200 or cfg["prefix"].startswith("/") or len(cfg["accessKey"]) > 200:
        return None
    if "secretKey" in body:
        if not (text_ok(body["secretKey"], 500) and body["secretKey"].strip()):
            return None
        cfg["secretKey"] = body["secretKey"].strip()
    interval, keep, enabled = body.get("interval"), body.get("keep"), body.get("enabled")
    if interval not in INTERVALS or type(interval) is not int or type(keep) is not int or not 1 <= keep <= 365 or type(enabled) is not bool:
        return None
    return {**cfg, "interval": interval, "keep": keep, "enabled": enabled}


def configured(cfg):
    return all(cfg[k] for k in ("endpoint", "bucket", "accessKey", "secretKey"))


def file_name_ok(name):
    # the same rule on backup and restore: whatever goes into the archive can always come back
    return bool(name) and not name.startswith(".") and "\\" not in name and name.isprintable()


def attachments(files_dir):
    """[(document folder, [files])]: no dot folders (temporary) and no symlinks."""
    out = []
    for d in sorted(files_dir.iterdir()) if files_dir.is_dir() else []:
        if ID_RE.fullmatch(d.name) and d.is_dir() and not d.is_symlink():
            out.append((d, sorted(f for f in d.iterdir() if f.is_file() and not f.is_symlink() and file_name_ok(f.name))))
    return out


def fingerprint(store):
    # changes when anything included in the backup changes (document, trash, history, folders, attachments)
    with store._db() as db:
        docs = db.execute("SELECT COUNT(*), MAX(updated), COUNT(deleted), MAX(deleted) FROM docs").fetchone()
        hist = db.execute("SELECT COUNT(*), MAX(saved), COUNT(label) FROM history").fetchone()
    files = [(d.name, f.name, f.stat().st_size) for d, fs in attachments(store.files_dir) for f in fs]
    data = [tuple(docs), tuple(hist), store.folders(), files]
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def check_members(tar, free):
    # only the database and attachments/<document>/<file> (regular files): no links, nothing out of place;
    # and nothing that would not fit on disk once decompressed (gzip bomb)
    if sum(m.size for m in tar.getmembers()) > free - MARGIN:
        raise BackupError("archive too large for the free disk space")
    for m in tar.getmembers():
        parts = m.name.split("/")
        ok = (m.name == "brainstorm.db" and m.isfile()) or (parts[0] == "attachments" and (
            (len(parts) == 1 and m.isdir())
            or (len(parts) == 2 and ID_RE.fullmatch(parts[1]) and m.isdir())
            or (len(parts) == 3 and ID_RE.fullmatch(parts[1]) and file_name_ok(parts[2]) and m.isfile())))
        if not ok:
            raise BackupError("invalid archive")


def doc_ok(doc_id, body):
    # same validation as the API: the id goes into the page routes, the body is opened by the editor
    return isinstance(doc_id, str) and bool(ID_RE.fullmatch(doc_id)) and valid_doc(load_json(body))


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat() if t else None


class Backup:
    def __init__(self, store):
        self.store = store
        self.lock = threading.Lock()  # one backup/restore at a time (schedule and buttons)
        self.restoring = False        # True: routes that write answer 503
        self.restores = 0             # bumped on every restore: /api/events tells the tabs to reload
        self._recover()

    @property
    def _scrub(self):
        return self.store.db_path.with_name(".backup-scrub.db")  # next to the database: the secret does not go to the attachments disk

    def _recover(self):
        """Leftovers from an interrupted run: the copy with secrets and attachments left in .restore-old."""
        for suffix in ("", "-journal", "-wal", "-shm"):
            with suppress(OSError):
                Path(f"{self._scrub}{suffix}").unlink()
        files_dir, old = self.store.files_dir, self.store.files_dir / ".restore-old"
        if not old.is_dir():
            return
        back = 0
        for d in sorted(old.iterdir()):
            if not (files_dir / d.name).exists():
                with suppress(OSError):
                    os.rename(d, files_dir / d.name)
                    back += 1
        with suppress(OSError):
            old.rmdir()
        if back:
            print(f"interrupted restore: {back} attachment folder(s) put back", flush=True)

    # ---- configuration and status (kept in the settings table: outside the backup, not restored) ----
    def config(self):
        return {**DEFAULTS, **(self.store.setting("backup") or {})}

    def status(self):
        return self.store.setting("backup_status") or {}

    def save_config(self, cfg):
        if "secretKey" not in cfg:
            cfg["secretKey"] = self.config()["secretKey"]  # missing = keep
        self.store.set_setting("backup", cfg)

    def view(self):
        cfg, st = self.config(), self.status()
        out = {k: v for k, v in cfg.items() if k != "secretKey"}
        return {**out, "secretHint": hint(cfg["secretKey"]), "configured": configured(cfg),
                "status": {"lastSuccess": iso(st.get("lastSuccess")), "lastAttempt": iso(st.get("lastAttempt")),
                           "lastError": st.get("lastError"), "lastName": st.get("lastName")}}

    def client(self, cfg):
        if not configured(cfg):
            raise NotConfigured()
        return S3(cfg["endpoint"], cfg["region"] or "us-east-1", cfg["bucket"], cfg["accessKey"], cfg["secretKey"])

    def _tmp(self, name):
        path = self.store.files_dir / name
        shutil.rmtree(path, ignore_errors=True)  # leftover from an interrupted run
        path.mkdir(parents=True)
        return path

    # ---- backup ----
    def run(self):
        if not self.lock.acquire(blocking=False):
            raise Busy()
        try:
            return self._run(self.config())
        finally:
            self.lock.release()

    def _run(self, cfg, prune=True):
        client = self.client(cfg)
        now, status, fp = time.time(), self.status(), fingerprint(self.store)
        if int(now) == int(status.get("lastAttempt") or 0):
            time.sleep(1)  # the name has seconds: two backups in the same second would overwrite the previous one
            now = time.time()
        name = f"brainstorm-{datetime.fromtimestamp(now, timezone.utc):%Y-%m-%d-%H%M%S}.tar.gz"
        tmp = self._tmp(".backup-tmp")
        try:
            client.put_file(cfg["prefix"] + name, self._archive(tmp))
            status.update(lastSuccess=now, lastName=name, fingerprint=fp, lastError=None)
            if prune:
                status["lastError"] = self._prune(client, cfg)
        except (S3Error, OSError, sqlite3.Error, tarfile.TarError) as e:
            status["lastError"] = str(e) or type(e).__name__
            raise BackupError(status["lastError"]) from None
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
            status["lastAttempt"] = now
            self.store.set_setting("backup_status", status)
        return name

    def _archive(self, tmp):
        # consistent copy of the database (SQLite backup()), without settings, sessions and the login fingerprint
        db_copy, archive = self._scrub, tmp / "backup.tar.gz"
        db_copy.unlink(missing_ok=True)
        try:
            self._scrubbed_copy(db_copy)
            with tarfile.open(archive, "w:gz") as tar:
                tar.add(db_copy, "brainstorm.db")
                for d, files in attachments(self.store.files_dir):
                    for f in files:
                        tar.add(f, f"attachments/{d.name}/{f.name}", recursive=False)
        finally:
            db_copy.unlink(missing_ok=True)
        return archive

    def _scrubbed_copy(self, db_copy):
        with closing(sqlite3.connect(self.store.db_path)) as src, closing(sqlite3.connect(db_copy)) as dst:
            src.backup(dst)
            dst.execute("PRAGMA journal_mode=DELETE")  # a single file, no -wal next to it
            dst.execute("DROP TABLE IF EXISTS settings")
            dst.execute("DELETE FROM sessions")
            dst.execute("DELETE FROM meta WHERE key = 'auth_fingerprint'")
            dst.commit()
            dst.execute("VACUUM")  # rewrites the file: nothing that was deleted lingers in a free page

    def _backups(self, client, cfg):
        # only our own files, directly under the prefix; the name has the date, so alphabetical order = chronological
        prefix = cfg["prefix"]
        found = [o for o in client.list(prefix) if o["key"].startswith(prefix) and NAME_RE.fullmatch(o["key"][len(prefix):])]
        return sorted(found, key=lambda o: o["key"])

    def _prune(self, client, cfg):
        try:
            for o in self._backups(client, cfg)[:-cfg["keep"]]:
                client.delete(o["key"])
        except Exception as e:  # the backup itself succeeded
            return f"retention: {e if isinstance(e, S3Error) else type(e).__name__}"
        return None

    def list(self):
        cfg = self.config()
        items = self._backups(self.client(cfg), cfg)
        return [{"name": o["key"][len(cfg["prefix"]):], "size": o["size"], "modified": o["modified"]} for o in reversed(items)]

    # ---- restore ----
    def restore(self, name):
        """Replace everything with backup `name` (just the file name, inside the prefix). All or nothing."""
        if not NAME_RE.fullmatch(name):
            raise ValueError("invalid backup name")
        if not self.lock.acquire(blocking=False):
            raise Busy()
        self.restoring = True
        try:
            cfg = self.config()
            client = self.client(cfg)
            self._run(cfg, prune=False)  # 1. save the current state (if that fails, do not restore)
            try:
                tmp = self._tmp(".restore-tmp")
                archive = tmp / "restore.tar.gz"
                client.get_file(cfg["prefix"] + name, archive)
                self._extract(archive, tmp / "data")
                self._swap(tmp / "data")
            except (S3Error, OSError, sqlite3.Error) as e:
                raise BackupError(str(e) or type(e).__name__) from None
            finally:
                shutil.rmtree(self.store.files_dir / ".restore-tmp", ignore_errors=True)
            self.restores += 1
            self._prune(client, cfg)  # an error here undoes nothing; the next backup tries again
        finally:
            self.restoring = False
            self.lock.release()

    def _extract(self, archive, dest):
        try:
            with tarfile.open(archive, "r:gz") as tar:
                check_members(tar, shutil.disk_usage(archive.parent).free)
                tar.extractall(dest, filter="data")
        except (tarfile.TarError, EOFError, OSError):
            raise BackupError("invalid archive") from None
        db_file = dest / "brainstorm.db"
        if not db_file.is_file():
            raise BackupError("invalid archive")
        try:
            with closing(sqlite3.connect(db_file)) as db:
                tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
                if not {"docs", "history", "meta"} <= tables:
                    raise BackupError("invalid archive")
                row = db.execute("SELECT value FROM meta WHERE key = 'schema'").fetchone()
                if row and (not str(row[0]).isdigit() or int(row[0]) > SCHEMA_VERSION):
                    raise BackupError("backup is from a newer version of the app")
                with db:
                    migrate(db)  # old backup: create the missing columns, as when opening the database
                if not all(doc_ok(*r) for r in db.execute("SELECT id, body FROM docs")):
                    raise BackupError("invalid archive")
        except sqlite3.DatabaseError:
            raise BackupError("invalid archive") from None

    def _swap(self, src):
        """Database and attachments swapped together: the database is only committed once the attachments are in place."""
        files_dir, new_files = self.store.files_dir, src / "attachments"
        old = files_dir / ".restore-old"
        with suppress(OSError):
            old.rmdir()  # empty leftover from before
        old.mkdir()  # if it still exists with attachments (an earlier undo failed), stop here: nothing is deleted
        db = sqlite3.connect(self.store.db_path, timeout=10, isolation_level=None)
        moved = []  # (from, to), to undo in reverse order
        try:
            db.execute("ATTACH DATABASE ? AS src", (str(src / "brainstorm.db"),))
            db.execute("BEGIN IMMEDIATE")
            for table in ("docs", "history"):
                cols = ", ".join(c[1] for c in db.execute(f"PRAGMA main.table_info({table})"))
                db.execute(f"DELETE FROM main.{table}")
                db.execute(f"INSERT INTO main.{table} ({cols}) SELECT {cols} FROM src.{table}")
            # sessions and settings stay as they are: no logout and no lost keys
            db.execute("DELETE FROM main.meta WHERE key != 'auth_fingerprint'")
            db.execute("INSERT INTO main.meta (key, value) SELECT key, value FROM src.meta WHERE key != 'auth_fingerprint'")
            # attachments: folder by folder (the attachments folder may be a mount point; everything on the same disk = rename)
            for d, _ in attachments(files_dir):
                os.rename(d, old / d.name)
                moved.append((d, old / d.name))
            for d in sorted(new_files.iterdir()) if new_files.is_dir() else []:
                os.rename(d, files_dir / d.name)
                moved.append((d, files_dir / d.name))
            db.execute("COMMIT")
        except BaseException:
            for a, b in reversed(moved):
                os.rename(b, a)
            if db.in_transaction:
                db.execute("ROLLBACK")
            with suppress(OSError):
                old.rmdir()
            raise
        finally:
            db.close()
        shutil.rmtree(old, ignore_errors=True)

    # ---- schedule ----
    def tick(self, now=None):
        """Run the backup if enabled, configured, the interval has passed and something changed. Returns True if it tried."""
        cfg, st, now = self.config(), self.status(), now or time.time()
        interval = cfg["interval"] * 3600
        if not (cfg["enabled"] and configured(cfg)) or now - (st.get("lastSuccess") or 0) < interval \
                or now - (st.get("lastAttempt") or 0) < min(interval, ERROR_RETRY) or st.get("fingerprint") == fingerprint(self.store):
            return False
        if not self.lock.acquire(blocking=False):
            return False
        try:
            self._run(cfg)
        except BackupError:
            pass  # already recorded in the status
        finally:
            self.lock.release()
        return True

    def start(self):
        def loop():
            while True:
                time.sleep(TICK)
                try:
                    self.tick()
                except Exception as e:  # the schedule does not die from an unexpected error
                    print(f"automatic backup failed: {type(e).__name__}", flush=True)
        threading.Thread(target=loop, daemon=True, name="backup-scheduler").start()
