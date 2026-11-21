"""Video encoders: H.264 (x264 / NVENC / QuickSync / AMF) and JPEG."""
import fractions
import logging

import av
import numpy as np

log = logging.getLogger("encoder")

try:
    from av.video.frame import PictureType
    KEY_TYPE = PictureType.I
except Exception:  # older PyAV
    KEY_TYPE = "I"

HW_ENCODERS = ["h264_nvenc", "h264_qsv", "h264_amf"]
ENCODER_LABELS = {"libx264": "CPU (x264)", "h264_nvenc": "NVIDIA NVENC",
                  "h264_qsv": "Intel QuickSync", "h264_amf": "AMD AMF"}

_available = None


def nal_types(d, limit=4096):
    out, i, n = [], 0, min(len(d), limit)
    while i + 3 < n:
        if d[i] == 0 and d[i + 1] == 0 and d[i + 2] == 1:
            out.append(d[i + 3] & 0x1F)
            i += 3
        else:
            i += 1
    return out


def has_idr(d):
    """True if Annex-B data contains an IDR slice (some HW encoders don't flag keyframes)."""
    return 5 in nal_types(d)


def even(v):
    v = int(v)
    return max(16, v - (v % 2))


def _options(name, fps, kbps, speed, gop):
    if name == "libx264":
        preset = {"speed": "ultrafast", "balanced": "superfast", "quality": "veryfast"}.get(speed, "superfast")
        return {
            "preset": preset, "tune": "zerolatency", "forced-idr": "1",
            "x264-params": "keyint=%d:min-keyint=%d:scenecut=0:repeat-headers=1:bframes=0:"
                           "rc-lookahead=0:sync-lookahead=0:vbv-maxrate=%d:vbv-bufsize=%d"
                           % (gop, gop, int(kbps * 1.2), max(int(kbps / 2), 300)),
        }
    if name == "h264_nvenc":
        preset = {"speed": "p1", "balanced": "p3", "quality": "p5"}.get(speed, "p3")
        return {"preset": preset, "tune": "ull", "zerolatency": "1", "rc": "cbr",
                "delay": "0", "forced-idr": "1", "bf": "0"}
    if name == "h264_qsv":
        preset = {"speed": "veryfast", "balanced": "faster", "quality": "medium"}.get(speed, "faster")
        return {"preset": preset, "async_depth": "1", "look_ahead": "0", "bf": "0", "forced_idr": "1"}
    if name == "h264_amf":
        q = {"speed": "speed", "balanced": "balanced", "quality": "quality"}.get(speed, "balanced")
        return {"usage": "ultralowlatency", "quality": q, "rc": "cbr", "bf": "0",
                "header_spacing": str(gop)}
    return {}


class H264Encoder:
    kind = 1

    def __init__(self, width, height, fps, kbps, name="libx264", speed="balanced"):
        self.w, self.h = even(width), even(height)
        self.fps = max(1, int(fps))
        self.name = name
        self.pix_fmt = "nv12" if name == "h264_qsv" else "yuv420p"
        gop = self.fps * 10
        ctx = av.CodecContext.create(name, "w")
        ctx.width, ctx.height = self.w, self.h
        ctx.pix_fmt = self.pix_fmt
        ctx.time_base = fractions.Fraction(1, self.fps)
        ctx.framerate = fractions.Fraction(self.fps, 1)
        ctx.bit_rate = int(kbps * 1000)
        ctx.gop_size = gop
        try:
            ctx.max_b_frames = 0
        except Exception:
            pass
        ctx.options = _options(name, self.fps, kbps, speed, gop)
        ctx.open()
        self.ctx = ctx
        self.pts = 0
        self.kbps = kbps

    def set_bitrate(self, kbps):
        if self.name != "libx264":
            return False
        try:
            self.ctx.bit_rate = int(kbps * 1000)
            self.kbps = kbps
            return True
        except Exception:
            return False

    def encode(self, bgra, force_key=False):
        f = av.VideoFrame.from_ndarray(bgra, format="bgra")
        f = f.reformat(width=self.w, height=self.h, format=self.pix_fmt)
        if force_key:
            f.pict_type = KEY_TYPE
        f.pts = self.pts
        self.pts += 1
        out = []
        key = False
        for p in self.ctx.encode(f):
            out.append(bytes(p))
            key = key or p.is_keyframe
        data = b"".join(out)
        return data, key or has_idr(data)

    def close(self):
        try:
            for _ in self.ctx.encode(None):
                pass
        except Exception:
            pass
        self.ctx = None


class JpegEncoder:
    kind = 2

    def __init__(self, width, height, quality=75):
        self.w, self.h = even(width), even(height)
        self.quality = int(quality)
        self.name = "jpeg"
        self.kbps = 0
        try:
            import simplejpeg
            self._sj = simplejpeg
        except Exception:
            self._sj = None

    def set_quality(self, q):
        self.quality = int(max(10, min(100, q)))

    def encode(self, bgra, force_key=False):
        h, w = bgra.shape[:2]
        if (w, h) != (self.w, self.h):
            f = av.VideoFrame.from_ndarray(bgra, format="bgra").reformat(
                width=self.w, height=self.h, format="bgra")
            bgra = f.to_ndarray()
        bgra = np.ascontiguousarray(bgra)
        if self._sj is not None:
            return self._sj.encode_jpeg(bgra, quality=self.quality, colorspace="BGRA",
                                        colorsubsampling="420", fastdct=True), True
        from PIL import Image
        import io
        img = Image.frombuffer("RGBA", (bgra.shape[1], bgra.shape[0]), bgra, "raw", "BGRA", 0, 1)
        buf = io.BytesIO()
        img.convert("RGB").save(buf, "JPEG", quality=self.quality)
        return buf.getvalue(), True

    def close(self):
        pass


def available_encoders():
    """Probe which H.264 encoders actually work on this machine (cached)."""
    global _available
    if _available is not None:
        return _available
    res = []
    test = np.zeros((256, 256, 4), dtype=np.uint8)
    test[:, :, 1] = 128
    for name in HW_ENCODERS + ["libx264"]:
        try:
            e = H264Encoder(256, 256, 30, 1000, name)
            ok = False
            for i in range(4):
                d, _k = e.encode(test, force_key=(i in (0, 2)))
                if i >= 2 and 7 in nal_types(d) and 5 in nal_types(d):
                    ok = True
            e.close()
            if ok:
                res.append(name)
            else:
                log.info("encoder %s does not produce decodable IDR frames", name)
        except Exception as ex:
            log.info("encoder %s unavailable: %s", name, ex)
    _available = res
    log.info("available encoders: %s", res)
    return res


def pick_encoder(pref):
    av_ = available_encoders()
    if pref and pref != "auto" and pref in av_:
        return pref
    for n in HW_ENCODERS + ["libx264"]:
        if n in av_:
            return n
    return None
