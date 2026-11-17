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

from s3 import S3, S3Error, sign

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


if __name__ == "__main__":
    unittest.main()
