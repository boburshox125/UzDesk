"""Internet access through a Cloudflare quick tunnel + device-ID lookup via ntfy.sh."""
import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.request

from .config import app_dir, resource_path

log = logging.getLogger("tunnel")
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
CLOUDFLARED_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
NTFY = "https://ntfy.sh/"


def find_cloudflared():
    for p in (resource_path("bin", "cloudflared.exe"), os.path.join(app_dir(), "cloudflared.exe")):
        if os.path.isfile(p):
            return p
    return shutil.which("cloudflared")


def download_cloudflared():
    dst = os.path.join(app_dir(), "cloudflared.exe")
    tmp = dst + ".part"
    log.info("downloading cloudflared ...")
    with urllib.request.urlopen(CLOUDFLARED_URL, timeout=60) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f)
    os.replace(tmp, dst)
    return dst


class Tunnel:
    def __init__(self, port, on_change):
        self.port = port
        self.on_change = on_change
        self.proc = None
        self.url = ""
        self.state = "off"  # off | starting | online | error
        self.error = ""
        self.wanted = False
        self._thread = None

    def status(self):
        return {"state": self.state, "url": self.url, "error": self.error}

    def start(self):
        if self.wanted:
            return
        self.wanted = True
        self._thread = threading.Thread(target=self._loop, daemon=True, name="tunnel")
        self._thread.start()

    def stop(self):
        self.wanted = False
        p = self.proc
        if p:
            try:
                p.terminate()
            except Exception:
                pass
        self._set("off", "")

    def _set(self, state, url=None, error=""):
        self.state = state
        if url is not None:
            self.url = url
        self.error = error
        try:
            self.on_change()
        except Exception:
            pass

    def _loop(self):
        backoff = 2
        while self.wanted:
            self._set("starting", "")
            exe = find_cloudflared()
            if not exe:
                try:
                    exe = download_cloudflared()
                except Exception as e:
                    self._set("error", "", "cloudflared yuklab bo'lmadi: %s" % e)
                    time.sleep(10)
                    continue
            try:
                self.proc = subprocess.Popen(
                    [exe, "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:%d" % self.port],
                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
                    creationflags=0x08000000)
            except Exception as e:
                self._set("error", "", str(e))
                time.sleep(10)
                continue
            got = False
            for raw in iter(self.proc.stderr.readline, b""):
                line = raw.decode("utf-8", "replace")
                m = URL_RE.search(line)
                if m and not got:
                    got = True
                    backoff = 2
                    # give the edge a moment to register the hostname
                    threading.Timer(2.0, lambda u=m.group(0): self._set("online", u)).start()
                if not self.wanted:
                    break
            try:
                self.proc.wait(timeout=5)
            except Exception:
                pass
            self.proc = None
            if self.wanted:
                self._set("error", "", "Tunnel uzildi, qayta ulanmoqda...")
                time.sleep(backoff)
                backoff = min(backoff * 2, 30)


class IdPublisher:
    """Publishes current addresses under the device ID so clients can find this PC by ID."""

    def __init__(self, cfg, get_payload):
        self.cfg = cfg
        self.get_payload = get_payload
        self._last = None
        self._last_t = 0
        self._ev = threading.Event()
        threading.Thread(target=self._loop, daemon=True, name="idpub").start()

    def poke(self):
        self._ev.set()

    def _loop(self):
        while True:
            self._ev.wait(60)
            self._ev.clear()
            if not self.cfg["id_service"]:
                continue
            try:
                payload = self.get_payload()
                body = json.dumps(payload, sort_keys=True)
                key = json.dumps({k: v for k, v in payload.items() if k != "ts"}, sort_keys=True)
                if key == self._last and time.time() - self._last_t < 6 * 3600:
                    continue
                req = urllib.request.Request(NTFY + "uzdesk_" + self.cfg["device_id"],
                                             data=body.encode(), method="POST",
                                             headers={"Title": "uzdesk", "Cache": "yes"})
                urllib.request.urlopen(req, timeout=15).read()
                self._last, self._last_t = key, time.time()
            except Exception as e:
                log.info("id publish failed: %s", e)
                time.sleep(5)
                self._ev.set()
