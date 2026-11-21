"""Application entry: logging, single instance, server thread, GUI (pywebview) + tray."""
import json
import logging
import logging.handlers
import os
import sys
import threading
import time
import urllib.request

from . import winapi
from .config import Config, app_dir

log = logging.getLogger("app")


def setup_logging():
    path = os.path.join(app_dir(), "uzdesk.log")
    h = logging.handlers.RotatingFileHandler(path, maxBytes=2_000_000, backupCount=2, encoding="utf-8")
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    h.setFormatter(fmt)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(h)
    if sys.stderr and not getattr(sys, "frozen", False):
        s = logging.StreamHandler()
        s.setFormatter(fmt)
        root.addHandler(s)


def _instance_file():
    return os.path.join(app_dir(), "instance.json")


def _signal_existing():
    try:
        with open(_instance_file(), "r", encoding="utf-8") as f:
            d = json.load(f)
        req = urllib.request.Request("http://127.0.0.1:%d/api/show" % d["port"], data=b"{}",
                                     method="POST", headers={"X-UzDesk-Key": d["token"],
                                                             "Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=3).read()
        return True
    except Exception:
        return False


def _make_icon_image():
    from PIL import Image, ImageDraw
    from .config import resource_path
    try:
        return Image.open(resource_path("assets", "uzdesk.png")).resize((64, 64))
    except Exception:
        pass
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((2, 2, 62, 62), 16, fill=(79, 70, 229, 255))
    d.rounded_rectangle((14, 18, 50, 42), 4, outline=(255, 255, 255, 255), width=4)
    d.rectangle((28, 42, 36, 48), fill=(255, 255, 255, 255))
    d.rectangle((22, 48, 42, 51), fill=(255, 255, 255, 255))
    return img


def main():
    winapi.set_dpi_aware()
    setup_logging()
    minimized = "--minimized" in sys.argv
    inst = winapi.SingleInstance("Global\\UzDeskHostMutex_v1")
    if inst.already and "--elevated" not in sys.argv:
        if _signal_existing():
            return
    if "--elevated" in sys.argv:
        time.sleep(1.5)  # let the non-elevated instance release the port

    from .server import UzServer
    cfg = Config()
    server = UzServer(cfg)
    server.start_in_thread()
    try:
        with open(_instance_file(), "w", encoding="utf-8") as f:
            json.dump({"port": server.gui_port, "token": server.gui_token, "pid": os.getpid()}, f)
    except Exception:
        pass

    try:
        run_gui(server, cfg, minimized)
    except Exception:
        log.exception("GUI failed; falling back to browser")
        import webbrowser
        webbrowser.open(server.gui_url("/ui/"))
        server.quit_event.wait()
    server.shutdown()
    os._exit(0)


def run_gui(server, cfg, minimized):
    import webview

    state = {"tray": None, "quitting": False}
    win = webview.create_window("UzDesk", server.gui_url("/ui/"), width=1120, height=760,
                                min_size=(900, 620), background_color="#0b1020", hidden=minimized)

    def show():
        try:
            win.show()
            win.restore()
        except Exception:
            pass

    def quit_app():
        state["quitting"] = True
        server.quit_event.set()

    def open_viewer(url, title):
        webview.create_window("UzDesk вЂ” %s" % title, url, width=1366, height=800,
                              min_size=(480, 320), background_color="#000000")

    server.open_viewer = open_viewer
    server.show_window = show

    def start_tray():
        try:
            import pystray
            menu = pystray.Menu(pystray.MenuItem("Ochish", lambda: show(), default=True),
                                pystray.MenuItem("Chiqish", lambda: quit_app()))
            icon = pystray.Icon("UzDesk", _make_icon_image(), "UzDesk вЂ” masofaviy boshqaruv", menu)
            state["tray"] = icon
            icon.run_detached()
        except Exception:
            log.exception("tray failed")

    def on_closing():
        if state["quitting"] or not cfg["tray_on_close"] or state["tray"] is None:
            server.quit_event.set()
            return True
        try:
            win.hide()
            return False
        except Exception:
            return True

    try:
        win.events.closing += on_closing
    except Exception:
        pass

    def watcher():
        server.quit_event.wait()
        state["quitting"] = True
        try:
            if state["tray"]:
                state["tray"].stop()
        except Exception:
            pass
        for w in list(webview.windows):
            try:
                w.destroy()
            except Exception:
                pass
        time.sleep(1.0)
        server.shutdown()
        os._exit(0)

    threading.Thread(target=watcher, daemon=True).start()
    start_tray()
    webview.start(private_mode=False, storage_path=os.path.join(app_dir(), "webview"))
    server.quit_event.set()
