# -*- coding: utf-8 -*-
"""
图匣 PicVault — 网页版后端（纯标准库，无需安装第三方包）

功能：
  1. 抓取用户输入的电商详情页 HTML，解析出全部商品图片地址
  2. 代理图片字节流（带 Referer），绕开浏览器跨域限制，供前端转 PNG / 打 ZIP

运行：
  py server.py           # 默认端口 8787
  py server.py 9000      # 自定义端口
  然后浏览器打开 http://127.0.0.1:8787
"""
from __future__ import annotations

import gzip
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import uuid
from html.parser import HTMLParser

try:
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
except Exception:  # pragma: no cover
    from BaseHTTPServer import BaseHTTPRequestHandler
    from SocketServer import ThreadingMixIn

    class ThreadingHTTPServer(ThreadingMixIn, BaseHTTPRequestHandler):  # type: ignore
        pass

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, "static")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8787"))

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
MAX_IMAGES = 500
JOBS = {}  # jobId -> {title, url, images}


# ---------------------------------------------------------------- fetch / decode

def fetch(url: str, referer: str | None = None, timeout: int = 25):
    req = urllib.request.Request(url)
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "*/*")
    req.add_header("Accept-Encoding", "identity")
    req.add_header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
    if referer:
        req.add_header("Referer", referer)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
        ctype = resp.headers.get("Content-Type", "")
        final_url = resp.geturl()
    if data[:2] == b"\x1f\x8b":
        try:
            data = gzip.decompress(data)
        except Exception:
            pass
    return data, ctype, final_url


def decode_text(data: bytes, ctype: str) -> str:
    charset = None
    m = re.search(rb'charset=["\']?\s*([a-zA-Z0-9\-]+)', data[:4000])
    if m:
        charset = m.group(1).decode("ascii", "ignore")
    m2 = re.search(r"charset=([a-zA-Z0-9\-]+)", ctype, re.I)
    if not charset and m2:
        charset = m2.group(1)
    for enc in [charset, "utf-8", "gb18030", "gbk"]:
        if not enc:
            continue
        try:
            return data.decode(enc)
        except Exception:
            continue
    return data.decode("utf-8", "ignore")


# ---------------------------------------------------------------- image parsing

class ImgParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []  # (raw, source, alt)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        style = a.get("style", "")
        if "url(" in style:
            for m in re.findall(r"url\((['\"]?)(.*?)\1\)", style, re.I):
                self.out.append((m[1], "bg", ""))

        if tag == "img":
            alt = a.get("alt", "") or a.get("title", "")
            for k in (
                "data-src", "data-original", "data-lazy-src", "data-ks-lazyload",
                "data-lazyload", "data-lazy", "data-url", "data-echo",
            ):
                v = a.get(k)
                if v:
                    self.out.append((v, "img", alt))
            if a.get("src"):
                self.out.append((a["src"], "img", alt))
            for k in ("data-srcset", "srcset"):
                v = a.get(k)
                if v:
                    self.out.append((last_srcset(v), "img", alt))
        elif tag == "source":
            v = a.get("srcset") or a.get("src")
            if v:
                self.out.append((last_srcset(v), "img", ""))
        elif tag == "meta":
            prop = (a.get("property") or a.get("name") or "").lower()
            if prop in ("og:image", "twitter:image"):
                c = a.get("content")
                if c:
                    self.out.append((c, "meta", ""))
        elif tag == "link":
            if (a.get("rel") or "").lower() == "image_src":
                h = a.get("href")
                if h:
                    self.out.append((h, "meta", ""))


def last_srcset(srcset: str) -> str | None:
    parts = [p.strip().split()[0] for p in srcset.split(",") if p.strip()]
    return parts[-1] if parts else None


def normalize(raw: str, base: str) -> str | None:
    if not raw:
        return None
    u = raw.strip().strip("'\"")
    if not u or u.startswith("data:") or u.startswith("blob:"):
        return None
    if u.startswith("//"):
        u = "https:" + u
    if u.startswith("/") or not re.match(r"^https?://", u, re.I):
        u = urllib.parse.urljoin(base, u)
    if not re.match(r"^https?://", u, re.I):
        return None
    return u.split("#")[0]


