"""Armazenamento do Brainstorm: SQLite (documentos, histórico, lixeira, pastas) + pasta de anexos.

Tudo que não é arquivo anexado fica num único banco (fácil de copiar/arquivar); imagens e anexos
ficam em <pasta de anexos>/<id do documento>/<arquivo>.
"""
import json
import shutil
from contextlib import contextmanager
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

HISTORY_MAX = 50  # versões guardadas por documento

SCHEMA = """
CREATE TABLE IF NOT EXISTS docs (
    id      TEXT PRIMARY KEY,
    type    TEXT NOT NULL,             -- map | board
    title   TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated REAL NOT NULL,             -- epoch da última gravação
    deleted REAL,                      -- NULL = ativo; preenchido = na lixeira desde então
    body    TEXT NOT NULL              -- JSON do documento
);
CREATE TABLE IF NOT EXISTS history (
    doc_id  TEXT NOT NULL,
    version INTEGER NOT NULL,
    saved   REAL NOT NULL,             -- quando essa versão foi gravada
    body    TEXT NOT NULL,
    PRIMARY KEY (doc_id, version)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

EMPTY_FOLDERS = {"version": 0, "folders": [], "place": {}}


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


def doc_type(body):
    return "board" if body.get("type") == "board" else "map"


def doc_title(body):
    return body.get("title", "") if body.get("type") == "board" else body["root"].get("text", "")


def doc_size(body):
    # tópicos do mapa ou elementos do quadro (mostrado no histórico)
    count = lambda n: 1 + sum(count(c) for c in n.get("children", []))
    return len(body["elements"]) if body.get("type") == "board" else count(body["root"])


class Store:
    def __init__(self, db_path: Path, files_dir: Path):
        self.db_path, self.files_dir = Path(db_path), Path(files_dir)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.files_dir.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.execute("PRAGMA journal_mode=WAL")  # leituras não esperam gravações
            db.executescript(SCHEMA)

    @contextmanager
    def _db(self):
        # uma conexão por operação (o servidor atende em várias threads); cada "with" = uma transação
        db = sqlite3.connect(self.db_path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def files(self, doc_id):
        return self.files_dir / doc_id

    # ---- documentos ----
    def get(self, doc_id):
        with self._db() as db:
            row = db.execute("SELECT body FROM docs WHERE id = ? AND deleted IS NULL", (doc_id,)).fetchone()
        return json.loads(row["body"]) if row else None

    def exists(self, doc_id):
        return self.get(doc_id) is not None

    def put(self, doc_id, body, history_interval):
        """Grava se body["version"] for a versão atual. Devolve ("ok", nova), ("conflict", atual) ou ("trashed", None)."""
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")  # checagem de versão e gravação sem outra gravação no meio
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
        # guarda a versão que vai ser sobrescrita, no máximo uma a cada `interval` s
        last = db.execute("SELECT MAX(saved) FROM history WHERE doc_id = ?", (doc_id,)).fetchone()[0]
        if last is not None and time.time() - last < interval:
            return
        db.execute("INSERT OR REPLACE INTO history VALUES (?, ?, ?, ?)", (doc_id, row["version"], row["updated"], row["body"]))
        db.execute("DELETE FROM history WHERE doc_id = ? AND version NOT IN "
                   "(SELECT version FROM history WHERE doc_id = ? ORDER BY version DESC LIMIT ?)", (doc_id, doc_id, HISTORY_MAX))

    def list_docs(self):
        with self._db() as db:
            rows = db.execute("SELECT id, title, type, updated FROM docs WHERE deleted IS NULL ORDER BY updated DESC").fetchall()
        return [{"id": r["id"], "title": r["title"], "type": r["type"], "updated": iso(r["updated"])} for r in rows]

    def duplicate(self, doc_id):
        body = self.get(doc_id)
        if body is None:
            return None
        new_id = f"{doc_id[:48]}-copia-{uuid.uuid4().hex[:6]}"
        if body.get("type") == "board":
            body["title"] = f"{body.get('title', '')} (cópia)"
        else:
            body["root"]["text"] = f"{body['root'].get('text', '')} (cópia)"
        body["version"] = 0
        if self.files(doc_id).exists():
            shutil.copytree(self.files(doc_id), self.files(new_id))  # imagens/anexos apontam para o documento
        self.put(new_id, body, 0)
        return new_id

    # ---- lixeira: o documento só ganha a data em "deleted"; histórico e anexos ficam onde estão ----
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

    # ---- histórico ----
    def history(self, doc_id):
        with self._db() as db:
            rows = db.execute("SELECT version, saved, body FROM history WHERE doc_id = ? ORDER BY version DESC", (doc_id,)).fetchall()
        out = []
        for r in rows:
            body = json.loads(r["body"])
            out.append({"version": r["version"], "saved": iso(r["saved"]), "title": doc_title(body), "nodes": doc_size(body)})
        return out

    def history_version(self, doc_id, version):
        with self._db() as db:
            row = db.execute("SELECT body FROM history WHERE doc_id = ? AND version = ?", (doc_id, version)).fetchone()
        return json.loads(row["body"]) if row else None

    # ---- pastas: a árvore inteira num JSON (validada pelo servidor) ----
    def folders(self):
        with self._db() as db:
            row = db.execute("SELECT value FROM meta WHERE key = 'folders'").fetchone()
        return json.loads(row["value"]) if row else dict(EMPTY_FOLDERS)

    def put_folders(self, body):
        """Grava se a versão bater. Devolve (True, gravado) ou (False, atual)."""
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT value FROM meta WHERE key = 'folders'").fetchone()
            stored = json.loads(row["value"]) if row else dict(EMPTY_FOLDERS)
            if body["version"] != stored.get("version", 0):
                return False, stored
            body["version"] += 1
            db.execute("INSERT OR REPLACE INTO meta VALUES ('folders', ?)", (json.dumps(body, ensure_ascii=False),))
        return True, body


# ---- Migração do formato antigo (um .json por documento) ----
def _read_json(file):
    try:
        data = json.loads(file.read_text("utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _valid(body):
    try:
        doc_title(body)
        return isinstance(body.get("version"), int)
    except (KeyError, TypeError, AttributeError):
        return False


def migrate_legacy(store: Store, data_dir: Path):
    """Importa data/*.json, history/, trash/, files/ e folders/ para o banco e a pasta de anexos.

    Nada é apagado: o formato antigo vai inteiro para data/legacy-<data>/. Pode rodar de novo
    depois de uma interrupção (INSERT OR IGNORE; anexo já copiado não é copiado de novo).
    Devolve quantos documentos foram importados (0 se não havia nada antigo).
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
            if body is None or not _valid(body):
                return False  # corrompido: fica só no backup
            body["id"] = doc_id
            cur = db.execute("INSERT OR IGNORE INTO docs VALUES (?, ?, ?, ?, ?, ?, ?)",
                             (doc_id, doc_type(body), doc_title(body), body["version"], file.stat().st_mtime, deleted,
                              json.dumps(body, ensure_ascii=False)))
            return cur.rowcount > 0

        def add_history(doc_id, folder):
            for f in folder.glob("*.json") if folder.exists() else []:
                body = _read_json(f)
                if body is not None and f.stem.isdigit():
                    db.execute("INSERT OR IGNORE INTO history VALUES (?, ?, ?, ?)",
                               (doc_id, int(f.stem), f.stat().st_mtime, json.dumps(body, ensure_ascii=False)))

        for f in docs:
            if add_doc(f.stem, f, None):
                imported += 1
                add_history(f.stem, data_dir / "history" / f.stem)
        trash = data_dir / "trash"
        for box in sorted(trash.iterdir()) if trash.exists() else []:
            # na lixeira com o mesmo id de um documento ativo: fica só no backup
            if (box / "map.json").exists() and add_doc(box.name, box / "map.json", box.stat().st_mtime):
                imported += 1
                add_history(box.name, box / "history")
        tree = _read_json(data_dir / "folders" / "tree.json") if (data_dir / "folders" / "tree.json").exists() else None
        if tree is not None:
            db.execute("INSERT OR IGNORE INTO meta VALUES ('folders', ?)", (json.dumps(tree, ensure_ascii=False),))

    # anexos: copiados (o original fica no backup); com o banco já gravado, uma interrupção não perde nada
    sources = [(d.name, d) for d in (data_dir / "files").iterdir()] if (data_dir / "files").exists() else []
    sources += [(b.name, b / "files") for b in (data_dir / "trash").iterdir()] if (data_dir / "trash").exists() else []
    for doc_id, src in sources:
        if src.is_dir() and not store.files(doc_id).exists():
            shutil.copytree(src, store.files(doc_id))

    backup = data_dir / f"legacy-{time.strftime('%Y%m%d-%H%M%S')}"
    backup.mkdir()
    for p in docs + old_dirs:
        shutil.move(str(p), backup / p.name)
    return imported
