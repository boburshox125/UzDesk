"""Windows API helpers: DPI, mouse/keyboard input, cursor, clipboard, misc."""
import ctypes
import ctypes.wintypes as wt
import os
import subprocess
import sys
import time

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
ULONG_PTR = ctypes.c_size_t


def set_dpi_aware():
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
        return
    except Exception:
        pass
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass


# ---------------------------------------------------------------- SendInput
class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wt.LONG), ("dy", wt.LONG), ("mouseData", wt.DWORD),
                ("dwFlags", wt.DWORD), ("time", wt.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wt.WORD), ("wScan", wt.WORD), ("dwFlags", wt.DWORD),
                ("time", wt.DWORD), ("dwExtraInfo", ULONG_PTR)]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", wt.DWORD), ("wParamL", wt.WORD), ("wParamH", wt.WORD)]


class _INPUTU(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wt.DWORD), ("u", _INPUTU)]


user32.SendInput.argtypes = [wt.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
user32.SendInput.restype = wt.UINT
user32.MapVirtualKeyW.argtypes = [wt.UINT, wt.UINT]
user32.MapVirtualKeyW.restype = wt.UINT
user32.GetSystemMetrics.argtypes = [ctypes.c_int]
user32.GetSystemMetrics.restype = ctypes.c_int

INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
MOVE, ABSOLUTE, VIRTUALDESK = 0x0001, 0x8000, 0x4000
WHEEL, HWHEEL = 0x0800, 0x1000
BTN_FLAGS = {0: (0x0002, 0x0004, 0), 1: (0x0020, 0x0040, 0), 2: (0x0008, 0x0010, 0),
             3: (0x0080, 0x0100, 1), 4: (0x0080, 0x0100, 2)}
KEYUP, EXTENDED, UNICODE = 0x0002, 0x0001, 0x0004


def _send(*inputs):
    arr = (INPUT * len(inputs))(*inputs)
    user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT))


def _mouse(flags, dx=0, dy=0, data=0):
    i = INPUT(type=INPUT_MOUSE)
    i.u.mi = MOUSEINPUT(dx, dy, data & 0xFFFFFFFF, flags, 0, 0)
    return i


def virtual_screen():
    return (user32.GetSystemMetrics(76), user32.GetSystemMetrics(77),
            user32.GetSystemMetrics(78), user32.GetSystemMetrics(79))


def mouse_move_abs(px, py):
    vx, vy, vw, vh = virtual_screen()
    nx = int(round((px - vx) * 65535 / max(vw - 1, 1)))
    ny = int(round((py - vy) * 65535 / max(vh - 1, 1)))
    _send(_mouse(MOVE | ABSOLUTE | VIRTUALDESK, nx, ny))


def mouse_button(btn, down):
    f = BTN_FLAGS.get(int(btn))
    if not f:
        return
    _send(_mouse(f[0] if down else f[1], data=f[2]))


def mouse_wheel(dy=0, dx=0):
    ins = []
    if dy:
        ins.append(_mouse(WHEEL, data=int(dy)))
    if dx:
        ins.append(_mouse(HWHEEL, data=int(dx)))
    if ins:
        _send(*ins)


def key_vk(vk, down, extended=False):
    i = INPUT(type=INPUT_KEYBOARD)
    scan = user32.MapVirtualKeyW(vk, 0) & 0xFF
    flags = (0 if down else KEYUP) | (EXTENDED if extended else 0)
    i.u.ki = KEYBDINPUT(vk, scan, flags, 0, 0)
    _send(i)


def type_text(text):
    ins = []
    for ch in text:
        if ch == "\n" or ch == "\r":
            for d in (True, False):
                i = INPUT(type=INPUT_KEYBOARD)
                i.u.ki = KEYBDINPUT(0x0D, 0x1C, 0 if d else KEYUP, 0, 0)
                ins.append(i)
            continue
        data = ch.encode("utf-16-le")
        for k in range(0, len(data), 2):
            unit = int.from_bytes(data[k:k + 2], "little")
            for d in (True, False):
                i = INPUT(type=INPUT_KEYBOARD)
                i.u.ki = KEYBDINPUT(0, unit, UNICODE | (0 if d else KEYUP), 0, 0)
                ins.append(i)
    if ins:
        _send(*ins)


