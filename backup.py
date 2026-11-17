"""Backup no Wasabi (ou outro S3): um .tar.gz por backup com o banco sem segredos + a pasta de anexos.

Agenda (thread ligada só pelo main() do app), retenção dos últimos N e restauração. Um lock garante um
backup/restore por vez. Temporários dentro da pasta de anexos (mesmo disco do que mais pesa), em pastas
que começam com ponto: o servidor e o próprio backup ignoram (id de documento nunca tem ponto).
"""
import hashlib
import json
import re
import shutil
import sqlite3
import tarfile
import threading
import time
from contextlib import closing
from datetime import datetime, timezone
from urllib.parse import urlsplit

from s3 import S3, S3Error

NAME_RE = re.compile(r"brainstorm-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz")
INTERVALS = (6, 12, 24, 168)  # horas
DEFAULTS = {"endpoint": "", "region": "", "bucket": "", "prefix": "brainstorm/", "accessKey": "", "secretKey": "",
            "interval": 24, "keep": 14, "enabled": False}
TICK = 60            # s entre as conferências da agenda
ERROR_RETRY = 3600   # s de espera depois de um backup automático que falhou


class Busy(Exception):
    """Outro backup/restore em andamento."""


class NotConfigured(Exception):
    pass


class BackupError(Exception):
    """Falha com mensagem curta, sem segredos (vai para o status e para a tela)."""


def hint(secret):
    # só o final do segredo, e nem isso se for curto demais (mostraria quase tudo)
    return "…" + secret[-4:] if len(secret) > 8 else "…" if secret else ""


def text_ok(v, limit):
    return isinstance(v, str) and len(v) <= limit and v.isprintable()


def clean_config(body):
    """Configuração do backup validada (secretKey só se veio), ou None se algo não vale."""
    if not isinstance(body, dict):
        return None
    cfg = {}
    for k in ("endpoint", "region", "bucket", "prefix", "accessKey"):
        if not text_ok(body.get(k), 500):
            return None
        cfg[k] = body[k].strip()
    url = urlsplit(cfg["endpoint"])
    cfg["endpoint"] = cfg["endpoint"].rstrip("/")
    if cfg["endpoint"] and not (url.scheme == "https" and url.hostname and "@" not in url.netloc
                                and url.path in ("", "/") and not url.query and not url.fragment):
        return None  # só https:// e só o endereço (o bucket vai no caminho)
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


def attachments(files_dir):
    """[(pasta do documento, [arquivos])]: sem pastas com ponto (temporários) e sem links simbólicos."""
    out = []
    for d in sorted(files_dir.iterdir()) if files_dir.is_dir() else []:
        if not d.name.startswith(".") and d.is_dir() and not d.is_symlink():
            out.append((d, sorted(f for f in d.iterdir() if f.is_file() and not f.is_symlink())))
    return out


def fingerprint(store):
    # muda quando algo que vai no backup muda (documento, lixeira, histórico, pastas, anexos)
    with store._db() as db:
        docs = db.execute("SELECT COUNT(*), MAX(updated), COUNT(deleted), MAX(deleted) FROM docs").fetchone()
        hist = db.execute("SELECT COUNT(*), MAX(saved), COUNT(label) FROM history").fetchone()
    files = [(d.name, f.name, f.stat().st_size) for d, fs in attachments(store.files_dir) for f in fs]
    data = [tuple(docs), tuple(hist), store.folders(), files]
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat() if t else None


class Backup:
    def __init__(self, store):
        self.store = store
        self.lock = threading.Lock()  # um backup/restore por vez (agenda e botões)
        self.restoring = False        # True: rotas que gravam respondem 503
        self.restores = 0             # sobe a cada restauração: o /api/events manda as abas recarregarem

    # ---- configuração e status (ficam na tabela settings: fora do backup, não voltam num restore) ----
    def config(self):
        return {**DEFAULTS, **(self.store.setting("backup") or {})}

    def status(self):
        return self.store.setting("backup_status") or {}

    def save_config(self, cfg):
        if "secretKey" not in cfg:
            cfg["secretKey"] = self.config()["secretKey"]  # ausente = mantém
        self.store.set_setting("backup", cfg)

    def view(self):
        cfg, st = self.config(), self.status()
        out = {k: v for k, v in cfg.items() if k != "secretKey"}
        return {**out, "secretHint": hint(cfg["secretKey"]), "configured": configured(cfg), "running": self.lock.locked(),
                "status": {"lastSuccess": iso(st.get("lastSuccess")), "lastAttempt": iso(st.get("lastAttempt")),
                           "lastError": st.get("lastError"), "lastName": st.get("lastName")}}

    def client(self, cfg):
        if not configured(cfg):
            raise NotConfigured()
        return S3(cfg["endpoint"], cfg["region"] or "us-east-1", cfg["bucket"], cfg["accessKey"], cfg["secretKey"])

    def _tmp(self, name):
        path = self.store.files_dir / name
        shutil.rmtree(path, ignore_errors=True)  # sobra de uma execução interrompida
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
        # cópia consistente do banco (backup() do SQLite), sem configurações, sessões e impressão do login
        db_copy, archive = tmp / "brainstorm.db", tmp / "backup.tar.gz"
        with closing(sqlite3.connect(self.store.db_path)) as src, closing(sqlite3.connect(db_copy)) as dst:
            src.backup(dst)
            dst.execute("PRAGMA journal_mode=DELETE")  # arquivo único, sem -wal ao lado
            dst.execute("DROP TABLE IF EXISTS settings")
            dst.execute("DELETE FROM sessions")
            dst.execute("DELETE FROM meta WHERE key = 'auth_fingerprint'")
            dst.commit()
            dst.execute("VACUUM")  # reescreve o arquivo: nada do que foi apagado sobra em página livre
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(db_copy, "brainstorm.db")
            for d, files in attachments(self.store.files_dir):
                for f in files:
                    tar.add(f, f"attachments/{d.name}/{f.name}", recursive=False)
        return archive

    def _backups(self, client, cfg):
        # só os nossos arquivos, direto no prefixo; o nome tem a data, então ordem alfabética = cronológica
        prefix = cfg["prefix"]
        found = [o for o in client.list(prefix) if o["key"].startswith(prefix) and NAME_RE.fullmatch(o["key"][len(prefix):])]
        return sorted(found, key=lambda o: o["key"])

    def _prune(self, client, cfg):
        try:
            for o in self._backups(client, cfg)[:-cfg["keep"]]:
                client.delete(o["key"])
        except S3Error as e:
            return f"retention: {e}"  # o backup em si deu certo
        return None

    def list(self):
        cfg = self.config()
        items = self._backups(self.client(cfg), cfg)
        return [{"name": o["key"][len(cfg["prefix"]):], "size": o["size"], "modified": o["modified"]} for o in reversed(items)]

    # ---- agenda ----
    def tick(self, now=None):
        """Faz o backup se ligado, configurado, o intervalo passou e algo mudou. Devolve True se tentou."""
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
            pass  # já está no status
        finally:
            self.lock.release()
        return True

    def start(self):
        def loop():
            while True:
                time.sleep(TICK)
                try:
                    self.tick()
                except Exception as e:  # a agenda não morre por um erro inesperado
                    print(f"backup automático falhou: {type(e).__name__}", flush=True)
        threading.Thread(target=loop, daemon=True, name="backup-scheduler").start()
