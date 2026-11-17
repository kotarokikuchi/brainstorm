"""Armazenamento do Brainstorm: SQLite (documentos, histórico, lixeira, pastas) + pasta de anexos.

Tudo que não é arquivo anexado fica num único banco (fácil de copiar/arquivar); imagens e anexos
ficam em <pasta de anexos>/<id do documento>/<arquivo>.
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

HISTORY_MAX = 50  # versões guardadas por documento
ID_RE = re.compile(r"[a-z0-9-]{1,64}")  # id de documento e de pasta (sempre com fullmatch)
MAX_FOLDERS = 2000

SCHEMA = """
CREATE TABLE IF NOT EXISTS docs (
    id      TEXT PRIMARY KEY,
    type    TEXT NOT NULL,             -- map | board | skill
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
    label   TEXT,                      -- NULL = versão automática; preenchido = versão com nome (não é podada)
    PRIMARY KEY (doc_id, version)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,       -- sha256 do cookie (o cookie em si não fica guardado)
    expires    REAL NOT NULL
);
"""

EMPTY_FOLDERS = {"version": 0, "folders": [], "place": {}}


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


def doc_type(body):
    return body["type"] if body.get("type") in ("board", "skill") else "map"


def doc_title(body):
    return body.get("title", "") if body.get("type") in ("board", "skill") else body["root"].get("text", "")


def doc_size(body):
    # tópicos do mapa ou elementos do quadro (mostrado no histórico)
    if body.get("type") == "skill":
        return len(body["content"])
    count = lambda n: 1 + sum(count(c) for c in n.get("children", []))
    return len(body["elements"]) if body.get("type") == "board" else count(body["root"])


def valid_tags(tags):
    return (isinstance(tags, list) and len(tags) <= 30 and len(set(map(str, tags))) == len(tags)
            and all(isinstance(t, str) and 0 < len(t) <= 40 and t == t.strip() for t in tags))


# documentos: mapa mental ({root}), quadro de desenho ({type: "board", title, elements})
# ou skill ({type: "skill", title, tags, content})
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


# pastas: {version, folders: [{id, name, parent}], place: {id do documento: id da pasta}}
# (fica fora dos documentos: mover não mexe na versão de um mapa aberto em outra aba)
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
    checked = set()  # pastas com o caminho até a raiz já conferido: cada uma é percorrida uma vez só
    for fid in parents:  # pai precisa existir e não pode haver ciclo (pasta dentro dela mesma)
        seen, cur = set(), fid
        while cur is not None and cur not in checked:
            if cur in seen or cur not in parents:
                return False
            seen.add(cur)
            cur = parents[cur]
        checked |= seen
    return all(isinstance(k, str) and ID_RE.fullmatch(k) and isinstance(v, str) and v in parents
               for k, v in body["place"].items())


class Store:
    def __init__(self, db_path: Path, files_dir: Path):
        self.db_path, self.files_dir = Path(db_path), Path(files_dir)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.files_dir.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.execute("PRAGMA journal_mode=WAL")  # leituras não esperam gravações
            db.executescript(SCHEMA)
            if "label" not in [c["name"] for c in db.execute("PRAGMA table_info(history)")]:
                db.execute("ALTER TABLE history ADD COLUMN label TEXT")  # banco criado antes das versões com nome

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
        last = db.execute("SELECT MAX(saved) FROM history WHERE doc_id = ? AND label IS NULL", (doc_id,)).fetchone()[0]
        if last is not None and time.time() - last < interval:
            return
        db.execute("INSERT INTO history (doc_id, version, saved, body) VALUES (?, ?, ?, ?) ON CONFLICT(doc_id, version) DO NOTHING",
                   (doc_id, row["version"], row["updated"], row["body"]))  # não apaga o rótulo de uma versão com nome
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

    def duplicate(self, doc_id, suffix=" (cópia)"):
        body = self.get(doc_id)
        if body is None:
            return None
        new_id = f"{doc_id[:48]}-copia-{uuid.uuid4().hex[:6]}"
        if body.get("type") in ("board", "skill"):
            body["title"] = f"{body.get('title', '')}{suffix}"
        else:
            body["root"]["text"] = f"{body['root'].get('text', '')}{suffix}"
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
            rows = db.execute("SELECT version, saved, body, label FROM history WHERE doc_id = ? ORDER BY version DESC", (doc_id,)).fetchall()
        out = []
        for r in rows:
            try:
                body = json.loads(r["body"])
                title, nodes = doc_title(body), doc_size(body)
            except (ValueError, KeyError, TypeError, AttributeError, RecursionError):
                title, nodes = "", 0  # versão malformada não derruba a lista inteira
            out.append({"version": r["version"], "saved": iso(r["saved"]), "title": title, "nodes": nodes, "label": r["label"]})
        return out

    def label_version(self, doc_id, label):
        """Dá nome (None mantém o nome já existente) à versão atual do documento. Devolve a versão ou None se não existe."""
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
        return json.loads(row["body"]) if row else None

    # ---- sessões de login (sobrevivem a reinícios do servidor) ----
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
        # impressão das credenciais com scrypt (lento) e sal aleatório desta instalação: uma cópia do
        # banco (ex.: backup externo) não serve para testar senhas rápido. Se mudou, apaga as sessões.
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
    if file.is_symlink():
        return None
    try:
        data = json.loads(file.read_text("utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _real_dir(path):
    # pasta de verdade: link simbólico não é seguido (poderia apontar para fora dos dados)
    return path.is_dir() and not path.is_symlink()


def migrate_legacy(store: Store, data_dir: Path):
    """Importa data/*.json, history/, trash/, files/ e folders/ para o banco e a pasta de anexos.

    Só entra o que passa na mesma validação da API (id, documento, pastas) e não é link simbólico.
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
            if not (ID_RE.fullmatch(doc_id) and valid_doc(body)):
                return False  # id inválido ou corrompido: fica só no backup
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
            # na lixeira com o mesmo id de um documento ativo: fica só no backup
            if _real_dir(box) and (box / "map.json").exists() and add_doc(box.name, box / "map.json", box.stat().st_mtime):
                imported += 1
                add_history(box.name, box / "history")
        tree = _read_json(data_dir / "folders" / "tree.json") if _real_dir(data_dir / "folders") else None
        if valid_folders(tree):
            db.execute("INSERT OR IGNORE INTO meta VALUES ('folders', ?)", (json.dumps(tree, ensure_ascii=False),))

    # anexos: copiados (o original fica no backup); com o banco já gravado, uma interrupção não perde nada
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
