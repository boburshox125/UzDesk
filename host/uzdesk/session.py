"""One streaming session per connected viewer: capture -> encode -> send, with flow control."""
import asyncio
import logging
import struct
import threading
import time

from . import encoder as enc_mod

log = logging.getLogger("session")

HEADER = struct.Struct(">BBHHId")  # kind, flags, w, h, frame id, server ts(ms)

DEFAULT_SETTINGS = {
    "codec": "h264",      # h264 | jpeg
    "fps": 30,
    "bitrate": 6000,      # kbps
    "scale": 1.0,         # 0.25..1
    "speed": "balanced",  # speed | balanced | quality
    "jpeg_q": 70,
    "monitor": 0,
    "encoder": "auto",
    "auto": True,         # adaptive bitrate
}


class StreamSession:
    def __init__(self, server, ws, loop, sid, name, peer, caps):
        self.server = server
        self.ws = ws
        self.loop = loop
        self.sid = sid
        self.name = name
        self.peer = peer
        self.caps = caps or {}
        self.since = time.time()
        self.settings = dict(DEFAULT_SETTINGS)
        if not self.caps.get("h264", True):
            self.settings["codec"] = "jpeg"
        self.cond = threading.Condition()
        self.inflight = {}  # frame id -> send time
        self.running = False
        self.reconfig = True
        self.need_key = True
        self.frame_id = 0
        self.min_rtt = 0.05
        self.rtt = 0.05
        self.thread = None
        self.monitor = None
        # stats
        self.stat_frames = 0
        self.stat_bytes = 0
        self.stat_t = time.time()
        self.fps_now = 0
        self.kbps_now = 0
        self.cur_bitrate = self.settings["bitrate"]
        self.cur_jpeg_q = self.settings["jpeg_q"]
        self.encoder_name = ""
        self.backend = ""
        self._congest = 0
        self._smooth_since = time.time()
        self.pressed_keys = set()
        self.pressed_buttons = set()

    # ------------------------------------------------------------ control
    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._run, name="stream-%s" % self.sid, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        with self.cond:
            self.cond.notify_all()

    def update_settings(self, d):
        changed = False
        with self.cond:
            for k, v in d.items():
                if k in DEFAULT_SETTINGS and self.settings.get(k) != v:
                    self.settings[k] = v
                    changed = True
            if changed:
                self.cur_bitrate = int(self.settings["bitrate"])
                self.cur_jpeg_q = int(self.settings["jpeg_q"])
                self.reconfig = True
                self.need_key = True
                self.cond.notify_all()

    def request_key(self):
        with self.cond:
            self.need_key = True
            self.cond.notify_all()

    def on_ack(self, fid):
        now = time.time()
        with self.cond:
            t = self.inflight.pop(fid, None)
            # acks are in order; drop anything older too
            for k in [k for k in self.inflight if k < fid]:
                self.inflight.pop(k, None)
            if t is not None:
                r = now - t
                self.rtt = self.rtt * 0.8 + r * 0.2
                self.min_rtt = min(self.min_rtt * 1.002 + 0.0001, r)
            self.cond.notify_all()

    # ------------------------------------------------------------ helpers
    def _send_json(self, obj):
        try:
            fut = asyncio.run_coroutine_threadsafe(self.ws.send_json(obj), self.loop)
            fut.result(timeout=10)
            return True
        except Exception:
            self.running = False
            return False

    def _send_bytes(self, data):
        try:
            fut = asyncio.run_coroutine_threadsafe(self.ws.send_bytes(data), self.loop)
            fut.result(timeout=15)
            return True
        except Exception:
            self.running = False
            return False

    def _max_inflight(self, interval):
        n = int(self.min_rtt / max(interval, 0.001)) + 2
        return max(2, min(n, 10))

    def _build_encoder(self):
        s = self.settings
        mons = self.server.monitors()
        idx = int(s.get("monitor", 0))
        if idx >= len(mons):
            idx = 0
        self.monitor = mons[idx]
        scale = max(0.2, min(1.0, float(s.get("scale", 1.0))))
        w = self.monitor["width"] * scale
        h = self.monitor["height"] * scale
        fps = max(5, min(120, int(s.get("fps", 30))))
        codec = s.get("codec", "h264")
        e = None
        if codec == "h264":
            name = enc_mod.pick_encoder(s.get("encoder", "auto"))
            tried = []
            for cand in [name] + ([n for n in enc_mod.available_encoders() if n != name]):
                if not cand or cand in tried:
                    continue
                tried.append(cand)
                try:
                    e = enc_mod.H264Encoder(w, h, fps, self.cur_bitrate, cand, s.get("speed", "balanced"))
                    break
                except Exception as ex:
                    log.warning("encoder %s failed: %s", cand, ex)
                    e = None
            if e is None:
                codec = "jpeg"
        if e is None:
            e = enc_mod.JpegEncoder(w, h, self.cur_jpeg_q)
            codec = "jpeg"
        self.encoder_name = e.name
        cap = self.server.capturer(idx)
        self.backend = cap.backend
        self._send_json({"t": "config", "codec": codec, "w": e.w, "h": e.h, "fps": fps,
                         "encoder": e.name, "monitor": idx, "capture": cap.backend,
                         "mon": {"w": self.monitor["width"], "h": self.monitor["height"]}})
        return e, cap, fps

    def _adapt(self, e, blocked, now):
        if not self.settings.get("auto", True):
            return
        if blocked:
            self._congest += 1
            self._smooth_since = now
            if self._congest >= 6:
                self._congest = 0
                if e.kind == 1:
                    nb = max(500, int(self.cur_bitrate * 0.8))
                    if nb != self.cur_bitrate and e.set_bitrate(nb):
                        self.cur_bitrate = nb
                else:
                    self.cur_jpeg_q = max(30, self.cur_jpeg_q - 8)
                    e.set_quality(self.cur_jpeg_q)
        elif now - self._smooth_since > 3:
            self._smooth_since = now
            self._congest = 0
            if e.kind == 1:
                target = int(self.settings["bitrate"])
                if self.cur_bitrate < target:
                    nb = min(target, int(self.cur_bitrate * 1.15) + 100)
                    if e.set_bitrate(nb):
                        self.cur_bitrate = nb
            else:
                target = int(self.settings["jpeg_q"])
                if self.cur_jpeg_q < target:
                    self.cur_jpeg_q = min(target, self.cur_jpeg_q + 5)
                    e.set_quality(self.cur_jpeg_q)

    # ------------------------------------------------------------ main loop
    def _run(self):
        e = cap = None
        fps = 30
        last_seq = -1
        last_change = time.time()
        refine = 0
        next_t = time.time()
        try:
            while self.running:
                if self.reconfig:
                    with self.cond:
                        self.reconfig = False
                        self.inflight.clear()
                    if e is not None:
                        e.close()
                    e, cap, fps = self._build_encoder()
                    last_seq = -1
                interval = 1.0 / fps

                # ---- flow control: never queue more than the link can carry
                blocked = False
                with self.cond:
                    t0 = time.time()
                    while self.running and not self.reconfig and \
                            len(self.inflight) >= self._max_inflight(interval):
                        blocked = True
                        self.cond.wait(0.05)
                        if self.inflight and time.time() - min(self.inflight.values()) > 4:
                            self.inflight.clear()  # lost acks; resync
                            self.need_key = True
                    if blocked and time.time() - t0 < interval * 0.5:
                        blocked = False
                if not self.running:
                    break
                if self.reconfig:
                    continue

                now = time.time()
                if now < next_t:
                    time.sleep(min(next_t - now, 0.05))
                    continue

                frame, seq = cap.grab()
                if frame is None:
                    time.sleep(0.01)
                    continue
                need_key = self.need_key
                changed = seq != last_seq
                now = time.time()
                if changed:
                    last_change = now
                    refine = 0
                elif not need_key:
                    if e.kind == 1 and refine < 2 and now - last_change > 0.35:
                        refine += 1  # re-encode static frame to sharpen text
                    else:
                        next_t = now + min(interval, 0.016)
                        self._stats(now)
                        continue
                last_seq = seq
                if frame.shape[1] != self.monitor["width"] or frame.shape[0] != self.monitor["height"]:
                    # resolution changed (display settings) -> rebuild
                    self.server.refresh_monitors()
                    self.reconfig = True
                    continue
                with self.cond:
                    self.need_key = False
                try:
                    data, key = e.encode(frame, force_key=need_key)
                except Exception as ex:
                    log.exception("encode failed: %s", ex)
                    self.reconfig = True
                    time.sleep(0.2)
                    continue
                next_t = max(next_t + interval, now + interval * 0.5)
                if not data:
                    continue
                self.frame_id = (self.frame_id + 1) & 0xFFFFFFFF
                fid = self.frame_id
                hdr = HEADER.pack(e.kind, 1 if key else 0, e.w, e.h, fid, now * 1000.0)
                with self.cond:
                    self.inflight[fid] = time.time()
                if not self._send_bytes(hdr + data):
                    break
                self.stat_frames += 1
                self.stat_bytes += len(data)
                self._adapt(e, blocked, now)
                self._stats(now)
        except Exception as ex:
            log.exception("session crashed: %s", ex)
        finally:
            if e is not None:
                e.close()
            self.running = False

    def _stats(self, now):
        dt = now - self.stat_t
        if dt >= 1.0:
            self.fps_now = round(self.stat_frames / dt, 1)
            self.kbps_now = int(self.stat_bytes * 8 / dt / 1000)
            self.stat_frames = 0
            self.stat_bytes = 0
            self.stat_t = now
            self._send_json({"t": "stats", "fps": self.fps_now, "kbps": self.kbps_now,
                             "bitrate": self.cur_bitrate, "q": self.cur_jpeg_q,
                             "encoder": self.encoder_name, "capture": self.backend,
                             "rtt": int(self.rtt * 1000)})

    def info(self):
        return {"id": self.sid, "name": self.name, "peer": self.peer, "since": self.since,
                "codec": self.settings.get("codec"), "fps": self.fps_now, "kbps": self.kbps_now,
                "encoder": self.encoder_name}