def upgrade(u: str) -> str:
    u = re.sub(r"_\d+x\d+[a-z]*(\.(?:jpg|jpeg|png|webp|gif))", r"\1", u, flags=re.I)
    u = re.sub(r"\.(jpg|jpeg|png|webp)_[a-z0-9]+\.", r".\1.", u, flags=re.I)
    u = re.sub(r"_\.(jpg|jpeg|png|webp)", r".\1", u, flags=re.I)
    u = re.sub(r"q[5-9]0(\.(?:jpg|jpeg|png|webp))", r"q100\1", u, flags=re.I)
    u = re.sub(r"\.avif", ".jpg", u, flags=re.I)
    u = re.sub(r"/s\d+x\d+_jfs/", "/s800x800_jfs/", u, flags=re.I)
    u = re.sub(r"/n[1-5]/", "/n1/", u)
    u = re.sub(r"!q\d+\.dpg", "", u, flags=re.I)
    u = re.sub(r"\.dpg(\?|$)", ".jpg", u, flags=re.I)
    u = re.sub(r"\?imageMogr2.*$", "", u, flags=re.I)
    u = re.sub(r"/resize/[^/]+", "", u, flags=re.I)
    u = re.sub(r"\._(?:[A-Z]{1,3}\d+){1,}(?:_[A-Z]+\d+)*", "", u)
    u = re.sub(r"\._AC_.*?(?=\.(jpe?g|png|webp|gif))", "", u, flags=re.I)
    return u


JUNK = re.compile(
    r"sprite|icon|logo|avatar|emoji|blank|placeholder|loading|1x1|pixel|beacon|"
    r"tracker|favicon|qrcode|qr_code|\.svg(?:\?|$)|data:image/svg|googleapis\.com/icon",
    re.I,
)


def is_likely(u: str) -> bool:
    if re.search(r"\.(jpe?g|png|webp|gif|bmp|avif)(\?|$)", u, re.I):
        return True
    if "/jfs/" in u:
        return True
    if re.search(
        r"img\.alicdn|alicdn\.com|360buyimg|pddpic|pinduoduo|media-amazon|"
        r"ssl-images-amazon|xhscdn|sns-img|jd\.com/.*img",
        u,
        re.I,
    ):
        return True
    if re.search(r"/img/|/image/|/images/|/pic/", u, re.I):
        return True
    return False


def score(source: str, url: str) -> int:
    s = {"gallery": 40, "meta": 30, "detail": 25, "img": 15, "bg": 8}.get(source, 10)
    if re.search(r"alicdn|360buyimg|pddpic|media-amazon|xhscdn", url, re.I):
        s += 8
    if re.search(r"avatar|logo|icon", url, re.I):
        s -= 40
    return s


def walk_json(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, list):
        for n in node:
            yield from walk_json(n)
    elif isinstance(node, dict):
        for n in node.values():
            yield from walk_json(n)


def extract_images(url: str):
    data, ctype, final_url = fetch(url)
    html = decode_text(data, ctype)
    base = final_url or url

    parser = ImgParser()
    try:
        parser.feed(html)
    except Exception:
        pass

    seen = set()
    images = []

    def add(raw, source, alt="", bonus=0):
        u = upgrade(normalize(raw, base) or "")
        if not u or u in seen:
            return
        if JUNK.search(u) or not is_likely(u):
            return
        seen.add(u)
        images.append({"url": u, "source": source, "alt": alt[:80], "score": score(source, u) + bonus})

    for raw, source, alt in parser.out:
        add(raw, source, alt)

    # JSON-LD
    for m in re.finditer(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.S | re.I):
        try:
            obj = json.loads(m.group(1))
            for v in walk_json(obj):
                add(v, "meta", "", 5)
        except Exception:
            pass

    # 兜底：HTML / 内嵌 JSON 里的图片 URL
    for m in re.finditer(r'https?://[^\s"\'<>\\]+?\.(?:jpe?g|png|webp|gif)(?:\?[^\s"\'<>\\]*)?', html, re.I):
        add(m.group(0), "img")

    images.sort(key=lambda x: -x["score"])
    images = images[:MAX_IMAGES]

    title = ""
    tm = re.search(r'<meta[^>]+(?:property|name)=["\']og:title["\'][^>]+content=["\']([^"\']+)', html, re.I)
    if not tm:
        tm = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']og:title["\']', html, re.I)
    if tm:
        title = tm.group(1)
    else:
        tt = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
        if tt:
            title = re.sub(r"\s+", " ", tt.group(1)).strip()

    return {"title": title[:120], "url": final_url, "host": hostname(final_url), "images": images}


