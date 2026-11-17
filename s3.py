"""Cliente S3 mínimo (Wasabi e outros compatíveis) só com a stdlib: endereço path-style e assinatura SigV4."""
import hashlib
import hmac
import shutil
import urllib.error
import urllib.request
# respostas XML do próprio endpoint configurado; o expat da stdlib não busca entidades externas e,
# desde o 2.4.1 (Python 3.13 traz um mais novo), barra a expansão em cadeia ("billion laughs")
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None  # redirecionamento vira erro: a requisição assinada não vai para outro endereço


_opener = urllib.request.build_opener(_NoRedirect)


class S3Error(Exception):
    """Erro curto (status + código S3, ou falha de rede), sem endereço nem credenciais."""


def _hmac(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def sign(method, host, path, query, headers, payload_hash, access_key, secret_key, region, amz_date):
    """Valor do cabeçalho Authorization (AWS Signature Version 4, serviço s3).

    path já codificado como vai na requisição; query: dict de valores crus; headers: os que entram na assinatura
    (host, x-amz-date e x-amz-content-sha256 são acrescentados aqui).
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
        except (urllib.error.URLError, OSError) as e:
            raise S3Error(f"network error: {getattr(e, 'reason', e)}") from None

    def put_file(self, key, path):
        size = path.stat().st_size
        with open(path, "rb") as f:  # sha256 calculado antes (o corpo vai em streaming, assinado)
            self._request("PUT", key, data=f, payload_hash=file_sha256(path),
                          headers={"Content-Length": str(size), "Content-Type": "application/gzip"}).close()

    def get_file(self, key, path):
        with self._request("GET", key) as resp, open(path, "wb") as f:
            shutil.copyfileobj(resp, f, 1 << 20)

    def delete(self, key):
        self._request("DELETE", key).close()

    def list(self, prefix):
        """[{key, size, modified}] de tudo com esse prefixo (ListObjectsV2, todas as páginas)."""
        out, token = [], None
        while True:
            query = {"list-type": "2", "prefix": prefix, **({"continuation-token": token} if token else {})}
            with self._request("GET", query=query) as resp:
                root = ET.fromstring(resp.read())
            for c in root.iterfind("{*}Contents"):
                out.append({"key": c.findtext("{*}Key"), "size": int(c.findtext("{*}Size") or 0),
                            "modified": c.findtext("{*}LastModified") or ""})
            token = root.findtext("{*}NextContinuationToken")
            if root.findtext("{*}IsTruncated") != "true" or not token:
                return out
