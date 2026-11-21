"""Screen capture: DXGI Desktop Duplication (dxcam) with GDI (mss) fallback."""
import logging
import threading
import time

import numpy as np

log = logging.getLogger("capture")


def list_monitors():
    import mss
    with mss.mss() as s:
        mons = s.monitors[1:] or s.monitors[:1]
        return [{"idx": i, "left": m["left"], "top": m["top"], "width": m["width"],
                 "height": m["height"], "name": "Ekran %d" % (i + 1)} for i, m in enumerate(mons)]


def _dxcam_for(left, top):
    import dxcam
    factory = dxcam.__dict__.get("__factory")
    if factory is not None:
        try:
            # drop cached (possibly released) instances so we get a fresh duplicator
            factory._camera_instances.clear()
        except Exception:
            pass
        for d, outs in enumerate(factory.outputs):
            for o, out in enumerate(outs):
                r = out.desc.DesktopCoordinates
                if r.left == left and r.top == top:
                    return dxcam.create(device_idx=d, output_idx=o, output_color="BGRA",
                                        max_buffer_len=2)
    cam = dxcam.create(output_color="BGRA", max_buffer_len=2)
    return cam


class Capturer:
    """Shared, thread-safe capturer for one monitor. grab() -> (frame, seq)."""

    def __init__(self, mon):
        self.mon = mon
        self.lock = threading.Lock()
        self.seq = 0
        self.last = None
        self.cam = None
        self.backend = "none"
        self._mss = threading.local()
        self._dx_fail_until = 0
        self._dx_none_since = None
        self._init_dx()

    def _init_dx(self):
        try:
            self.cam = _dxcam_for(self.mon["left"], self.mon["top"])
            if self.cam is None:
                raise RuntimeError("dxcam yaratilmadi")
            if (self.cam.width, self.cam.height) != (self.mon["width"], self.mon["height"]):
                log.info("dxcam size %sx%s differs from monitor %sx%s",
                         self.cam.width, self.cam.height, self.mon["width"], self.mon["height"])
            self.backend = "dxgi"
        except Exception as e:
            log.warning("dxcam unavailable: %s", e)
            self.cam = None
            self.backend = "gdi"
            self._dx_fail_until = time.time() + 30

    def _grab_mss(self):
        import mss
        s = getattr(self._mss, "s", None)
        if s is None:
            s = self._mss.s = mss.mss()
        m = self.mon
        img = s.grab({"left": m["left"], "top": m["top"], "width": m["width"], "height": m["height"]})
        return np.frombuffer(img.bgra, dtype=np.uint8).reshape(img.height, img.width, 4)

    def grab(self):
        with self.lock:
            frame = None
            if self.cam is not None:
                try:
                    frame = self.cam.grab()
                    if frame is None and self.last is None:
                        if self._dx_none_since is None:
                            self._dx_none_since = time.time()
                        elif time.time() - self._dx_none_since > 0.4:
                            frame = self._grab_mss()
                except Exception as e:
                    log.warning("dxcam grab failed, switching to GDI: %s", e)
                    try:
                        self.cam.release()
                    except Exception:
                        pass
                    self.cam = None
                    self.backend = "gdi"
                    self._dx_fail_until = time.time() + 5
            else:
                if time.time() > self._dx_fail_until and self._dx_fail_until:
                    self._dx_fail_until = 0
                    self._init_dx()
                    if self.cam is not None:
                        return self.last, self.seq
                try:
                    frame = self._grab_mss()
                    if self.last is not None and frame.shape == self.last.shape and \
                            np.array_equal(frame, self.last):
                        frame = None
                except Exception as e:
                    log.warning("GDI grab failed: %s", e)
                    time.sleep(0.05)
            if frame is not None:
                self.last = frame
                self.seq += 1
            return self.last, self.seq

    def close(self):
        with self.lock:
            if self.cam is not None:
                try:
                    self.cam.release()
                except Exception:
                    pass
                self.cam = None
