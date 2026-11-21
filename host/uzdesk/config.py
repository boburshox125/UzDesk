import json
import os
import secrets
import socket
import sys
import threading

DEFAULTS = {
    "port": 8765,
    "device_name": "",
    "pin": "",
    "password": "",
    "device_id": "",
    "require_approval": False,
    "trusted": [],
    "tray_on_close": True,
    "autostart": False,
    "tunnel_autostart": False,
    "id_service": True,
    "discovery": True,
    "clipboard_sync": True,
    "allow_files": True,
    "allow_power": True,
    "saved_hosts": [],
}


def app_dir():
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    d = os.path.join(base, "UzDesk")
    os.makedirs(d, exist_ok=True)
    return d


def resource_path(*parts):
    if getattr(sys, "frozen", False):
        base = sys._MEIPASS  # type: ignore[attr-defined]
        return os.path.join(base, *parts)
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # host/
    if parts and parts[0] == "client":
        return os.path.join(os.path.dirname(here), *parts)
    return os.path.join(here, *parts)


def downloads_dir():
    d = os.path.join(os.path.expanduser("~"), "Downloads", "UzDesk")
    os.makedirs(d, exist_ok=True)
    return d


def new_pin():
    return "".join(secrets.choice("0123456789") for _ in range(6))


class Config:
    def __init__(self):
        self.path = os.path.join(app_dir(), "config.json")
        self.lock = threading.Lock()
        self.data = dict(DEFAULTS)
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                self.data.update(json.load(f))
        except Exception:
            pass
        changed = False
        if not self.data.get("pin"):
            self.data["pin"] = new_pin()
            changed = True
        if not self.data.get("device_id"):
            self.data["device_id"] = "".join(secrets.choice("0123456789") for _ in range(10))
            if self.data["device_id"][0] == "0":
                self.data["device_id"] = "7" + self.data["device_id"][1:]
            changed = True
        if not self.data.get("device_name"):
            self.data["device_name"] = socket.gethostname()
            changed = True
        if changed:
            self.save()

    def __getitem__(self, k):
        return self.data.get(k, DEFAULTS.get(k))

    def get(self, k, d=None):
        return self.data.get(k, d)

    def set(self, **kw):
        with self.lock:
            self.data.update(kw)
        self.save()

    def save(self):
        with self.lock:
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, self.path)


def set_autostart(enabled):
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                             r"Software\Microsoft\Windows\CurrentVersion\Run", 0,
                             winreg.KEY_SET_VALUE)
        if enabled:
            if getattr(sys, "frozen", False):
                cmd = '"%s" --minimized' % sys.executable
            else:
                cmd = '"%s" "%s" --minimized' % (sys.executable, os.path.abspath(sys.argv[0]))
            winreg.SetValueEx(key, "UzDesk", 0, winreg.REG_SZ, cmd)
        else:
            try:
                winreg.DeleteValue(key, "UzDesk")
            except FileNotFoundError:
                pass
        winreg.CloseKey(key)
        return True
    except Exception:
        return False