# KeyboardEvent.code -> (VK, extended)
KEYMAP = {}
for _i, _c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
    KEYMAP["Key" + _c] = (0x41 + _i, False)
for _i in range(10):
    KEYMAP["Digit%d" % _i] = (0x30 + _i, False)
    KEYMAP["Numpad%d" % _i] = (0x60 + _i, False)
for _i in range(1, 25):
    KEYMAP["F%d" % _i] = (0x6F + _i, False)
KEYMAP.update({
    "Enter": (0x0D, False), "Escape": (0x1B, False), "Backspace": (0x08, False),
    "Tab": (0x09, False), "Space": (0x20, False), "Minus": (0xBD, False),
    "Equal": (0xBB, False), "BracketLeft": (0xDB, False), "BracketRight": (0xDD, False),
    "Backslash": (0xDC, False), "Semicolon": (0xBA, False), "Quote": (0xDE, False),
    "Backquote": (0xC0, False), "Comma": (0xBC, False), "Period": (0xBE, False),
    "Slash": (0xBF, False), "CapsLock": (0x14, False), "IntlBackslash": (0xE2, False),
    "ShiftLeft": (0xA0, False), "ShiftRight": (0xA1, False),
    "ControlLeft": (0xA2, False), "ControlRight": (0xA3, True),
    "AltLeft": (0xA4, False), "AltRight": (0xA5, True),
    "MetaLeft": (0x5B, True), "MetaRight": (0x5C, True), "OSLeft": (0x5B, True),
    "OSRight": (0x5C, True), "ContextMenu": (0x5D, True),
    "PrintScreen": (0x2C, True), "ScrollLock": (0x91, False), "Pause": (0x13, False),
    "Insert": (0x2D, True), "Home": (0x24, True), "PageUp": (0x21, True),
    "Delete": (0x2E, True), "End": (0x23, True), "PageDown": (0x22, True),
    "ArrowRight": (0x27, True), "ArrowLeft": (0x25, True), "ArrowDown": (0x28, True),
    "ArrowUp": (0x26, True), "NumLock": (0x90, True), "NumpadDivide": (0x6F, True),
    "NumpadMultiply": (0x6A, False), "NumpadSubtract": (0x6D, False),
    "NumpadAdd": (0x6B, False), "NumpadEnter": (0x0D, True), "NumpadDecimal": (0x6E, False),
    "AudioVolumeMute": (0xAD, True), "AudioVolumeDown": (0xAE, True),
    "AudioVolumeUp": (0xAF, True), "MediaTrackNext": (0xB0, True),
    "MediaTrackPrevious": (0xB1, True), "MediaStop": (0xB2, True),
    "MediaPlayPause": (0xB3, True), "BrowserBack": (0xA6, True),
})


def key_code(code, down):
    m = KEYMAP.get(code)
    if not m:
        return False
    key_vk(m[0], down, m[1])
    return True


# ---------------------------------------------------------------- cursor
class POINT(ctypes.Structure):
    _fields_ = [("x", wt.LONG), ("y", wt.LONG)]


class CURSORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wt.DWORD), ("flags", wt.DWORD), ("hCursor", ctypes.c_void_p),
                ("ptScreenPos", POINT)]


user32.GetCursorInfo.argtypes = [ctypes.POINTER(CURSORINFO)]
user32.LoadCursorW.argtypes = [wt.HINSTANCE, ctypes.c_void_p]
user32.LoadCursorW.restype = ctypes.c_void_p

_CURSOR_NAMES = {32512: "default", 32513: "text", 32514: "wait", 32515: "crosshair",
                 32516: "default", 32642: "nwse-resize", 32643: "nesw-resize",
                 32644: "ew-resize", 32645: "ns-resize", 32646: "move", 32648: "not-allowed",
                 32649: "pointer", 32650: "progress", 32651: "help"}
_cursor_handles = {}


def _load_cursor_handles():
    for cid, name in _CURSOR_NAMES.items():
        try:
            h = user32.LoadCursorW(None, ctypes.c_void_p(cid))
            if h:
                _cursor_handles[h] = name
        except Exception:
            pass


