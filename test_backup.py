import hashlib
import re
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit
from xml.sax.saxutils import escape

import io
import json
import shutil
import sqlite3
import tarfile
import time
import urllib.error
import urllib.request
from contextlib import closing
from unittest import mock

import app
from backup import NAME_RE, Backup, BackupError, NotConfigured, clean_config
from s3 import S3, S3Error, sign
from store import Store

app.Handler.log_message = lambda *a: None  # silencia o log de requisições
ACCESS, SECRET = "AKFAKEACCESS", "fake-secret-key-0123456789"


class FakeS3(BaseHTTPRequestHandler):
    """S3 de mentira: um bucket "bkt" num dict; confere a assinatura de cada requisição."""

    def log_message(self, *a):
        pass

    def _reply(self, status, body=b"", kind="application/xml"):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, code):
        self._reply(status, f"<Error><Code>{code}</Code></Error>".encode())

    def _check(self, payload):
        s = self.server
        parts = urlsplit(self.path)
        auth = self.headers.get("Authorization") or ""
        m = re.fullmatch(r"AWS4-HMAC-SHA256 Credential=([^/]+)/\d{8}/([^/]+)/s3/aws4_request,SignedHeaders=([^,]+),Signature=[0-9a-f]{64}", auth)
        if s.deny or not m or m[1] != ACCESS:
            return self._error(403, "AccessDenied")
        extra = {k: self.headers[k] for k in m[3].split(";") if k not in ("host", "x-amz-date", "x-amz-content-sha256")}
        want = sign(self.command, self.headers["Host"], parts.path, dict(parse_qsl(parts.query, keep_blank_values=True)), extra,
                    self.headers["x-amz-content-sha256"], ACCESS, SECRET, m[2], self.headers["x-amz-date"])
        if want != auth:
            return self._error(403, "SignatureDoesNotMatch")
        if payload is not None and hashlib.sha256(payload).hexdigest() != self.headers["x-amz-content-sha256"]:
            return self._error(400, "XAmzContentSHA256Mismatch")
        bucket, _, key = parts.path.lstrip("/").partition("/")
        if bucket != "bkt":
            return self._error(404, "NoSuchBucket")
        return unquote(key), dict(parse_qsl(parts.query))

    def do_PUT(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        if ok := self._check(body):
            self.server.objects[ok[0]] = (body, datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"))
            self._reply(200)

    def do_DELETE(self):
        if ok := self._check(None):
            self.server.objects.pop(ok[0], None)
            self._reply(204)

    def do_GET(self):
        if not (ok := self._check(None)):
            return
        key, query = ok
        if key:
            if key not in self.server.objects:
                return self._error(404, "NoSuchKey")
            return self._reply(200, self.server.objects[key][0], "application/octet-stream")
        names = sorted(k for k in self.server.objects if k.startswith(query.get("prefix", "")))
        start = int(query.get("continuation-token", 0))
        page = names[start:start + 2]  # páginas de 2: exercita a paginação
        more = start + 2 < len(names)
        items = "".join(f"<Contents><Key>{escape(k)}</Key><LastModified>{self.server.objects[k][1]}</LastModified>"
                        f"<Size>{len(self.server.objects[k][0])}</Size></Contents>" for k in page)
        xml = (f'<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
               f"<IsTruncated>{'true' if more else 'false'}</IsTruncated>{items}"
               + (f"<NextContinuationToken>{start + 2}</NextContinuationToken>" if more else "") + "</ListBucketResult>")
        self._reply(200, xml.encode())


def start_fake_s3(test):
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeS3)
    server.objects, server.deny = {}, False
    threading.Thread(target=server.serve_forever, daemon=True).start()
    test.addCleanup(server.server_close)
    test.addCleanup(server.shutdown)
    return server, f"http://127.0.0.1:{server.server_address[1]}"


class SigV4Test(unittest.TestCase):
    # exemplos oficiais: docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
    AK, SK = "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"

    def test_get_object_example(self):
        auth = sign("GET", "examplebucket.s3.amazonaws.com", "/test.txt", {}, {"Range": "bytes=0-9"},
                    hashlib.sha256(b"").hexdigest(), self.AK, self.SK, "us-east-1", "20130524T000000Z")
        self.assertEqual(auth, "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,"
                               "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,"
                               "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41")

    def test_list_objects_example(self):
        auth = sign("GET", "examplebucket.s3.amazonaws.com", "/", {"max-keys": "2", "prefix": "J"}, {},
                    hashlib.sha256(b"").hexdigest(), self.AK, self.SK, "us-east-1", "20130524T000000Z")
        self.assertTrue(auth.endswith("Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"), auth)


class S3ClientTest(unittest.TestCase):
    def setUp(self):
        self.fake, self.endpoint = start_fake_s3(self)
        self.client = S3(self.endpoint, "eu-central-2", "bkt", ACCESS, SECRET)
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(__import__("shutil").rmtree, self.tmp)

    def test_put_list_get_delete(self):
        src = self.tmp / "a.bin"
        src.write_bytes(b"x" * 3000)
        for name in ("p/1 ç.bin", "p/2.bin", "p/3.bin", "outro/4.bin"):
            self.client.put_file(name, src)
        self.assertEqual(sorted(o["key"] for o in self.client.list("p/")), ["p/1 ç.bin", "p/2.bin", "p/3.bin"], "todas as páginas")
        self.assertEqual(self.client.list("p/")[0]["size"], 3000)
        self.client.get_file("p/1 ç.bin", self.tmp / "b.bin")
        self.assertEqual((self.tmp / "b.bin").read_bytes(), b"x" * 3000)
        self.client.delete("p/2.bin")
        self.assertEqual(len(self.client.list("p/")), 2)

    def test_errors_are_short_and_without_secrets(self):
        with self.assertRaises(S3Error) as e:
            self.client.get_file("nope", self.tmp / "x")
        self.assertEqual(str(e.exception), "404 NoSuchKey")
        self.fake.deny = True
        with self.assertRaises(S3Error) as e:
            self.client.list("")
        self.assertEqual(str(e.exception), "403 AccessDenied")
        bad = S3("http://127.0.0.1:1", "r", "bkt", ACCESS, SECRET, timeout=2)
        with self.assertRaises(S3Error) as e:
            bad.list("")
        self.assertTrue(str(e.exception).startswith("network error"))
        self.assertNotIn(SECRET, str(e.exception))


def doc(text):
    return {"version": 0, "root": {"text": text, "children": []}}


class BackupTest(unittest.TestCase):
    def setUp(self):
        self.fake, self.endpoint = start_fake_s3(self)
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.store = Store(self.tmp / "brainstorm.db", self.tmp / "attachments")
        self.backup = Backup(self.store)
        # sem https: o S3 falso é http (a validação da API, que exige https, é testada à parte)
        self.store.set_setting("backup", {"endpoint": self.endpoint, "region": "eu-central-2", "bucket": "bkt", "prefix": "bs/",
                                          "accessKey": ACCESS, "secretKey": SECRET, "interval": 24, "keep": 3, "enabled": True})
        self.store.set_setting("llm", {"providers": {"openai": {"key": "sk-llm-segredo-1234"}}})
        self.store.reset_sessions_if_auth_changed("ana", "senha")
        self.token = self.store.create_session(3600)
        self.store.put("m1", doc("primeiro"), 0)
        (self.store.files("m1")).mkdir()
        (self.store.files("m1") / "a.png").write_bytes(b"imagem-1")
        self.store.put_folders({"version": 0, "folders": [{"id": "f1", "name": "Pasta", "parent": None}], "place": {"m1": "f1"}})

    def archive(self, name):
        return tarfile.open(fileobj=io.BytesIO(self.fake.objects["bs/" + name][0]), mode="r:gz")

    def test_archive_has_data_but_no_secrets(self):
        name = self.backup.run()
        self.assertRegex(name, NAME_RE)
        with self.archive(name) as tar:
            self.assertEqual(sorted(tar.getnames()), ["attachments/m1/a.png", "brainstorm.db"])
            raw = tar.extractfile("brainstorm.db").read()
        for secret in (SECRET.encode(), b"sk-llm-segredo", ACCESS.encode(), b"auth_fingerprint", self.store._hash(self.token).encode()):
            self.assertNotIn(secret, raw)
        db_file = self.tmp / "copy.db"
        db_file.write_bytes(raw)
        with closing(sqlite3.connect(db_file)) as db:
            tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            self.assertNotIn("settings", tables)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM docs").fetchone()[0], 1)
            self.assertEqual(sorted(r[0] for r in db.execute("SELECT key FROM meta")), ["folders", "schema"])
        self.assertFalse((self.store.files_dir / ".backup-tmp").exists(), "temporários apagados")
        self.assertEqual(self.backup.view()["status"]["lastName"], name)
        self.assertIsNone(self.backup.view()["status"]["lastError"])

    def test_failure_goes_to_the_status(self):
        self.fake.deny = True
        with self.assertRaises(BackupError):
            self.backup.run()
        st = self.backup.view()["status"]
        self.assertEqual((st["lastError"], st["lastSuccess"]), ("403 AccessDenied", None))
        self.assertFalse((self.store.files_dir / ".backup-tmp").exists())

    def test_retention_deletes_only_the_oldest_in_the_prefix(self):
        keep = {"bs/brainstorm-2020-01-01-000000.tar.gz", "bs/brainstorm-2020-01-02-000000.tar.gz", "bs/brainstorm-2020-01-03-000000.tar.gz"}
        others = {"outro/brainstorm-2000-01-01-000000.tar.gz", "bs/notas.txt", "bs/sub/brainstorm-2000-01-01-000000.tar.gz", "brainstorm-2000-01-01-000000.tar.gz"}
        for k in keep | others:
            self.fake.objects[k] = (b"x", "2020-01-01T00:00:00.000Z")
        name = self.backup.run()
        self.assertEqual(set(self.fake.objects), others | {"bs/brainstorm-2020-01-02-000000.tar.gz", "bs/brainstorm-2020-01-03-000000.tar.gz", "bs/" + name})
        self.assertEqual([b["name"] for b in self.backup.list()],
                         [name, "brainstorm-2020-01-03-000000.tar.gz", "brainstorm-2020-01-02-000000.tar.gz"], "mais novo primeiro, só do prefixo")

    def test_schedule_runs_only_when_due_and_changed(self):
        self.assertTrue(self.backup.tick())
        self.assertEqual(len(self.fake.objects), 1)
        self.assertFalse(self.backup.tick(), "intervalo não passou")
        later = time.time() + 25 * 3600
        self.assertFalse(self.backup.tick(later), "nada mudou")
        self.store.put("m2", doc("novo"), 0)
        self.assertFalse(self.backup.tick(), "mudou, mas o intervalo não passou")
        self.assertTrue(self.backup.tick(later))
        cfg = self.backup.config()
        self.store.set_setting("backup", {**cfg, "enabled": False})
        self.store.put("m3", doc("mais um"), 0)
        self.assertFalse(self.backup.tick(later + 25 * 3600), "desligado")

    def test_schedule_waits_after_a_failure(self):
        self.fake.deny = True
        self.assertTrue(self.backup.tick())
        self.fake.deny = False
        self.assertFalse(self.backup.tick(time.time() + 60), "não insiste a cada minuto")
        self.assertTrue(self.backup.tick(time.time() + 3601))

    def test_not_configured(self):
        self.store.set_setting("backup", {**self.backup.config(), "secretKey": ""})
        self.assertRaises(NotConfigured, self.backup.run)
        self.assertFalse(self.backup.tick())

    def test_make_server_does_not_start_the_schedule(self):
        server = app.make_server(self.tmp / "srv", 0)
        server.server_close()
        self.assertNotIn("backup-scheduler", [t.name for t in threading.enumerate()])

    def test_api_runs_and_lists(self):
        server = app.make_server(self.tmp, 0)
        server.backup.store.set_setting("backup", self.store.setting("backup"))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with urllib.request.urlopen(urllib.request.Request(base + "/api/backup/run", method="POST")) as r:
            view = json.loads(r.read())
        self.assertRegex(view["status"]["lastName"], NAME_RE)
        self.assertNotIn(SECRET, json.dumps(view))
        with urllib.request.urlopen(base + "/api/backup/list") as r:
            self.assertEqual([b["name"] for b in json.loads(r.read())], [view["status"]["lastName"]])
        self.fake.deny = True
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(base + "/api/backup/list")
        self.assertEqual((e.exception.code, json.loads(e.exception.read())), (502, {"error": "403 AccessDenied"}))
        e.exception.close()

    def test_config_validation(self):
        good = {"endpoint": "https://s3.eu-central-2.wasabisys.com/", "region": "eu-central-2", "bucket": "meu-bucket",
                "prefix": "brainstorm/", "accessKey": "AK", "secretKey": "SK", "interval": 24, "keep": 14, "enabled": True}
        self.assertEqual(clean_config(good)["endpoint"], "https://s3.eu-central-2.wasabisys.com")
        self.assertNotIn("secretKey", clean_config({k: v for k, v in good.items() if k != "secretKey"}))
        for bad in ({"endpoint": "http://s3.wasabisys.com"}, {"endpoint": "https://u:p@s3.wasabisys.com"}, {"endpoint": "https://h/x"},
                    {"endpoint": "https://"}, {"endpoint": "ftp://h"}, {"bucket": "A"}, {"bucket": "../x"}, {"region": "x/y"},
                    {"prefix": "/abs"}, {"secretKey": ""}, {"interval": 5}, {"interval": True}, {"keep": 0}, {"keep": 366},
                    {"keep": "3"}, {"enabled": 1}, {"accessKey": "a\nb"}):
            self.assertIsNone(clean_config({**good, **bad}), bad)
        self.assertIsNone(clean_config([]))


if __name__ == "__main__":
    unittest.main()
