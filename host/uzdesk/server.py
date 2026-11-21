"""aiohttp servers: public viewer endpoint (WebSocket) + local-only GUI/API endpoint."""
import asyncio
import json
import logging
import os
import secrets
import socket
import threading
import time

from aiohttp import web, WSMsgType

from . import __version__
from . import winapi
from .capture import Capturer, list_monitors
from .config import downloads_dir, new_pin, resource_path, set_autostart
from . import encoder as enc_mod
from .encoder import ENCODER_LABELS, available_encoders
from .session import StreamSession
from .tunnel import IdPublisher, Tunnel

log = logging.getLogger("server")
DISCOVERY_PORT = 8766


def lan_addresses():
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    good = [ip for ip in ips if not ip.startswith(("127.", "169.254."))]
    # prefer typical home networks first
    good.sort(key=lambda ip: (not ip.startswith("192.168."), not ip.startswith("10."), ip))
    return good


class UzServer:
    def __init__(self, cfg):
        self.cfg = cfg
        self.loop = None
        self.sessions = {}
        self.pending = {}
        self.capturers = {}
        self._monitors = None
        self._mon_lock = threading.Lock()
        self.fails = {}
        self.gui_token = secrets.token_urlsafe(16)
        self.gui_port = 0
        self.port = int(cfg["port"])
        self.discovered = {}
        self.events = []
        self.ready = threading.Event()
        self.quit_event = threading.Event()
        self.open_viewer = None     # set by GUI: callable(url, title)
        self.show_window = None     # set by GUI
        self.start_error = ""
        self._clip_last = None
        self.tunnel = Tunnel(self.port, self._on_net_change)
        self.idpub = IdPublisher(cfg, self.id_payload)

    # ------------------------------------------------------------ helpers
    def log_event(self, text):
        self.events.append({"t": time.time(), "text": text})
        self.events = self.events[-50:]
        log.info(text)

    def monitors(self):
        with self._mon_lock:
            if self._monitors is None:
                self._monitors = list_monitors()
            return self._monitors

    def refresh_monitors(self):
        with self._mon_lock:
            self._monitors = None
            for c in self.capturers.values():
                c.close()
            self.capturers = {}

    def capturer(self, idx):
        mons = self.monitors()
        with self._mon_lock:
            c = self.capturers.get(idx)
            if c is None:
                c = self.capturers[idx] = Capturer(mons[idx])
            return c

    def id_payload(self):
        return {"v": 1, "name": self.cfg["device_name"], "url": self.tunnel.url,
                "lan": ["%s:%d" % (ip, self.port) for ip in lan_addresses()], "ts": int(time.time())}

    def _on_net_change(self):
        self.idpub.poke()

    def gui_url(self, path):
        sep = "&" if "?" in path else "?"
        return "http://127.0.0.1:%d%s%sk=%s" % (self.gui_port, path, sep, self.gui_token)

    def secret_ok(self, given):
        given = str(given or "").strip()
        if not given:
            return False
        if secrets.compare_digest(given, str(self.cfg["pin"])):
            return True
        pw = self.cfg["password"]
        return bool(pw) and secrets.compare_digest(given, str(pw))

    @staticmethod
    def client_ip(request):
        peer = request.remote or "?"
        if peer in ("127.0.0.1", "::1"):
            fwd = request.headers.get("Cf-Connecting-Ip") or request.headers.get("X-Forwarded-For")
            if fwd:
                return fwd.split(",")[0].strip() + " (internet)"
        return peer

    # ------------------------------------------------------------ start
    def start_in_thread(self):
        t = threading.Thread(target=self._thread_main, daemon=True, name="server")
        t.start()
        self.ready.wait(15)

    def _thread_main(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        try:
            self.loop.run_until_complete(self._start())
        except Exception as e:
            log.exception("server start failed")
            self.start_error = str(e)
            self.ready.set()
            return
        self.ready.set()
        self.loop.run_forever()

    async def _start(self):
        client_dir = resource_path("client")
        ui_dir = resource_path("ui")

        pub = web.Application(client_max_size=1024 ** 4)
        pub.router.add_get("/", self.root_redirect)
        pub.router.add_get("/ws", self.ws_handler)
        pub.router.add_get("/info", self.info_handler)
        pub.router.add_post("/upload", self.upload_handler)
        pub.router.add_get("/client/", lambda r: web.FileResponse(os.path.join(client_dir, "index.html")))
        pub.router.add_static("/client/", client_dir)
        pub.on_response_prepare.append(self._no_cache)
        runner = web.AppRunner(pub, access_log=None)
        await runner.setup()
        try:
            await web.TCPSite(runner, "0.0.0.0", self.port, reuse_address=True).start()
        except OSError as e:
            self.start_error = "Port %d band: %s" % (self.port, e)
            log.error(self.start_error)

        gui = web.Application(middlewares=[self._gui_auth])
        gui.router.add_get("/ui/", lambda r: web.FileResponse(os.path.join(ui_dir, "index.html")))
        gui.router.add_static("/ui/", ui_dir)
        gui.router.add_get("/client/", lambda r: web.FileResponse(os.path.join(client_dir, "index.html")))
        gui.router.add_static("/client/", client_dir)
        gui.router.add_get("/api/state", self.api_state)
        gui.router.add_get("/api/discovered", self.api_discovered)
        gui.router.add_post("/api/{action}", self.api_action)
        gui.on_response_prepare.append(self._no_cache)
        grunner = web.AppRunner(gui, access_log=None)
        await grunner.setup()
        gsite = web.TCPSite(grunner, "127.0.0.1", 0)
        await gsite.start()
        self.gui_port = gsite._server.sockets[0].getsockname()[1]

        self.loop.create_task(self._clipboard_watch())
        self.loop.create_task(self._sessions_gc())
        threading.Thread(target=self._discovery_listen, daemon=True).start()
        threading.Thread(target=self._discovery_beacon, daemon=True).start()
        if self.cfg["tunnel_autostart"]:
            self.tunnel.start()
        self.idpub.poke()
        threading.Thread(target=available_encoders, daemon=True).start()

    async def _no_cache(self, request, response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Access-Control-Allow-Origin"] = "*"

    @web.middleware
    async def _gui_auth(self, request, handler):
        # token in query (first load) or cookie (subsequent asset/api calls)
        tok = request.query.get("k") or request.cookies.get("uzk") or request.headers.get("X-UzDesk-Key")
        if request.remote not in ("127.0.0.1", "::1") or not tok or \
                not secrets.compare_digest(tok, self.gui_token):
            raise web.HTTPForbidden(text="forbidden")
        resp = await handler(request)
        if request.query.get("k"):
            resp.set_cookie("uzk", self.gui_token, httponly=True, samesite="Strict")
        return resp

    # ------------------------------------------------------------ public handlers
    async def root_redirect(self, request):
        raise web.HTTPFound("/client/")

    async def info_handler(self, request):
        return web.json_response({"app": "UzDesk", "version": __version__,
                                  "name": self.cfg["device_name"]})

    async def upload_handler(self, request):
        sid = request.query.get("sid", "")
        tok = request.query.get("tok", "")
        s = self.sessions.get(sid)
        if not s or not secrets.compare_digest(tok, getattr(s, "upload_token", "")):
            raise web.HTTPForbidden()
        if not self.cfg["allow_files"]:
            raise web.HTTPForbidden(text="Fayl qabul qilish o'chirilgan")
        reader = await request.multipart()
        saved = []
        while True:
            part = await reader.next()
            if part is None:
                break
            if not part.filename:
                continue
            name = os.path.basename(part.filename.replace("\\", "/")) or "fayl"
            dst_dir = downloads_dir()
            base, ext = os.path.splitext(name)
            dst = os.path.join(dst_dir, name)
            n = 1
            while os.path.exists(dst):
                dst = os.path.join(dst_dir, "%s (%d)%s" % (base, n, ext))
                n += 1
            with open(dst, "wb") as f:
                while True:
                    chunk = await part.read_chunk(1024 * 512)
                    if not chunk:
                        break
                    f.write(chunk)
            saved.append(os.path.basename(dst))
        if saved:
            self.log_event("%s fayl yubordi: %s" % (s.name, ", ".join(saved)))
        return web.json_response({"ok": True, "saved": saved, "dir": downloads_dir()})

    async def ws_handler(self, request):
        ws = web.WebSocketResponse(heartbeat=5.0, max_msg_size=16 * 1024 * 1024, compress=False)
        await ws.prepare(request)
        peer = self.client_ip(request)
        session = None
        cursor_task = None
        try:
            try:
                msg = await ws.receive(timeout=15)
            except asyncio.TimeoutError:
                return ws
            if msg.type != WSMsgType.TEXT:
                return ws
            hello = json.loads(msg.data)
            if hello.get("t") != "hello":
                return ws

            key = peer.split(" ")[0]
            f = self.fails.get(key)
            if f and f["until"] > time.time():
                await ws.send_json({"t": "auth_fail", "reason": "locked",
                                    "retry": int(f["until"] - time.time())})
                return ws
            if not self.secret_ok(hello.get("pin")):
                f = self.fails.setdefault(key, {"n": 0, "until": 0})
                f["n"] += 1
                if f["n"] >= 5:
                    f["until"] = time.time() + min(30 * 2 ** (f["n"] - 5), 3600)
                self.log_event("Noto'g'ri PIN: %s" % peer)
                await asyncio.sleep(0.6)
                await ws.send_json({"t": "auth_fail", "reason": "pin"})
                return ws
            self.fails.pop(key, None)

            name = str(hello.get("name") or "Qurilma")[:40]
            dev = str(hello.get("device") or "")[:64]
            if self.cfg["require_approval"] and dev not in self.cfg["trusted"]:
                await ws.send_json({"t": "wait"})
                fut = self.loop.create_future()
                pid = secrets.token_hex(4)
                self.pending[pid] = {"id": pid, "name": name, "peer": peer, "fut": fut, "device": dev}
                if self.show_window:
                    try:
                        self.show_window()
                    except Exception:
                        pass
                try:
                    decision = await asyncio.wait_for(fut, 60)
                except asyncio.TimeoutError:
                    decision = "deny"
                finally:
                    self.pending.pop(pid, None)
                if decision == "always" and dev:
                    self.cfg.set(trusted=list(set(self.cfg["trusted"] + [dev])))
                if decision not in ("once", "always"):
                    await ws.send_json({"t": "auth_fail", "reason": "denied"})
                    return ws

            sid = secrets.token_hex(4)
            session = StreamSession(self, ws, self.loop, sid, name, peer, hello.get("caps"))
            session.upload_token = secrets.token_urlsafe(16)
            if isinstance(hello.get("settings"), dict):
                session.update_settings(hello["settings"])
            self.sessions[sid] = session
            await ws.send_json({
                "t": "auth_ok", "sid": sid, "upload": session.upload_token,
                "name": self.cfg["device_name"], "version": __version__,
                "monitors": self.monitors(),
                "encoders": [{"id": n, "label": ENCODER_LABELS.get(n, n)} for n in available_encoders()],
                "settings": session.settings,
                "features": {"files": bool(self.cfg["allow_files"]), "power": bool(self.cfg["allow_power"]),
                             "clipboard": bool(self.cfg["clipboard_sync"])},
            })
            self.log_event("Ulandi: %s (%s)" % (name, peer))
            session.start()
            cursor_task = self.loop.create_task(self._cursor_loop(session))
            if self.cfg["clipboard_sync"]:
                txt = winapi.get_clipboard()
                if txt:
                    await ws.send_json({"t": "clip", "s": txt[:1_000_000], "initial": True})

            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        self.handle_input(session, json.loads(msg.data))
                    except Exception as e:
                        log.debug("bad msg: %s", e)
                elif msg.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
                    break
                if not session.running and session.thread and not session.thread.is_alive():
                    break
        except Exception as e:
            log.info("ws closed: %s", e)
        finally:
            if cursor_task:
                cursor_task.cancel()
            if session:
                session.stop()
                self._release_inputs(session)
                self.sessions.pop(session.sid, None)
                self.log_event("Uzildi: %s" % session.name)
            if not ws.closed:
                await ws.close()
        return ws

    def _release_inputs(self, s):
        for code in list(s.pressed_keys):
            winapi.key_code(code, False)
        for b in list(s.pressed_buttons):
            winapi.mouse_button(b, False)
        s.pressed_keys.clear()
        s.pressed_buttons.clear()

    def _abs(self, s, x, y):
        m = s.monitor or self.monitors()[0]
        x = min(max(float(x), 0.0), 1.0)
        y = min(max(float(y), 0.0), 1.0)
        return m["left"] + x * (m["width"] - 1), m["top"] + y * (m["height"] - 1)

    def handle_input(self, s, m):
        t = m.get("t")
        if t == "ack":
            s.on_ack(int(m.get("id", 0)))
        elif t == "m":
            winapi.mouse_move_abs(*self._abs(s, m["x"], m["y"]))
        elif t == "mr":
            mon = s.monitor or self.monitors()[0]
            cx, cy = winapi.cursor_pos()
            nx = cx + float(m["dx"]) * mon["width"]
            ny = cy + float(m["dy"]) * mon["height"]
            nx = min(max(nx, mon["left"]), mon["left"] + mon["width"] - 1)
            ny = min(max(ny, mon["top"]), mon["top"] + mon["height"] - 1)
            winapi.mouse_move_abs(nx, ny)
        elif t == "md":
            if "x" in m:
                winapi.mouse_move_abs(*self._abs(s, m["x"], m["y"]))
            b = int(m.get("b", 0))
            s.pressed_buttons.add(b)
            winapi.mouse_button(b, True)
        elif t == "mu":
            if "x" in m:
                winapi.mouse_move_abs(*self._abs(s, m["x"], m["y"]))
            b = int(m.get("b", 0))
            s.pressed_buttons.discard(b)
            winapi.mouse_button(b, False)
        elif t == "w":
            winapi.mouse_wheel(int(m.get("dy", 0)), int(m.get("dx", 0)))
        elif t == "kd":
            code = m.get("code", "")
            if winapi.key_code(code, True):
                s.pressed_keys.add(code)
            elif m.get("key") and len(m["key"]) == 1:
                winapi.type_text(m["key"])
        elif t == "ku":
            code = m.get("code", "")
            s.pressed_keys.discard(code)
            winapi.key_code(code, False)
        elif t == "txt":
            winapi.type_text(str(m.get("s", ""))[:5000])
        elif t == "combo":
            codes = [c for c in m.get("keys", []) if c in winapi.KEYMAP]
            for c in codes:
                winapi.key_code(c, True)
            for c in reversed(codes):
                winapi.key_code(c, False)
        elif t == "release":
            self._release_inputs(s)
        elif t == "settings":
            s.update_settings({k: v for k, v in m.items() if k != "t"})
        elif t == "kf":
            s.request_key()
        elif t == "ping":
            self.loop.create_task(s.ws.send_json({"t": "pong", "ts": m.get("ts")}))
        elif t == "clip":
            txt = str(m.get("s", ""))
            self._clip_last = txt
            winapi.set_clipboard(txt)
        elif t == "clipget":
            txt = winapi.get_clipboard() or ""
            self.loop.create_task(s.ws.send_json({"t": "clip", "s": txt[:1_000_000], "manual": True}))
        elif t == "action":
            self.do_action(s, m.get("a"))

    def do_action(self, s, a):
        if a == "lock":
            winapi.lock_workstation()
        elif a == "taskmgr":
            winapi.key_vk(0xA2, True); winapi.key_vk(0xA0, True); winapi.key_vk(0x1B, True)
            winapi.key_vk(0x1B, False); winapi.key_vk(0xA0, False); winapi.key_vk(0xA2, False)
        elif a in ("shutdown", "restart", "sleep", "logoff"):
            if self.cfg["allow_power"]:
                self.log_event("%s: %s" % (s.name, a))
                winapi.power_action(a)

    async def _cursor_loop(self, s):
        last = None
        try:
            while True:
                await asyncio.sleep(1 / 60)
                m = s.monitor
                if not m:
                    continue
                x, y, vis, shape = winapi.cursor_info()
                inside = m["left"] <= x < m["left"] + m["width"] and m["top"] <= y < m["top"] + m["height"]
                cur = (round((x - m["left"]) / max(m["width"], 1), 5),
                       round((y - m["top"]) / max(m["height"], 1), 5), inside, shape)
                if cur != last:
                    last = cur
                    await s.ws.send_json({"t": "cur", "x": cur[0], "y": cur[1], "v": cur[2], "s": cur[3]})
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    async def _clipboard_watch(self):
        seq = winapi.clipboard_seq()
        while True:
            await asyncio.sleep(0.7)
            try:
                n = winapi.clipboard_seq()
                if n == seq:
                    continue
                seq = n
                if not self.cfg["clipboard_sync"] or not self.sessions:
                    continue
                txt = winapi.get_clipboard()
                if not txt or txt == self._clip_last:
                    continue
                self._clip_last = txt
                for s in list(self.sessions.values()):
                    try:
                        await s.ws.send_json({"t": "clip", "s": txt[:1_000_000]})
                    except Exception:
                        pass
            except Exception:
                pass

    async def _sessions_gc(self):
        while True:
            await asyncio.sleep(5)
            now = time.time()
            self.fails = {k: v for k, v in self.fails.items() if v["until"] > now or v["n"] < 5}

    # ------------------------------------------------------------ discovery
    def _discovery_beacon(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        while not self.quit_event.is_set():
            if self.cfg["discovery"]:
                msg = json.dumps({"uzdesk": 1, "name": self.cfg["device_name"], "port": self.port,
                                  "id": self.cfg["device_id"], "v": __version__}).encode()
                targets = {"255.255.255.255"}
                for ip in lan_addresses():
                    p = ip.split(".")
                    targets.add(".".join(p[:3] + ["255"]))
                for tgt in targets:
                    try:
                        sock.sendto(msg, (tgt, DISCOVERY_PORT))
                    except Exception:
                        pass
            self.quit_event.wait(2.0)

    def _discovery_listen(self):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("", DISCOVERY_PORT))
        except Exception as e:
            log.info("discovery listen failed: %s", e)
            return
        while not self.quit_event.is_set():
            try:
                data, addr = sock.recvfrom(2048)
                d = json.loads(data.decode("utf-8", "replace"))
                if d.get("uzdesk") and d.get("id") != self.cfg["device_id"]:
                    d["ip"] = addr[0]
                    d["seen"] = time.time()
                    self.discovered[d["id"]] = d
            except Exception:
                pass

    # ------------------------------------------------------------ GUI api
    async def api_state(self, request):
        now = time.time()
        return web.json_response({
            "version": __version__, "name": self.cfg["device_name"], "port": self.port,
            "pin": self.cfg["pin"], "password_set": bool(self.cfg["password"]),
            "device_id": self.cfg["device_id"], "addresses": lan_addresses(),
            "tunnel": self.tunnel.status(), "error": self.start_error,
            "clients": [s.info() for s in self.sessions.values()],
            "pending": [{k: v for k, v in p.items() if k != "fut"} for p in self.pending.values()],
            "events": self.events[-15:], "admin": winapi.is_admin(),
            "encoders": [ENCODER_LABELS.get(n, n) for n in (enc_mod._available or [])],
            "settings": {k: self.cfg[k] for k in ("require_approval", "tray_on_close", "autostart",
                                                  "tunnel_autostart", "id_service", "discovery",
                                                  "clipboard_sync", "allow_files", "allow_power")},
            "saved_hosts": self.cfg["saved_hosts"],
            "discovered": [d for d in self.discovered.values() if now - d["seen"] < 8],
            "downloads": downloads_dir(),
        })

    async def api_discovered(self, request):
        now = time.time()
        return web.json_response([d for d in self.discovered.values() if now - d["seen"] < 8])

    async def api_action(self, request):
        a = request.match_info["action"]
        try:
            body = await request.json()
        except Exception:
            body = {}
        if a == "pin":
            self.cfg.set(pin=new_pin())
        elif a == "password":
            pw = str(body.get("password", ""))
            if pw and len(pw) < 4:
                return web.json_response({"ok": False, "error": "Parol kamida 4 belgi"})
            self.cfg.set(password=pw)
        elif a == "name":
            n = str(body.get("name", "")).strip()[:40]
            if n:
                self.cfg.set(device_name=n)
                self.idpub.poke()
        elif a == "settings":
            allowed = {"require_approval", "tray_on_close", "autostart", "tunnel_autostart",
                       "id_service", "discovery", "clipboard_sync", "allow_files", "allow_power"}
            upd = {k: bool(v) for k, v in body.items() if k in allowed}
            if "autostart" in upd:
                set_autostart(upd["autostart"])
            self.cfg.set(**upd)
            if upd.get("id_service"):
                self.idpub.poke()
        elif a == "trusted_clear":
            self.cfg.set(trusted=[])
        elif a == "tunnel":
            if body.get("on"):
                self.tunnel.start()
            else:
                self.tunnel.stop()
        elif a == "kick":
            s = self.sessions.get(body.get("id"))
            if s:
                await s.ws.close()
        elif a == "approve":
            p = self.pending.get(body.get("id"))
            if p and not p["fut"].done():
                p["fut"].set_result(body.get("decision", "deny"))
        elif a == "save_host":
            hosts = [h for h in self.cfg["saved_hosts"] if h.get("target") != body.get("target")]
            if body.get("target"):
                hosts.insert(0, {"target": body["target"], "name": body.get("name") or body["target"],
                                 "pin": body.get("pin", "") if body.get("remember") else ""})
            self.cfg.set(saved_hosts=hosts[:30])
        elif a == "delete_host":
            self.cfg.set(saved_hosts=[h for h in self.cfg["saved_hosts"] if h.get("target") != body.get("target")])
        elif a == "open_client":
            from urllib.parse import urlencode
            qs = urlencode({"connect": body.get("target", ""), "pin": body.get("pin", ""),
                            "name": body.get("name", ""), "embedded": "1"})
            url = self.gui_url("/client/?" + qs)
            if self.open_viewer:
                threading.Thread(target=self.open_viewer, args=(url, body.get("name") or "UzDesk"),
                                 daemon=True).start()
            else:
                import webbrowser
                webbrowser.open(url)
        elif a == "elevate":
            if winapi.relaunch_as_admin(["--elevated"]):
                self.loop.call_later(0.5, self.quit_event.set)
            else:
                return web.json_response({"ok": False})
        elif a == "open_folder":
            os.startfile(downloads_dir())
        elif a == "open_url":
            import webbrowser
            u = str(body.get("url", ""))
            if u.startswith("https://"):
                webbrowser.open(u)
        elif a == "show":
            if self.show_window:
                threading.Thread(target=self.show_window, daemon=True).start()
        elif a == "quit":
            self.loop.call_later(0.2, self.quit_event.set)
        else:
            raise web.HTTPNotFound()
        return web.json_response({"ok": True})

    def shutdown(self):
        self.tunnel.stop()
        for c in self.capturers.values():
            c.close()
