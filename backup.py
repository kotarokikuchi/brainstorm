"""Backup no Wasabi (ou outro S3): um .tar.gz por backup com o banco sem segredos + a pasta de anexos.

Agenda (thread ligada só pelo main() do app), retenção dos últimos N e restauração. Um lock garante um
backup/restore por vez. Temporários dentro da pasta de anexos (mesmo disco do que mais pesa), em pastas
que começam com ponto: o servidor e o próprio backup ignoram (id de documento nunca tem ponto).
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
from store import ID_RE, SCHEMA_VERSION, migrate

NAME_RE = re.compile(r"brainstorm-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz")
INTERVALS = (6, 12, 24, 168)  # horas
DEFAULTS = {"endpoint": "", "region": "", "bucket": "", "prefix": "brainstorm/", "accessKey": "", "secretKey": "",
            "interval": 24, "keep": 14, "enabled": False}
TICK = 60            # s entre as conferências da agenda
ERROR_RETRY = 3600   # s de espera depois de um backup automático que falhou
MARGIN = 100 << 20   # bytes de folga no disco ao extrair um restore


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
    try:
        url.port  # porta que não é número
    except ValueError:
        return None
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


def file_name_ok(name):
    # o mesmo critério no backup e no restore: o que vai no arquivo sempre volta
    return bool(name) and not name.startswith(".") and "\\" not in name and name.isprintable()


def attachments(files_dir):
    """[(pasta do documento, [arquivos])]: sem pastas com ponto (temporários) e sem links simbólicos."""
    out = []
    for d in sorted(files_dir.iterdir()) if files_dir.is_dir() else []:
        if ID_RE.fullmatch(d.name) and d.is_dir() and not d.is_symlink():
            out.append((d, sorted(f for f in d.iterdir() if f.is_file() and not f.is_symlink() and file_name_ok(f.name))))
    return out


def fingerprint(store):
    # muda quando algo que vai no backup muda (documento, lixeira, histórico, pastas, anexos)
    with store._db() as db:
        docs = db.execute("SELECT COUNT(*), MAX(updated), COUNT(deleted), MAX(deleted) FROM docs").fetchone()
        hist = db.execute("SELECT COUNT(*), MAX(saved), COUNT(label) FROM history").fetchone()
    files = [(d.name, f.name, f.stat().st_size) for d, fs in attachments(store.files_dir) for f in fs]
    data = [tuple(docs), tuple(hist), store.folders(), files]
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def check_members(tar, free):
    # só o banco e attachments/<documento>/<arquivo> (arquivos comuns): nada de links, nada fora do lugar;
    # e nada que, descompactado, não caiba no disco (bomba de gzip)
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


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat() if t else None


class Backup:
    def __init__(self, store):
        self.store = store
        self.lock = threading.Lock()  # um backup/restore por vez (agenda e botões)
        self.restoring = False        # True: rotas que gravam respondem 503
        self.restores = 0             # sobe a cada restauração: o /api/events manda as abas recarregarem
        self._recover()

    @property
    def _scrub(self):
        return self.store.db_path.with_name(".backup-scrub.db")  # junto do banco: o segredo não vai para o disco dos anexos

    def _recover(self):
        """Sobras de execução interrompida: cópia com segredos e anexos que ficaram em .restore-old."""
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
            print(f"restore interrompido: {back} pasta(s) de anexos devolvida(s)", flush=True)

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
        return {**out, "secretHint": hint(cfg["secretKey"]), "configured": configured(cfg),
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
        if int(now) == int(status.get("lastAttempt") or 0):
            time.sleep(1)  # o nome tem segundos: dois backups no mesmo segundo sobrescreveriam o anterior
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
        # cópia consistente do banco (backup() do SQLite), sem configurações, sessões e impressão do login
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
            dst.execute("PRAGMA journal_mode=DELETE")  # arquivo único, sem -wal ao lado
            dst.execute("DROP TABLE IF EXISTS settings")
            dst.execute("DELETE FROM sessions")
            dst.execute("DELETE FROM meta WHERE key = 'auth_fingerprint'")
            dst.commit()
            dst.execute("VACUUM")  # reescreve o arquivo: nada do que foi apagado sobra em página livre

    def _backups(self, client, cfg):
        # só os nossos arquivos, direto no prefixo; o nome tem a data, então ordem alfabética = cronológica
        prefix = cfg["prefix"]
        found = [o for o in client.list(prefix) if o["key"].startswith(prefix) and NAME_RE.fullmatch(o["key"][len(prefix):])]
        return sorted(found, key=lambda o: o["key"])

    def _prune(self, client, cfg):
        try:
            for o in self._backups(client, cfg)[:-cfg["keep"]]:
                client.delete(o["key"])
        except Exception as e:  # o backup em si deu certo
            return f"retention: {e if isinstance(e, S3Error) else type(e).__name__}"
        return None

    def list(self):
        cfg = self.config()
        items = self._backups(self.client(cfg), cfg)
        return [{"name": o["key"][len(cfg["prefix"]):], "size": o["size"], "modified": o["modified"]} for o in reversed(items)]

    # ---- restauração ----
    def restore(self, name):
        """Troca tudo pelo backup `name` (só o nome do arquivo, dentro do prefixo). Tudo ou nada."""
        if not NAME_RE.fullmatch(name):
            raise ValueError("invalid backup name")
        if not self.lock.acquire(blocking=False):
            raise Busy()
        self.restoring = True
        try:
            cfg = self.config()
            client = self.client(cfg)
            self._run(cfg, prune=False)  # 1. guarda o estado atual (se falhar, não restaura)
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
            self._prune(client, cfg)  # erro aqui não desfaz nada; o próximo backup tenta de novo
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
                    migrate(db)  # backup antigo: cria as colunas que faltam, como ao abrir o banco
        except sqlite3.DatabaseError:
            raise BackupError("invalid archive") from None

    def _swap(self, src):
        """Banco e anexos trocados juntos: o banco só é confirmado depois que os anexos estão no lugar."""
        files_dir, new_files = self.store.files_dir, src / "attachments"
        old = files_dir / ".restore-old"
        with suppress(OSError):
            old.rmdir()  # sobra vazia de antes
        old.mkdir()  # se ainda existe com anexos (desfazer falhou antes), para aqui: nada é apagado
        db = sqlite3.connect(self.store.db_path, timeout=10, isolation_level=None)
        moved = []  # (de, para), para desfazer na ordem inversa
        try:
            db.execute("ATTACH DATABASE ? AS src", (str(src / "brainstorm.db"),))
            db.execute("BEGIN IMMEDIATE")
            for table in ("docs", "history"):
                cols = ", ".join(c[1] for c in db.execute(f"PRAGMA main.table_info({table})"))
                db.execute(f"DELETE FROM main.{table}")
                db.execute(f"INSERT INTO main.{table} ({cols}) SELECT {cols} FROM src.{table}")
            # sessions e settings ficam como estão: não desloga e não perde as chaves
            db.execute("DELETE FROM main.meta WHERE key != 'auth_fingerprint'")
            db.execute("INSERT INTO main.meta (key, value) SELECT key, value FROM src.meta WHERE key != 'auth_fingerprint'")
            # anexos: pasta por pasta (a de anexos pode ser um ponto de montagem; tudo no mesmo disco = rename)
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