def cursor_info():
    """Returns (x, y, visible, shape_name)."""
    if not _cursor_handles:
        _load_cursor_handles()
    ci = CURSORINFO()
    ci.cbSize = ctypes.sizeof(CURSORINFO)
    if not user32.GetCursorInfo(ctypes.byref(ci)):
        p = POINT()
        user32.GetCursorPos(ctypes.byref(p))
        return p.x, p.y, True, "default"
    visible = bool(ci.flags & 1)
    return ci.ptScreenPos.x, ci.ptScreenPos.y, visible, _cursor_handles.get(ci.hCursor, "default")


def cursor_pos():
    p = POINT()
    user32.GetCursorPos(ctypes.byref(p))
    return p.x, p.y


# ---------------------------------------------------------------- clipboard
CF_UNICODETEXT = 13
user32.OpenClipboard.argtypes = [wt.HWND]
user32.OpenClipboard.restype = wt.BOOL
user32.GetClipboardData.argtypes = [wt.UINT]
user32.GetClipboardData.restype = ctypes.c_void_p
user32.SetClipboardData.argtypes = [wt.UINT, ctypes.c_void_p]
user32.SetClipboardData.restype = ctypes.c_void_p
user32.GetClipboardSequenceNumber.restype = wt.DWORD
kernel32.GlobalAlloc.argtypes = [wt.UINT, ctypes.c_size_t]
kernel32.GlobalAlloc.restype = ctypes.c_void_p
kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
kernel32.GlobalFree.argtypes = [ctypes.c_void_p]


def _open_clip():
    for _ in range(10):
        if user32.OpenClipboard(None):
            return True
        time.sleep(0.02)
    return False


def get_clipboard():
    if not _open_clip():
        return None
    try:
        h = user32.GetClipboardData(CF_UNICODETEXT)
        if not h:
            return ""
        p = kernel32.GlobalLock(h)
        if not p:
            return ""
        try:
            return ctypes.wstring_at(p)
        finally:
            kernel32.GlobalUnlock(h)
    finally:
        user32.CloseClipboard()


def set_clipboard(text):
    data = text.encode("utf-16-le") + b"\x00\x00"
    if not _open_clip():
        return False
    try:
        user32.EmptyClipboard()
        h = kernel32.GlobalAlloc(0x0002, len(data))
        if not h:
            return False
        p = kernel32.GlobalLock(h)
        ctypes.memmove(p, data, len(data))
        kernel32.GlobalUnlock(h)
        if not user32.SetClipboardData(CF_UNICODETEXT, h):
            kernel32.GlobalFree(h)
            return False
        return True
    finally:
        user32.CloseClipboard()


def clipboard_seq():
    return user32.GetClipboardSequenceNumber()


# ---------------------------------------------------------------- misc
def lock_workstation():
    user32.LockWorkStation()


def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def relaunch_as_admin(extra_args=()):
    if getattr(sys, "frozen", False):
        exe, args = sys.executable, list(sys.argv[1:])
    else:
        exe, args = sys.executable, [os.path.abspath(sys.argv[0])] + list(sys.argv[1:])
    args += list(extra_args)
    params = subprocess.list2cmdline(args)
    r = ctypes.windll.shell32.ShellExecuteW(None, "runas", exe, params, None, 1)
    return r > 32


def power_action(action):
    flags = 0x08000000  # CREATE_NO_WINDOW
    if action == "shutdown":
        subprocess.Popen(["shutdown", "/s", "/t", "0"], creationflags=flags)
    elif action == "restart":
        subprocess.Popen(["shutdown", "/r", "/t", "0"], creationflags=flags)
    elif action == "sleep":
        subprocess.Popen(["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"], creationflags=flags)
    elif action == "logoff":
        subprocess.Popen(["shutdown", "/l"], creationflags=flags)


class SingleInstance:
    def __init__(self, name):
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        self.handle = kernel32.CreateMutexW(None, False, name)
        self.already = ctypes.get_last_error() == 183 or kernel32.GetLastError() == 183
