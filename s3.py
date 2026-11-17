"""Minimal S3 client (Wasabi and other compatible services) using only the stdlib: path-style addressing and SigV4 signing."""
import hashlib
import hmac
import http.client
import time
import urllib.error
import urllib.request
# XML responses from the configured endpoint itself; the stdlib expat does not fetch external entities and,
# since 2.4.1 (Python 3.13 ships a newer one), blocks chained expansion ("billion laughs")
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
TRANSFER_DEADLINE = 1800  # seconds per upload/download: the socket timeout is per operation, a slow server would hold the lock forever


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None  # a redirect becomes an error: the signed request must not go to another address


_opener = urllib.request.build_opener(_NoRedirect)


class S3Error(Exception):
    """Short error (status + S3 code, or network failure), with no address or credentials."""


def _hmac(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def sign(method, host, path, query, headers, payload_hash, access_key, secret_key, region, amz_date):
    """Value of the Authorization header (AWS Signature Version 4, s3 service).

    path is already encoded as it goes in the request; query: dict of raw values; headers: the ones that are signed
    (host, x-amz-date and x-amz-content-sha256 are added here).
    """
    signed = {k.lower(): str(v).strip() for k, v in headers.items()}
    signed.update({"host": host, "x-amz-date": amz_date, "x-amz-content-sha256": payload_hash})
    names = sorted(signed)
    canonical = "\n".join([
        method, path,
        "&".join(f"{quote(k, safe='-_.~')}={quote(str(v), safe='-_.~')}" for k, v in sorted(query.items())),
        "".join(f"{k}:{signed[k]}\n" for k in names), ";".join(names), payload_hash])
    scope = f"{amz_date[:8]}/{region}/s3/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    key = _hmac(_hmac(_hmac(_hmac(f"AWS4{secret_key}".encode(), amz_date[:8]), region), "s3"), "aws4_request")
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    return f"AWS4-HMAC-SHA256 Credential={access_key}/{scope},SignedHeaders={';'.join(names)},Signature={signature}"


def file_sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


class _Deadline:
    """File reader (for uploads) that gives up when the total deadline is exceeded."""

    def __init__(self, f):
        self.f, self.end = f, time.monotonic() + TRANSFER_DEADLINE

    def read(self, n=-1):
        if time.monotonic() > self.end:
            raise S3Error("timeout")
        return self.f.read(n)


class S3:
    def __init__(self, endpoint, region, bucket, access_key, secret_key, timeout=60):
        self.endpoint, self.region, self.bucket = endpoint.rstrip("/"), region, bucket
        self.access_key, self.secret_key, self.timeout = access_key, secret_key, timeout
        parts = urlsplit(self.endpoint)
        self.host, self.base_path = parts.netloc, parts.path

    def _request(self, method, key="", query=None, data=None, payload_hash=EMPTY_SHA256, headers=None):
        query = query or {}
        path = quote(f"{self.base_path}/{self.bucket}" + (f"/{key}" if key else ""), safe="/-_.~")
        amz_date = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        headers = dict(headers or {})
        auth = sign(method, self.host, path, query, headers, payload_hash, self.access_key, self.secret_key, self.region, amz_date)
        qs = "&".join(f"{quote(k, safe='-_.~')}={quote(str(v), safe='-_.~')}" for k, v in sorted(query.items()))
        url = f"{urlsplit(self.endpoint).scheme}://{self.host}{path}" + (f"?{qs}" if qs else "")
        headers.update({"Authorization": auth, "x-amz-date": amz_date, "x-amz-content-sha256": payload_hash})
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            return _opener.open(req, timeout=self.timeout)
        except urllib.error.HTTPError as e:
            with e:
                body = e.read(10_000)
            try:
                code = ET.fromstring(body).findtext("Code") or ""
            except ET.ParseError:
                code = ""
            raise S3Error(f"{e.code} {code}".strip()) from None
        except (OSError, http.client.HTTPException, ValueError) as e:  # URLError is an OSError
            raise S3Error(f"network error: {getattr(e, 'reason', e) or type(e).__name__}") from None

    def put_file(self, key, path):
        size = path.stat().st_size
        with open(path, "rb") as f:  # sha256 computed beforehand (the body is streamed, signed)
            self._request("PUT", key, data=_Deadline(f), payload_hash=file_sha256(path),
                          headers={"Content-Length": str(size), "Content-Type": "application/gzip"}).close()

    def get_file(self, key, path):
        with self._request("GET", key) as resp, open(path, "wb") as f:
            end = time.monotonic() + TRANSFER_DEADLINE
            try:
                while chunk := resp.read(1 << 20):
                    if time.monotonic() > end:
                        raise S3Error("timeout")
                    f.write(chunk)
            except (OSError, http.client.HTTPException) as e:  # connection dropped mid-download
                raise S3Error(f"network error: {e or type(e).__name__}") from None

    def delete(self, key):
        self._request("DELETE", key).close()

    def list(self, prefix):
        """[{key, size, modified}] of everything with this prefix (ListObjectsV2, all pages)."""
        out, token = [], None
        while True:
            query = {"list-type": "2", "prefix": prefix, **({"continuation-token": token} if token else {})}
            with self._request("GET", query=query) as resp:
                body = resp.read()
            try:  # 200 with XML that is not from S3 (wrong address, proxy)
                root = ET.fromstring(body)
                if not root.tag.endswith("ListBucketResult"):
                    raise ValueError
                for c in root.iterfind("{*}Contents"):
                    out.append({"key": c.findtext("{*}Key"), "size": int(c.findtext("{*}Size") or 0),
                                "modified": c.findtext("{*}LastModified") or ""})
            except (ET.ParseError, ValueError):
                raise S3Error("invalid response") from None
            token = root.findtext("{*}NextContinuationToken")
            if root.findtext("{*}IsTruncated") != "true" or not token:
                return out