def hostname(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).hostname or ""
    except Exception:
        return ""


# ---------------------------------------------------------------- proxy

def guess_mime(url: str) -> str:
    p = urllib.parse.urlparse(url).path.lower()
    if p.endswith(".png"):
        return "image/png"
    if p.endswith(".webp"):
        return "image/webp"
    if p.endswith(".gif"):
        return "image/gif"
    if p.endswith(".bmp"):
        return "image/bmp"
    if p.endswith(".avif"):
        return "image/avif"
    return "image/jpeg"


# ---------------------------------------------------------------- HTTP server

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "PicVault/1.0"

    def log_message(self, fmt, *args):  # quieter logs
        sys.stderr.write("[picvault] %s\n" % (fmt % args))

    # ---- helpers
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, body, ctype, status=200):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def send_static(self, path: str):
        if path in ("/", ""):
            path = "/index.html"
        rel = urllib.parse.unquote(path).lstrip("/")
        safe = os.path.normpath(os.path.join(STATIC, rel))
        if not safe.startswith(os.path.normpath(STATIC)) or not os.path.isfile(safe):
            self.send_json({"ok": False, "error": "not found"}, 404)
            return
        ext = os.path.splitext(safe)[1].lower()
        with open(safe, "rb") as f:
            body = f.read()
        self.send_bytes(body, MIME.get(ext, "application/octet-stream"))

    # ---- routes
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = dict(urllib.parse.parse_qsl(parsed.query))

        if path == "/api/proxy":
            self.api_proxy(qs)
            return
        if path == "/api/health":
            self.send_json({"ok": True, "service": "picvault", "version": "1.2.0"})
            return
        if path.startswith("/api/job/"):
            job_id = path[len("/api/job/"):].strip("/")
            self.api_job(job_id)
            return
        self.send_static(path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/extract":
            self.send_json({"ok": False, "error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            obj = json.loads(body.decode("utf-8"))
            url = (obj.get("url") or "").strip()
        except Exception:
            self.send_json({"ok": False, "error": "请求格式错误"}, 400)
            return
        if not re.match(r"^https?://", url, re.I):
            self.send_json({"ok": False, "error": "请输入 http/https 商品链接"}, 400)
            return
        try:
            result = extract_images(url)
        except Exception as e:
            self.send_json({"ok": False, "error": "抓取失败：%s" % e}, 502)
            return
        job_id = uuid.uuid4().hex[:16]
        JOBS[job_id] = result
        self.send_json({"ok": True, "jobId": job_id, "count": len(result["images"])})

    def api_job(self, job_id: str):
        job = JOBS.get(job_id)
        if not job:
            self.send_json({"ok": False, "error": "任务不存在或已过期"}, 404)
            return
        self.send_json({"ok": True, "job": job})

    def api_proxy(self, qs: dict):
        url = qs.get("url", "")
        ref = qs.get("ref", "")
        if not re.match(r"^https?://", url, re.I):
            self.send_json({"ok": False, "error": "invalid url"}, 400)
            return
        try:
            data, ctype, _ = fetch(url, referer=ref or None)
        except Exception as e:
            self.send_json({"ok": False, "error": "图片拉取失败：%s" % e}, 502)
            return
        if not ctype or "octet-stream" in ctype or ctype.startswith("text/"):
            ctype = guess_mime(url)
        self.send_bytes(data, ctype)


def main():
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("图匣 PicVault 网页版已启动： http://0.0.0.0:%d" % PORT)
    print("按 Ctrl+C 停止")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
        srv.shutdown()


if __name__ == "__main__":
    main()
