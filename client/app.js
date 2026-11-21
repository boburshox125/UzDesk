/* UzDesk viewer client вЂ” works in Android app (WebView), Windows app (WebView2) and browsers. */
(() => {
"use strict";
const VERSION = "1.0.0";
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const A = window.UzAndroid || null;                     // Android bridge
const Q = new URLSearchParams(location.search);
const EMBEDDED = Q.get("embedded") === "1";              // opened by UzDesk.exe
const SERVED = /^https?:$/.test(location.protocol) && !EMBEDDED;
const HAS_WC = typeof window.VideoDecoder === "function" && typeof window.EncodedVideoChunk === "function";
const IS_TOUCH = matchMedia("(pointer:coarse)").matches || "ontouchstart" in window;

/* ------------------------------------------------------------------ icons */
const ICONS = {
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  play: '<path d="M5 3l14 9-14 9V3z"/>',
  menu: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  command: '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 0-6z"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  power: '<path d="M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.8-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  wifi: '<path d="M5 12.6a10 10 0 0 1 14 0M1.4 9a15 15 0 0 1 21.2 0M8.5 16.1a5 5 0 0 1 7 0M12 20h.01"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4h6v2"/>',
};
function icon(name) { return `<svg viewBox="0 0 24 24">${ICONS[name] || ""}</svg>`; }
function paintIcons(root = document) { root.querySelectorAll("[data-icon]").forEach((el) => { if (!el.firstChild || el.tagName === "BUTTON" && !el.querySelector("svg")) el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon)); }); }

/* ------------------------------------------------------------------ storage */
const store = {
  get(k, d) { try { const v = localStorage.getItem("uz_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("uz_" + k, JSON.stringify(v)); } catch (e) {} },
};
let deviceId = store.get("device", "");
if (!deviceId) { deviceId = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("device", deviceId); }
function deviceName() {
  if (A && A.deviceName) { try { return A.deviceName(); } catch (e) {} }
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad/i.test(ua)) return "iPhone/iPad";
  if (/Windows/i.test(ua)) return "Windows kompyuter";
  return "Brauzer";
}

/* ------------------------------------------------------------------ ui helpers */
function toast(text, kind = "", ms = 2600) {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = text;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.style.transition = "opacity .3s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 320); }, ms);
}
function confirmBox(title, text) {
  return new Promise((res) => {
    $("#mTitle").textContent = title; $("#mText").textContent = text; $("#modal").hidden = false;
    const done = (v) => { $("#modal").hidden = true; $("#mYes").onclick = $("#mNo").onclick = null; res(v); };
    $("#mYes").onclick = () => done(true); $("#mNo").onclick = () => done(false);
  });
}
function show(id) { $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id)); }
function vibrate(ms) { try { if (A && A.vibrate) A.vibrate(ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

/* ------------------------------------------------------------------ target resolution */
function normalizeId(s) { const d = s.replace(/[\s-]/g, ""); return /^\d{9,12}$/.test(d) ? d : null; }
function wsFromHostPort(hp) {
  hp = hp.trim().replace(/\/+$/, "");
  if (/^wss?:\/\//i.test(hp)) return hp.replace(/\/ws$/, "") + "/ws";
  if (/^https?:\/\//i.test(hp)) { const u = new URL(hp); return (u.protocol === "https:" ? "wss://" : "ws://") + u.host + "/ws"; }
  const hasPort = /:\d+$/.test(hp) || /^\[.*\]:\d+$/.test(hp);
  const isIp = /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(hp) || /^localhost(:\d+)?$/i.test(hp) || /^\[/.test(hp);
  if (!hasPort && !isIp && /[a-z]/i.test(hp) && hp.includes(".")) return "wss://" + hp + "/ws";
  return "ws://" + hp + (hasPort ? "" : ":8765") + "/ws";
}
async function fetchDiscovered() {
  try {
    if (A && A.discovered) return JSON.parse(A.discovered() || "[]");
    if (EMBEDDED) { const r = await fetch("/api/discovered", { credentials: "same-origin" }); if (r.ok) return await r.json(); }
  } catch (e) {}
  return [];
}
async function resolveTarget(raw) {
  const id = normalizeId(raw);
  if (!id) return [{ url: wsFromHostPort(raw), timeout: 9000 }];
  const out = [];
  const disc = await fetchDiscovered();
  const d = disc.find((x) => x.id === id);
  if (d) out.push({ url: `ws://${d.ip}:${d.port}/ws`, timeout: 2500, lan: true });
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`https://ntfy.sh/uzdesk_${id}/json?poll=1&since=24h`, { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    const lines = (await r.text()).trim().split("\n").filter(Boolean);
    let info = null;
    for (const ln of lines) { try { const m = JSON.parse(ln); if (m.event === "message" && m.message) info = JSON.parse(m.message); } catch (e) {} }
    if (info) {
      for (const hp of info.lan || []) { const u = `ws://${hp}/ws`; if (!out.some((o) => o.url === u)) out.push({ url: u, timeout: 1800, lan: true }); }
      if (info.url) out.push({ url: info.url.replace(/^https:/, "wss:") + "/ws", timeout: 12000 });
    }
  } catch (e) { /* offline id service */ }
  if (!out.length) throw new Error("Kompyuter topilmadi. ID ni tekshiring yoki kompyuterda вЂњInternet orqali ulanishвЂќ yoqilganini tekshiring.");
  // LAN first (fast), internet tunnel last
  return out;
}
function openWs(url, timeout) {
  return new Promise((res, rej) => {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return rej(e); }
    ws.binaryType = "arraybuffer";
    const t = setTimeout(() => { try { ws.close(); } catch (e) {} rej(new Error("timeout")); }, timeout);
    ws.onopen = () => { clearTimeout(t); res(ws); };
    ws.onerror = () => { clearTimeout(t); rej(new Error("ws error")); };
  });
}

/* ------------------------------------------------------------------ settings */
const PRESETS = {
  eco: { codec: "h264", fps: 20, bitrate: 1500, scale: 0.6, speed: "speed", jpeg_q: 50 },
  balanced: { codec: "h264", fps: 30, bitrate: 6000, scale: 1.0, speed: "balanced", jpeg_q: 70 },
  high: { codec: "h264", fps: 60, bitrate: 12000, scale: 1.0, speed: "balanced", jpeg_q: 85 },
  ultra: { codec: "h264", fps: 60, bitrate: 25000, scale: 1.0, speed: "quality", jpeg_q: 92 },
};
const FPS_STEPS = [10, 15, 20, 24, 30, 45, 60, 90];
function defaultVideo() { return Object.assign({ encoder: "auto", auto: true, monitor: 0, preset: "balanced" }, PRESETS.balanced); }
let prefs = Object.assign({ mode: IS_TOUCH ? "touchpad" : "direct", fit: "fit", sens: 1.6, cursor: true }, store.get("prefs", {}));
function savePrefs() { store.set("prefs", prefs); }

/* ------------------------------------------------------------------ connection */
const C = {
  ws: null, target: "", pin: "", name: "", sid: "", upload: "", httpBase: "",
  wantOpen: false, retry: 0, lastMsg: 0, video: defaultVideo(), info: null,
  vw: 0, vh: 0, codec: "h264", stats: {}, rtt: 0, connecting: false, wasConnected: false,
};

async function connect(target, pin, name, isRetry = false) {
  C.target = target; C.pin = pin; C.name = name || target; C.wantOpen = true; C.connecting = true;
  C.video = Object.assign(defaultVideo(), store.get("video:" + target, {}));
  if (!HAS_WC) C.video.codec = "jpeg";
  show("viewer");
  overlay(isRetry ? "Qayta ulanmoqda..." : "Ulanmoqda...", isRetry ? `Urinish ${C.retry}` : C.name);
  let cands;
  try { cands = await resolveTarget(target); }
  catch (e) { return fail(e.message, !C.wasConnected); }
  let ws = null, lastErr = null;
  for (const c of cands) {
    if (!C.wantOpen) return;
    try { ws = await openWs(c.url, c.timeout); C.httpBase = c.url.replace(/^ws/, "http").replace(/\/ws$/, ""); break; }
    catch (e) { lastErr = e; }
  }
  if (!C.wantOpen) { if (ws) ws.close(); return; }
  if (!ws) return fail("Kompyuterga ulanib bo'lmadi. Kompyuter yoniq va UzDesk ishlayotganini tekshiring.", false);
  C.ws = ws; C.lastMsg = Date.now();
  ws.onmessage = onMessage;
  ws.onclose = () => onClosed(ws);
  ws.onerror = () => {};
  const vs = Object.assign({}, C.video); delete vs.preset;
  ws.send(JSON.stringify({ t: "hello", pin, name: deviceName(), device: deviceId, caps: { h264: HAS_WC }, settings: vs }));
}

function fail(msg, fatal) {
  C.connecting = false;
  if (!fatal && C.wantOpen && C.wasConnected) return scheduleRetry();
  C.wantOpen = false;
  overlayHide();
  stopViewer();
  show("home");
  const e = $("#homeError"); e.textContent = msg; e.hidden = false;
}

function scheduleRetry() {
  C.retry++;
  const delay = [300, 800, 1500, 2500, 4000, 5000][Math.min(C.retry - 1, 5)];
  overlay("Aloqa uzildi", `Qayta ulanmoqda... (${C.retry})`);
  clearTimeout(C.retryT);
  C.retryT = setTimeout(() => { if (C.wantOpen) connect(C.target, C.pin, C.name, true); }, delay);
}

function onClosed(ws) {
  if (ws !== C.ws) return;
  C.ws = null;
  dec.reset();
  if (!C.wantOpen) return;
  if (C.authFailed) return;
  if (C.wasConnected) scheduleRetry();
  else fail("Ulanish uzildi.", false);
}

function send(o) { if (C.ws && C.ws.readyState === 1) C.ws.send(JSON.stringify(o)); }

function disconnect() {
  C.wantOpen = false; clearTimeout(C.retryT);
  if (C.ws) { try { send({ t: "release" }); C.ws.close(); } catch (e) {} }
  C.ws = null; C.wasConnected = false;
  dec.reset(); stopViewer(); overlayHide(); closePanel();
  show("home"); renderHome();
}

function onMessage(ev) {
  C.lastMsg = Date.now();
  if (typeof ev.data !== "string") return dec.push(ev.data);
  let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
  switch (m.t) {
    case "auth_ok": onAuthOk(m); break;
    case "auth_fail": {
      C.authFailed = true; C.wantOpen = false;
      const r = { pin: "PIN kod yoki parol noto'g'ri.", locked: `Juda ko'p noto'g'ri urinish. ${m.retry || 60} soniyadan keyin urinib ko'ring.`, denied: "Kompyuter egasi ulanishni rad etdi." }[m.reason] || "Ruxsat berilmadi.";
      fail(r, true); break;
    }
    case "wait": overlay("Ruxsat kutilmoqda", "Kompyuter egasi ulanishni tasdiqlashi kerak..."); break;
    case "config": onConfig(m); break;
    case "cur": onCursor(m); break;
    case "stats": C.stats = m; renderStats(); break;
    case "pong": C.rtt = Math.round(performance.now() - m.ts); renderStats(); break;
    case "clip": onRemoteClip(m); break;
    case "toast": toast(m.text); break;
  }
}

function onAuthOk(m) {
  C.authFailed = false; C.connecting = false; C.info = m; C.sid = m.sid; C.upload = m.upload;
  const first = !C.wasConnected; C.wasConnected = true; C.retry = 0;
  overlayHide(); $("#homeError").hidden = true;
  $("#phName").textContent = m.name || C.name;
  $("#phSub").textContent = (C.httpBase.startsWith("https") ? "Internet orqali" : "Mahalliy tarmoq") + " В· v" + (m.version || "");
  saveHost(C.target, m.name || C.name, C.pin);
  if (!first) toast("Qayta ulandi", "ok");
  startViewer();
  buildVideoPanel();
  if (A && A.keepScreenOn) try { A.keepScreenOn(true); } catch (e) {}
}

function onConfig(m) {
  C.codec = m.codec; C.vw = m.w; C.vh = m.h; C.cfg = m;
  if (m.codec === "h264" && C.video.codec === "jpeg") { /* server fell back */ }
  if (m.codec === "jpeg" && C.video.codec === "h264" && HAS_WC) toast("H.264 kodlovchi ishlamadi вЂ” JPEG rejimi", "", 3500);
  dec.configure(m.codec);
  layout();
  renderVideoInfo();
}

/* keepalive / dead-link detection */
setInterval(() => {
  if (!C.ws || C.ws.readyState !== 1) return;
  send({ t: "ping", ts: performance.now() });
  if (Date.now() - C.lastMsg > 7000) { try { C.ws.close(); } catch (e) {} onClosed(C.ws); }
}, 2000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && C.wantOpen && C.wasConnected) {
    if (!C.ws || C.ws.readyState > 1 || Date.now() - C.lastMsg > 4000) { if (C.ws) try { C.ws.close(); } catch (e) {} C.ws = null; scheduleRetry(); }
    else send({ t: "kf" });
    syncLocalClipboard();
  }
});

/* ------------------------------------------------------------------ decoding */
const canvas = $("#screen");
const ctx2d = canvas.getContext("2d", { alpha: false, desynchronized: true });
const dec = {
  vd: null, codec: "", waitKey: true, tsMap: new Map(), ts: 0, jpegBusy: false, jpegNext: null, frames: 0,
  configure(codec) { this.reset(); this.codec = codec; this.waitKey = true; },
  reset() {
    if (this.vd) { try { this.vd.close(); } catch (e) {} }
    this.vd = null; this.tsMap.clear(); this.waitKey = true; this.jpegNext = null;
  },
  ack(id) { send({ t: "ack", id }); },
  draw(src, w, h) {
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; C.vw = w; C.vh = h; layout(); }
    ctx2d.drawImage(src, 0, 0, w, h);
    this.frames++;
  },
  push(buf) {
    const dv = new DataView(buf);
    const kind = dv.getUint8(0), key = dv.getUint8(1) & 1, w = dv.getUint16(2), h = dv.getUint16(4), id = dv.getUint32(6);
    const data = new Uint8Array(buf, 18);
    if (kind === 2) return this.pushJpeg(data, id, w, h);
    if (kind === 1) return this.pushH264(data, id, key, w, h);
    this.ack(id);
  },
  pushJpeg(data, id, w, h) {
    if (this.jpegBusy) { if (this.jpegNext) this.ack(this.jpegNext.id); this.jpegNext = { data, id, w, h }; return; }
    this.jpegBusy = true;
    createImageBitmap(new Blob([data], { type: "image/jpeg" })).then((bmp) => {
      this.draw(bmp, bmp.width, bmp.height); bmp.close && bmp.close();
    }).catch(() => {}).finally(() => {
      this.ack(id); this.jpegBusy = false;
      const n = this.jpegNext; this.jpegNext = null; if (n) this.pushJpeg(n.data, n.id, n.w, n.h);
    });
  },
  pushH264(data, id, key, w, h) {
    if (!HAS_WC) { this.ack(id); return; }
    if (this.waitKey && !key) { this.ack(id); return; }
    if (key && (!this.vd || this.vd.state !== "configured" || this.needCfg(data, w, h))) {
      if (!this.setupDecoder(data, w, h)) { this.ack(id); send({ t: "kf" }); return; }
    }
    if (!this.vd) { this.ack(id); return; }
    this.waitKey = false;
    const ts = ++this.ts * 1000;
    this.tsMap.set(ts, id);
    try {
      this.vd.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: ts, data }));
    } catch (e) {
      this.tsMap.delete(ts); this.ack(id); this.fault();
    }
  },
  needCfg(data, w, h) { const c = codecFromSps(data); return (c && c !== this.cs) || w !== this.cw || h !== this.ch; },
  setupDecoder(data, w, h) {
    const cs = codecFromSps(data) || "avc1.42E01F";
    if (this.vd && this.cs === cs && this.cw === w && this.ch === h && this.vd.state === "configured") return true;
    if (this.vd) try { this.vd.close(); } catch (e) {}
    this.tsMap.forEach((id) => this.ack(id)); this.tsMap.clear();
    this.vd = new VideoDecoder({
      output: (frame) => {
        const id = this.tsMap.get(frame.timestamp); this.tsMap.delete(frame.timestamp);
        try { this.draw(frame, frame.displayWidth, frame.displayHeight); } finally { frame.close(); }
        if (id !== undefined) this.ack(id);
      },
      error: (e) => { console.warn("decoder", e); this.fault(); },
    });
    try {
      this.vd.configure({ codec: cs, codedWidth: w, codedHeight: h, optimizeForLatency: true, hardwareAcceleration: "no-preference" });
    } catch (e) {
      console.warn("configure failed", e);
      try { this.vd.close(); } catch (x) {}
      this.vd = null;
      return false;
    }
    this.cs = cs; this.cw = w; this.ch = h;
    return true;
  },
  fault() {
    this.tsMap.forEach((id) => this.ack(id)); this.tsMap.clear();
    if (this.vd) try { this.vd.close(); } catch (e) {}
    this.vd = null; this.waitKey = true;
    this.faults = (this.faults || 0) + 1;
    if (this.faults > 4 && C.video.codec === "h264") {
      this.faults = 0; toast("Video dekoder xatosi вЂ” JPEG rejimiga o'tildi", "bad", 3500);
      applyVideo({ codec: "jpeg" });
    } else send({ t: "kf" });
  },
};
function codecFromSps(d) {
  for (let i = 0; i + 4 < d.length; i++) {
    if (d[i] === 0 && d[i + 1] === 0 && (d[i + 2] === 1 || (d[i + 2] === 0 && d[i + 3] === 1))) {
      const s = d[i + 2] === 1 ? i + 3 : i + 4;
      if ((d[s] & 0x1f) === 7 && s + 3 < d.length) {
        const h = (b) => b.toString(16).padStart(2, "0").toUpperCase();
        return "avc1." + h(d[s + 1]) + h(d[s + 2]) + h(d[s + 3]);
      }
      i = s - 1;
    }
    if (i > 512) break;
  }
  return null;
}

/* ------------------------------------------------------------------ layout / view transform */
const stage = $("#stage");
const view = { z: 1, px: 0, py: 0, rect: { x: 0, y: 0, w: 1, h: 1 } };
function layout() {
  const W = stage.clientWidth, H = stage.clientHeight;
  const vw = C.vw || canvas.width || 16, vh = C.vh || canvas.height || 9;
  let base;
  if (prefs.fit === "fill") base = Math.max(W / vw, H / vh);
  else if (prefs.fit === "real") base = (window.devicePixelRatio ? 1 / window.devicePixelRatio : 1) * ((C.cfg && C.cfg.mon) ? C.cfg.mon.w / vw : 1);
  else base = Math.min(W / vw, H / vh);
  const w = vw * base * view.z, h = vh * base * view.z;
  let x = w <= W ? (W - w) / 2 : Math.min(0, Math.max(W - w, view.px));
  let y = h <= H ? (H - h) / 2 : Math.min(0, Math.max(H - h, view.py));
  view.px = x; view.py = y;
  view.rect = { x, y, w, h };
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  canvas.style.transform = `translate(${x}px,${y}px)`;
  canvas.classList.toggle("pixel", base * view.z >= 1.5);
  placeCursor();
}
window.addEventListener("resize", () => { layout(); placeFab(); });
function zoomAt(cx, cy, nz) {
  nz = Math.min(Math.max(nz, 1), 6);
  const r = view.rect;
  const fx = (cx - r.x) / r.w, fy = (cy - r.y) / r.h;
  const k = nz / view.z; view.z = nz;
  const nw = r.w * k, nh = r.h * k;
  view.px = cx - fx * nw; view.py = cy - fy * nh;
  layout();
}
function toNorm(cx, cy) {
  const r = view.rect;
  return { x: Math.min(Math.max((cx - r.x) / r.w, 0), 1), y: Math.min(Math.max((cy - r.y) / r.h, 0), 1) };
}

/* ------------------------------------------------------------------ cursor */
const cur = { x: 0.5, y: 0.5, v: true, s: "default" };
const cursorEl = $("#cursor");
function onCursor(m) {
  cur.x = m.x; cur.y = m.y; cur.v = m.v; cur.s = m.s;
  if (!IS_TOUCH || lastPointerType === "mouse") canvas.style.cursor = m.v ? (m.s || "default") : "none";
  placeCursor();
  if (prefs.mode === "touchpad" && view.z > 1 && IS_TOUCH) followCursor();
}
function placeCursor() {
  const showIt = prefs.cursor && cur.v && (lastPointerType !== "mouse");
  cursorEl.style.display = showIt ? "block" : "none";
  if (!showIt) return;
  const r = view.rect;
  cursorEl.style.left = (r.x + cur.x * r.w) + "px";
  cursorEl.style.top = (r.y + cur.y * r.h) + "px";
}
function followCursor() {
  const r = view.rect, W = stage.clientWidth, H = stage.clientHeight, m = 60;
  const sx = r.x + cur.x * r.w, sy = r.y + cur.y * r.h;
  let dx = 0, dy = 0;
  if (sx < m) dx = m - sx; else if (sx > W - m) dx = W - m - sx;
  if (sy < m) dy = m - sy; else if (sy > H - m) dy = H - m - sy;
  if (dx || dy) { view.px += dx; view.py += dy; layout(); }
}

/* ------------------------------------------------------------------ input: mouse (desktop) */
let lastPointerType = IS_TOUCH ? "touch" : "mouse";
let viewOnly = false;
let pendingMove = null, moveRaf = 0;
function queueMove(o) { pendingMove = o; if (!moveRaf) moveRaf = requestAnimationFrame(flushMove); }
function flushMove() {
  moveRaf = 0; const o = pendingMove; pendingMove = null; if (!o) return;
  if (o.rel) { if (Math.abs(o.dx) + Math.abs(o.dy) > 0) send({ t: "mr", dx: o.dx, dy: o.dy }); relAcc.dx = relAcc.dy = 0; }
  else send({ t: "m", x: +o.x.toFixed(5), y: +o.y.toFixed(5) });
}
const relAcc = { dx: 0, dy: 0 };
function queueRel(dx, dy) { relAcc.dx += dx; relAcc.dy += dy; queueMove({ rel: true, dx: relAcc.dx, dy: relAcc.dy }); }
const BTN = [0, 1, 2, 3, 4];

stage.addEventListener("contextmenu", (e) => e.preventDefault());
stage.addEventListener("pointerdown", (e) => {
  lastPointerType = e.pointerType;
  if (e.pointerType === "mouse") {
    placeCursor();
    if (viewOnly) return;
    e.preventDefault(); stage.setPointerCapture(e.pointerId);
    const p = toNorm(e.clientX, e.clientY);
    flushMove();
    send({ t: "md", b: BTN[e.button] ?? 0, x: p.x, y: p.y });
    return;
  }
  touchDown(e);
});
stage.addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse") {
    if (viewOnly) return;
    const p = toNorm(e.clientX, e.clientY); queueMove({ x: p.x, y: p.y }); return;
  }
  touchMove(e);
});
stage.addEventListener("pointerup", (e) => {
  if (e.pointerType === "mouse") {
    if (viewOnly) return;
    const p = toNorm(e.clientX, e.clientY); flushMove();
    send({ t: "mu", b: BTN[e.button] ?? 0, x: p.x, y: p.y }); return;
  }
  touchUp(e);
});
stage.addEventListener("pointercancel", (e) => { if (e.pointerType !== "mouse") touchUp(e, true); });
let wheelAcc = 0;
stage.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey && !viewOnly && false) return;
  if (viewOnly) return;
  const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1.2;
  const dy = Math.round(-e.deltaY * k), dx = Math.round(e.deltaX * k);
  if (dy || dx) send({ t: "w", dy, dx });
}, { passive: false });

/* ------------------------------------------------------------------ input: touch gestures */
const T = { pts: new Map(), mode: null, start: 0, moved: 0, lpTimer: 0, lpFired: false, lastTapT: 0, lastTapX: 0, lastTapY: 0,
  dragArmed: false, dragging: false, g: null, maxPts: 0, scrollAcc: 0, scrollAccX: 0 };
function centroid() { let x = 0, y = 0; T.pts.forEach((p) => { x += p.x; y += p.y; }); const n = T.pts.size || 1; return { x: x / n, y: y / n }; }
function spread() { const a = [...T.pts.values()]; if (a.length < 2) return 0; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }

function touchDown(e) {
  e.preventDefault(); stage.setPointerCapture(e.pointerId);
  T.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
  T.maxPts = Math.max(T.maxPts, T.pts.size);
  if (T.pts.size === 1) {
    T.start = performance.now(); T.moved = 0; T.lpFired = false; T.mode = "one";
    const quick = T.start - T.lastTapT < 320 && Math.hypot(e.clientX - T.lastTapX, e.clientY - T.lastTapY) < 40;
    T.dragArmed = quick && prefs.mode === "touchpad";
    clearTimeout(T.lpTimer);
    if (prefs.mode === "direct" && !viewOnly) { const p = toNorm(e.clientX, e.clientY); send({ t: "m", x: p.x, y: p.y }); }
    T.lpTimer = setTimeout(() => {
      if (T.pts.size === 1 && T.moved < 10 && !T.dragging && !viewOnly) {
        T.lpFired = true; vibrate(30);
        const pt = [...T.pts.values()][0];
        if (prefs.mode === "direct") { const p = toNorm(pt.x, pt.y); click(2, p); } else click(2);
      }
    }, 550);
  } else if (T.pts.size === 2) {
    clearTimeout(T.lpTimer);
    if (T.dragging) { send({ t: "mu", b: 0 }); T.dragging = false; }
    T.mode = "two"; T.g = { c: centroid(), d: spread(), kind: null, moved: 0 }; T.start2 = performance.now();
  } else if (T.pts.size >= 3) {
    clearTimeout(T.lpTimer); T.mode = "three";
  }
}
function touchMove(e) {
  const p = T.pts.get(e.pointerId); if (!p) return;
  e.preventDefault();
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (T.mode === "one") {
    T.moved = Math.max(T.moved, Math.hypot(p.x - p.sx, p.y - p.sy));
    if (viewOnly) { if (view.z > 1) { view.px += dx; view.py += dy; layout(); } return; }
    if (prefs.mode === "touchpad") {
      if (T.dragArmed && !T.dragging && T.moved > 8) { T.dragging = true; send({ t: "md", b: 0 }); vibrate(15); }
      if (T.moved > 3) {
        const r = view.rect, s = prefs.sens;
        // acceleration curve: faster swipes move further
        const sp = Math.hypot(dx, dy), acc = 1 + Math.min(sp / 18, 1.6);
        queueRel(dx * s * acc / r.w, dy * s * acc / r.h);
      }
    } else {
      const pn = toNorm(p.x, p.y);
      if (!T.dragging && T.moved > 10 && !T.lpFired) {
        clearTimeout(T.lpTimer);
        const sp = toNorm(p.sx, p.sy);
        T.dragging = true; send({ t: "md", b: 0, x: sp.x, y: sp.y });
      }
      if (T.dragging) queueMove({ x: pn.x, y: pn.y });
    }
    if (T.moved > 10) clearTimeout(T.lpTimer);
  } else if (T.mode === "two" && T.pts.size >= 2) {
    const c = centroid(), d = spread(), g = T.g;
    const dd = d - g.d, cdx = c.x - g.c.x, cdy = c.y - g.c.y;
    g.moved += Math.abs(dd) + Math.hypot(cdx, cdy);
    if (!g.kind && g.moved > 14) g.kind = Math.abs(dd) > Math.hypot(cdx, cdy) * 0.8 ? "pinch" : (view.z > 1.01 && viewOnly ? "pinch" : "scroll");
    if (g.kind === "pinch") {
      if (g.d > 0) zoomAt(c.x, c.y, view.z * (d / g.d));
      view.px += cdx; view.py += cdy; layout();
    } else if (g.kind === "scroll" && !viewOnly) {
      T.scrollAcc += cdy * 3.2; T.scrollAccX += cdx * 3.2;
      const sy = Math.trunc(T.scrollAcc), sx = Math.trunc(T.scrollAccX);
      if (Math.abs(sy) >= 8 || Math.abs(sx) >= 8) {
        send({ t: "w", dy: Math.abs(sy) >= 8 ? sy : 0, dx: Math.abs(sx) >= 8 ? -sx : 0 });
        if (Math.abs(sy) >= 8) T.scrollAcc -= sy; if (Math.abs(sx) >= 8) T.scrollAccX -= sx;
      }
    }
    g.c = c; g.d = d;
  }
}
function touchUp(e, cancel) {
  const p = T.pts.get(e.pointerId); if (!p) return;
  T.pts.delete(e.pointerId);
  if (T.pts.size > 0) {
    if (T.mode === "two" && T.pts.size === 1) T.mode = "none";
    return;
  }
  clearTimeout(T.lpTimer);
  const dur = performance.now() - T.start;
  const max = T.maxPts; T.maxPts = 0;
  if (cancel) { if (T.dragging) send({ t: "mu", b: 0 }); T.dragging = false; return; }
  if (max === 1 && T.mode === "one") {
    if (T.dragging) {
      flushMove();
      if (prefs.mode === "direct") { const pn = toNorm(p.x, p.y); send({ t: "mu", b: 0, x: pn.x, y: pn.y }); } else send({ t: "mu", b: 0 });
      T.dragging = false;
    } else if (!T.lpFired && T.moved < 12 && dur < 400 && !viewOnly) {
      if (prefs.mode === "direct") click(0, toNorm(p.x, p.y)); else { flushMove(); click(0); }
      T.lastTapT = performance.now(); T.lastTapX = p.x; T.lastTapY = p.y;
    }
  } else if (max === 2 && T.g && !T.g.kind && dur < 350 && !viewOnly) {
    click(2); vibrate(20);
  } else if (max >= 3 && dur < 450) {
    toggleKeyboard();
  }
  T.dragArmed = false; T.mode = null; T.g = null;
}
function click(b, p) {
  if (p) { send({ t: "md", b, x: p.x, y: p.y }); send({ t: "mu", b, x: p.x, y: p.y }); }
  else { send({ t: "md", b }); send({ t: "mu", b }); }
}

/* ------------------------------------------------------------------ keyboard (physical) */
const MOD_CODES = new Set(["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"]);
const downCodes = new Set();
function viewerActive() { return $("#viewer").classList.contains("active") && !$("#panel").classList.contains("open") && $("#modal").hidden; }
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("#panel").classList.contains("open")) { closePanel(); return; }
  if (!viewerActive() || viewOnly) return;
  if (document.activeElement === kbd) return; // handled by soft keyboard logic
  if (e.code === "F11" && !e.ctrlKey) return;
  e.preventDefault();
  if (e.repeat && MOD_CODES.has(e.code)) return;
  if (e.code === "KeyV" && (e.ctrlKey || e.metaKey) && !e.repeat) {
    syncLocalClipboard().then(() => { sendKey(e); });
    return;
  }
  sendKey(e);
});
function sendKey(e) {
  if (e.code) { downCodes.add(e.code); send({ t: "kd", code: e.code, key: e.key }); }
  else if (e.key && e.key.length === 1) send({ t: "txt", s: e.key });
}
window.addEventListener("keyup", (e) => {
  if (!viewerActive() || viewOnly) return;
  if (document.activeElement === kbd) return;
  e.preventDefault();
  if (e.code) { downCodes.delete(e.code); send({ t: "ku", code: e.code, key: e.key }); }
});
window.addEventListener("blur", () => { if (downCodes.size) { send({ t: "release" }); downCodes.clear(); } });

/* ------------------------------------------------------------------ soft keyboard (mobile) */
const kbd = $("#kbd");
const SENT = "вЂ‹вЂ‹вЂ‹вЂ‹";  // sentinel so backspace is always detectable
let kbPrev = SENT, composing = false;
const mods = { ControlLeft: 0, AltLeft: 0, ShiftLeft: 0, MetaLeft: 0 }; // 0 off, 1 once, 2 locked
function resetKbd() { kbd.value = SENT; kbPrev = SENT; try { kbd.setSelectionRange(SENT.length, SENT.length); } catch (e) {} }
function toggleKeyboard(force) {
  const on = force !== undefined ? force : document.activeElement !== kbd;
  if (on) {
    kbd.style.pointerEvents = "auto"; resetKbd(); kbd.focus({ preventScroll: true });
    if (A && A.showKeyboard) try { A.showKeyboard(); } catch (e) {}
    $("#keybar").hidden = false; $("#keybar").dataset.auto = "1";
  } else {
    kbd.blur(); kbd.style.pointerEvents = "none";
    if ($("#keybar").dataset.auto === "1") $("#keybar").hidden = true;
  }
}
const CHAR_CODE = (() => {
  const m = {}; for (let i = 0; i < 26; i++) { const c = String.fromCharCode(97 + i); m[c] = m[c.toUpperCase()] = "Key" + c.toUpperCase(); }
  for (let i = 0; i < 10; i++) m[String(i)] = "Digit" + i;
  Object.assign(m, { " ": "Space", "-": "Minus", "=": "Equal", "[": "BracketLeft", "]": "BracketRight", ";": "Semicolon", "'": "Quote", ",": "Comma", ".": "Period", "/": "Slash", "\\": "Backslash", "`": "Backquote" });
  return m;
})();
function activeMods() { return Object.keys(mods).filter((k) => mods[k]); }
function consumeMods() { for (const k of Object.keys(mods)) if (mods[k] === 1) mods[k] = 0; renderMods(); }
function sendCombo(codes) { send({ t: "combo", keys: codes }); }
function typeChars(s) {
  const am = activeMods().filter((k) => k !== "ShiftLeft" || true);
  if (am.length) {
    for (const ch of s) { const code = CHAR_CODE[ch]; if (code) sendCombo([...am, code]); else send({ t: "txt", s: ch }); }
    consumeMods();
  } else send({ t: "txt", s });
}
function pressKey(code) {
  const am = activeMods();
  sendCombo([...am, code]);
  if (am.length) consumeMods();
}
kbd.addEventListener("compositionstart", () => { composing = true; });
kbd.addEventListener("compositionend", () => { composing = false; handleKbdInput(); });
kbd.addEventListener("input", () => handleKbdInput());
function handleKbdInput() {
  const v = kbd.value;
  if (v === kbPrev) return;
  let i = 0; while (i < v.length && i < kbPrev.length && v[i] === kbPrev[i]) i++;
  const removed = kbPrev.length - i, added = v.slice(i);
  for (let k = 0; k < removed; k++) pressKey("Backspace");
  if (added) {
    const parts = added.split("\n");
    parts.forEach((part, idx) => { if (part) typeChars(part.replace(/вЂ‹/g, "")); if (idx < parts.length - 1) pressKey("Enter"); });
  }
  kbPrev = v;
  if (!composing && (v.length < 2 || v.length > 64 || !v.startsWith("вЂ‹") || v.includes("\n"))) resetKbd();
}
kbd.addEventListener("keydown", (e) => {
  if (viewOnly) return;
  if (e.keyCode === 229 || e.isComposing) return;
  const special = { Enter: "Enter", Backspace: "Backspace", Tab: "Tab", Escape: "Escape", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", Delete: "Delete", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown" };
  if (e.ctrlKey || e.altKey || e.metaKey) {
    e.preventDefault();
    const codes = []; if (e.ctrlKey) codes.push("ControlLeft"); if (e.altKey) codes.push("AltLeft"); if (e.shiftKey) codes.push("ShiftLeft"); if (e.metaKey) codes.push("MetaLeft");
    if (e.code && !MOD_CODES.has(e.code)) { codes.push(e.code); sendCombo(codes); }
    return;
  }
  if (special[e.key]) { e.preventDefault(); pressKey(special[e.key]); }
  else if (/^F\d+$/.test(e.key)) { e.preventDefault(); pressKey(e.key); }
});

/* key bar */
const KEYBAR = [
  ["Esc", "Escape"], ["Tab", "Tab"], ["Ctrl", "ControlLeft", 1], ["Alt", "AltLeft", 1], ["Shift", "ShiftLeft", 1], ["Win", "MetaLeft", 1],
  ["вЊ«", "Backspace"], ["Del", "Delete"], ["вЏЋ", "Enter"], ["в†ђ", "ArrowLeft"], ["в†‘", "ArrowUp"], ["в†“", "ArrowDown"], ["в†’", "ArrowRight"],
  ["Home", "Home"], ["End", "End"], ["PgUp", "PageUp"], ["PgDn", "PageDown"], ["Ins", "Insert"], ["PrtSc", "PrintScreen"],
  ...Array.from({ length: 12 }, (_, i) => ["F" + (i + 1), "F" + (i + 1)]),
];
function buildKeybar() {
  const row = $("#keysRow"); row.innerHTML = "";
  for (const [label, code, isMod] of KEYBAR) {
    const b = document.createElement("button");
    b.className = "k" + (isMod ? " mod" : ""); b.textContent = label; b.dataset.code = code;
    b.addEventListener("pointerdown", (e) => e.preventDefault()); // keep soft keyboard open
    let lastTap = 0;
    b.addEventListener("click", () => {
      if (viewOnly) return;
      vibrate(8);
      if (isMod) {
        const now = Date.now();
        if (code === "MetaLeft" && !mods[code] && now - lastTap > 350) { /* single tap Win = press Win alone unless combined later */ }
        mods[code] = mods[code] ? (now - lastTap < 350 ? 2 : 0) : 1;
        if (code === "MetaLeft" && mods[code] === 0 && now - lastTap > 350) { /* toggled off */ }
        lastTap = now; renderMods();
      } else pressKey(code);
    });
    b.addEventListener("dblclick", () => { if (code === "MetaLeft") { mods.MetaLeft = 0; renderMods(); sendCombo(["MetaLeft"]); } });
    row.appendChild(b);
  }
}
function renderMods() {
  $$("#keysRow .k.mod").forEach((b) => { const s = mods[b.dataset.code]; b.classList.toggle("on", s === 1); b.classList.toggle("lock", s === 2); });
}
$("#kbClose").addEventListener("click", () => { $("#keybar").hidden = true; toggleKeyboard(false); for (const k in mods) mods[k] = 0; renderMods(); });

/* ------------------------------------------------------------------ clipboard */
let lastLocalClip = null;
async function readLocalClipboard() {
  try { if (A && A.getClipboard) return A.getClipboard(); } catch (e) {}
  try { if (navigator.clipboard && navigator.clipboard.readText) return await navigator.clipboard.readText(); } catch (e) {}
  return null;
}
async function writeLocalClipboard(t) {
  try { if (A && A.setClipboard) { A.setClipboard(t); return true; } } catch (e) {}
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(t); return true; } } catch (e) {}
  try { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok; } catch (e) {}
  return false;
}
async function syncLocalClipboard() {
  if (!C.info || !C.info.features || !C.info.features.clipboard) return;
  const t = await readLocalClipboard();
  if (t && t !== lastLocalClip && t !== lastRemoteClip) { lastLocalClip = t; send({ t: "clip", s: t }); }
}
let lastRemoteClip = null;
async function onRemoteClip(m) {
  lastRemoteClip = m.s;
  if (m.manual) { $("#clipText").value = m.s; const ok = await writeLocalClipboard(m.s); toast(ok ? "Kompyuter buferi nusxalandi" : "Matn panelga qo'yildi", "ok"); return; }
  if (m.initial) return;
  const ok = await writeLocalClipboard(m.s);
  if (ok) { lastLocalClip = m.s; toast("рџ“‹ Bufer sinxronlandi", "", 1500); }
}
window.addEventListener("focus", () => { if (C.ws) syncLocalClipboard(); });

/* ------------------------------------------------------------------ viewer lifecycle */
let statsOn = store.get("stats", false);
function startViewer() {
  layout(); placeFab();
  $("#stats").hidden = !statsOn;
  if (A && A.setFullscreen) try { A.setFullscreen(true); } catch (e) {}
  if (!HAS_WC && !store.get("wcwarn", false)) { toast("Bu brauzerda H.264 yo'q вЂ” JPEG rejimi ishlatiladi", "", 4000); store.set("wcwarn", true); }
}
function stopViewer() {
  if (A && A.keepScreenOn) try { A.keepScreenOn(false); } catch (e) {}
  if (A && A.setFullscreen) try { A.setFullscreen(false); } catch (e) {}
  toggleKeyboard(false); $("#keybar").hidden = true;
  ctx2d.fillStyle = "#000"; ctx2d.fillRect(0, 0, canvas.width, canvas.height);
}
function overlay(title, sub) {
  $("#overlay").hidden = false; $("#ovTitle").textContent = title; $("#ovSub").textContent = sub || "";
}
function overlayHide() { $("#overlay").hidden = true; }
$("#ovCancel").addEventListener("click", disconnect);

let lastStatFrames = 0, lastStatT = performance.now(), drawFps = 0;
setInterval(() => {
  const now = performance.now(); drawFps = Math.round((dec.frames - lastStatFrames) * 1000 / (now - lastStatT));
  lastStatFrames = dec.frames; lastStatT = now; if (statsOn) renderStats();
}, 1000);
function renderStats() {
  if (!statsOn) return;
  const s = C.stats || {};
  const mbps = s.kbps ? (s.kbps / 1000).toFixed(2) + " Mbit/s" : "-";
  $("#stats").textContent =
    `FPS     ${drawFps} (server ${s.fps ?? "-"})\n` +
    `Oqim    ${mbps}\n` +
    `Ping    ${C.rtt || "-"} ms\n` +
    `Tasvir  ${C.vw}Г—${C.vh} ${C.codec.toUpperCase()}\n` +
    `Kodek   ${s.encoder || "-"}${s.capture ? " В· " + s.capture.toUpperCase() : ""}\n` +
    (C.codec === "h264" ? `Bitreyt ${((s.bitrate || 0) / 1000).toFixed(1)} Mbit/s` : `Sifat   ${s.q ?? "-"}`);
}

/* ------------------------------------------------------------------ FAB (draggable) */
const fab = $("#fab");
let fabPos = store.get("fab", { x: 1, y: 0.4 });
function placeFab() {
  const W = innerWidth, H = innerHeight;
  const x = fabPos.x > 0.5 ? W - 16 - 52 : 16, y = Math.min(Math.max(fabPos.y * H, 20), H - 80);
  fab.style.left = x + "px"; fab.style.top = y + "px"; fab.style.right = "auto";
}
(() => {
  let sx, sy, ox, oy, moved = false, id = null, dimT;
  const dim = () => { clearTimeout(dimT); fab.classList.remove("dim"); dimT = setTimeout(() => fab.classList.add("dim"), 3000); };
  dim();
  fab.addEventListener("pointerdown", (e) => { e.stopPropagation(); id = e.pointerId; fab.setPointerCapture(id); sx = e.clientX; sy = e.clientY; const r = fab.getBoundingClientRect(); ox = r.left; oy = r.top; moved = false; dim(); });
  fab.addEventListener("pointermove", (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true; fab.style.left = ox + dx + "px"; fab.style.top = oy + dy + "px";
  });
  fab.addEventListener("pointerup", (e) => {
    if (e.pointerId !== id) return; id = null;
    if (moved) { const r = fab.getBoundingClientRect(); fabPos = { x: (r.left + 26) / innerWidth > 0.5 ? 1 : 0, y: r.top / innerHeight }; store.set("fab", fabPos); placeFab(); }
    else openPanel();
    dim();
  });
})();

/* ------------------------------------------------------------------ panel */
function openPanel() { $("#panel").classList.add("open"); $("#scrim").hidden = false; $("#panel").setAttribute("aria-hidden", "false"); if (downCodes.size) { send({ t: "release" }); downCodes.clear(); } }
function closePanel() { $("#panel").classList.remove("open"); $("#scrim").hidden = true; $("#panel").setAttribute("aria-hidden", "true"); }
$("#panelClose").addEventListener("click", closePanel);
$("#scrim").addEventListener("click", closePanel);
$$(".tab").forEach((t) => t.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
  $$(".tab-body").forEach((b) => b.classList.toggle("active", b.id === t.dataset.tab));
}));
function seg(id, value, onPick) {
  const el = $(id);
  el.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.v == value);
    b.onclick = () => { el.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); onPick(b.dataset.v); };
  });
}
const MODE_HINT = {
  touchpad: "Barmoq bilan suring вЂ” kursor harakatlanadi. Bosish = chap tugma, 2 barmoq bosish = o'ng tugma, 2 barmoq surish = aylantirish, ikki marta bosib ushlab suring = sudrash, 3 barmoq = klaviatura.",
  direct: "Ekranga bosgan joyingizda bosiladi. Uzoq bosish = o'ng tugma, 2 barmoq = aylantirish, chimdish = kattalashtirish.",
};
function buildControlPanel() {
  seg("#segMode", prefs.mode, (v) => { prefs.mode = v; savePrefs(); $("#modeHint").textContent = MODE_HINT[v]; });
  $("#modeHint").textContent = MODE_HINT[prefs.mode];
  seg("#segFit", prefs.fit, (v) => { prefs.fit = v; view.z = 1; savePrefs(); layout(); });
  const sens = $("#sens"); sens.value = prefs.sens; $("#sensVal").textContent = (+prefs.sens).toFixed(1) + "Г—";
  sens.oninput = () => { prefs.sens = +sens.value; $("#sensVal").textContent = prefs.sens.toFixed(1) + "Г—"; savePrefs(); };
  $("#viewOnly").checked = viewOnly; $("#viewOnly").onchange = (e) => { viewOnly = e.target.checked; if (viewOnly) send({ t: "release" }); };
  $("#showCursor").checked = prefs.cursor; $("#showCursor").onchange = (e) => { prefs.cursor = e.target.checked; savePrefs(); placeCursor(); };
  const quick = [
    ["Alt+Tab", ["AltLeft", "Tab"]], ["Win", ["MetaLeft"]], ["Ish stoli", ["MetaLeft", "KeyD"]], ["Explorer", ["MetaLeft", "KeyE"]],
    ["Nusxa", ["ControlLeft", "KeyC"]], ["Qo'yish", ["ControlLeft", "KeyV"]], ["Bekor", ["ControlLeft", "KeyZ"]], ["Hammasi", ["ControlLeft", "KeyA"]],
    ["Alt+F4", ["AltLeft", "F4"]], ["Ekran rasmi", ["MetaLeft", "ShiftLeft", "KeyS"]], ["Til", ["AltLeft", "ShiftLeft"]], ["Ovoz в€’", ["AudioVolumeDown"]], ["Ovoz +", ["AudioVolumeUp"]], ["в–¶/вЏё", ["MediaPlayPause"]],
  ];
  const q = $("#quickKeys"); q.innerHTML = "";
  for (const [label, keys] of quick) {
    const b = document.createElement("button"); b.className = "chip"; b.textContent = label;
    b.onclick = () => { if (!viewOnly) { sendCombo(keys); vibrate(10); toast(label, "", 900); } };
    q.appendChild(b);
  }
}
function setActOn(name, on) { const b = document.querySelector(`.act[data-act="${name}"]`); if (b) b.classList.toggle("on", !!on); }

/* video settings */
let applyT = 0;
function applyVideo(patch, immediate) {
  Object.assign(C.video, patch);
  store.set("video:" + C.target, C.video);
  clearTimeout(applyT);
  const fire = () => { const v = Object.assign({ t: "settings" }, C.video); delete v.preset; send(v); };
  if (immediate) fire(); else applyT = setTimeout(fire, 250);
  syncVideoUi();
}
function syncVideoUi() {
  const v = C.video;
  $$("#presets button").forEach((b) => b.classList.toggle("on", b.dataset.p === v.preset));
  seg("#segCodec", v.codec, (x) => { if (x === "h264" && !HAS_WC) { toast("Bu qurilmada H.264 dekoder yo'q", "bad"); syncVideoUi(); return; } applyVideo({ codec: x, preset: "" }); });
  seg("#segSpeed", v.speed, (x) => applyVideo({ speed: x, preset: "" }));
  const fi = FPS_STEPS.indexOf(+v.fps); $("#fps").value = fi < 0 ? 4 : fi; $("#fpsVal").textContent = v.fps + " FPS";
  $("#bitrate").value = v.bitrate; $("#brVal").textContent = (v.bitrate / 1000).toFixed(1) + " Mbit/s";
  $("#jpegq").value = v.jpeg_q; $("#jqVal").textContent = v.jpeg_q + "%";
  $("#scale").value = Math.round(v.scale * 100);
  const mon = C.info && C.info.monitors ? C.info.monitors[v.monitor] || C.info.monitors[0] : null;
  $("#scVal").textContent = Math.round(v.scale * 100) + "%" + (mon ? ` В· ${Math.round(mon.width * v.scale)}Г—${Math.round(mon.height * v.scale)}` : "");
  $("#autoQ").checked = !!v.auto;
  const h = v.codec === "h264";
  $("#grpBitrate").hidden = !h; $("#grpSpeed").hidden = !h; $("#grpEncoder").hidden = !h; $("#grpJpeg").hidden = h;
  $("#selEncoder").value = v.encoder || "auto";
}
function buildVideoPanel() {
  const info = C.info || {};
  const sel = $("#selEncoder"); sel.innerHTML = "";
  sel.add(new Option("Avtomatik (eng yaxshisi)", "auto"));
  (info.encoders || []).forEach((e) => sel.add(new Option(e.label, e.id)));
  sel.onchange = () => applyVideo({ encoder: sel.value, preset: "" });
  const mons = info.monitors || [];
  $("#grpMonitor").hidden = mons.length < 2;
  const sm = $("#segMonitor"); sm.innerHTML = "";
  mons.forEach((m, i) => { const b = document.createElement("button"); b.dataset.v = i; b.textContent = `${i + 1} В· ${m.width}Г—${m.height}`; sm.appendChild(b); });
  seg("#segMonitor", C.video.monitor, (x) => { applyVideo({ monitor: +x }, true); view.z = 1; });
  $$("#presets button").forEach((b) => b.onclick = () => applyVideo(Object.assign({}, PRESETS[b.dataset.p], { preset: b.dataset.p, codec: HAS_WC ? "h264" : "jpeg" }), true));
  $("#fps").oninput = (e) => applyVideo({ fps: FPS_STEPS[+e.target.value], preset: "" });
  $("#bitrate").oninput = (e) => applyVideo({ bitrate: +e.target.value, preset: "" });
  $("#jpegq").oninput = (e) => applyVideo({ jpeg_q: +e.target.value, preset: "" });
  $("#scale").oninput = (e) => applyVideo({ scale: +e.target.value / 100, preset: "" });
  $("#autoQ").onchange = (e) => applyVideo({ auto: e.target.checked });
  const f = info.features || {};
  $("#grpFiles").hidden = !f.files; $("#grpPower").hidden = !f.power;
  syncVideoUi(); renderVideoInfo();
}
function renderVideoInfo() {
  const c = C.cfg; if (!c) return;
  $("#videoInfo").textContent = `Hozir: ${c.codec.toUpperCase()} ${c.w}Г—${c.h}, ${c.fps} FPS В· ${c.encoder} В· ekran tasviri: ${String(c.capture).toUpperCase()}`;
}

/* actions */
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act;
  switch (a) {
    case "keyboard": closePanel(); setTimeout(() => toggleKeyboard(true), 60); break;
    case "keybar": { const kb = $("#keybar"); kb.hidden = !kb.hidden; kb.dataset.auto = ""; closePanel(); break; }
    case "fullscreen":
      try { if (A && A.setFullscreen) A.setFullscreen(true); else if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); } catch (x) {}
      closePanel(); break;
    case "stats": statsOn = !statsOn; store.set("stats", statsOn); $("#stats").hidden = !statsOn; setActOn("stats", statsOn); renderStats(); break;
    case "disconnect": if (await confirmBox("Uzish", "Kompyuterdan uzilsinmi?")) disconnect(); break;
    case "clipsend": { const t = $("#clipText").value; if (t) { send({ t: "clip", s: t }); lastLocalClip = t; toast("Kompyuter buferiga yuborildi", "ok"); } break; }
    case "clipget": send({ t: "clipget" }); break;
    case "typeclip": { const t = $("#clipText").value; if (t) { send({ t: "txt", s: t }); toast("Yozildi", "ok"); } break; }
    case "file": $("#fileIn").click(); break;
    case "lock": send({ t: "action", a: "lock" }); toast("Kompyuter qulflandi"); break;
    case "taskmgr": send({ t: "action", a: "taskmgr" }); closePanel(); break;
    case "restart": if (await confirmBox("Qayta yuklash", "Kompyuter hozir qayta yuklansinmi? Aloqa vaqtincha uziladi.")) send({ t: "action", a: "restart" }); break;
    case "shutdown": if (await confirmBox("O'chirish", "Kompyuter o'chirilsinmi? Keyin uni masofadan yoqib bo'lmaydi.")) send({ t: "action", a: "shutdown" }); break;
    case "sleep": if (await confirmBox("Uyqu rejimi", "Kompyuter uyqu rejimiga o'tkazilsinmi?")) send({ t: "action", a: "sleep" }); break;
  }
});
$("#fileIn").addEventListener("change", (e) => {
  const files = [...e.target.files]; if (!files.length) return;
  const fd = new FormData(); files.forEach((f) => fd.append("file", f, f.name));
  const xhr = new XMLHttpRequest();
  xhr.open("POST", `${C.httpBase}/upload?sid=${encodeURIComponent(C.sid)}&tok=${encodeURIComponent(C.upload)}`);
  const pr = $("#upProg"); pr.hidden = false; pr.firstElementChild.style.width = "0";
  xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) pr.firstElementChild.style.width = (ev.loaded / ev.total * 100) + "%"; };
  xhr.onload = () => { pr.hidden = true; if (xhr.status === 200) toast(`${files.length} ta fayl yuborildi`, "ok"); else toast("Fayl yuborilmadi (" + xhr.status + ")", "bad"); };
  xhr.onerror = () => { pr.hidden = true; toast("Fayl yuborishda xato", "bad"); };
  xhr.send(fd); e.target.value = "";
});

/* ------------------------------------------------------------------ home screen */
function hosts() { return store.get("hosts", []); }
function saveHost(target, name, pin) {
  const remember = $("#inRemember").checked;
  const list = hosts().filter((h) => h.target !== target);
  list.unshift({ target, name, pin: remember ? pin : "", last: Date.now() });
  store.set("hosts", list.slice(0, 30));
}
function hostRow(h, kind) {
  const el = document.createElement("div"); el.className = "host";
  const sub = kind === "lan" ? `${h.ip} В· mahalliy tarmoq` : (normalizeId(h.target) ? "ID " + h.target.replace(/(\d{3})(\d{3})(\d+)/, "$1 $2 $3") : h.target);
  el.innerHTML = `<div class="h-ic ${kind === "lan" ? "lan" : ""}">${icon(kind === "lan" ? "wifi" : (normalizeId(h.target || "") ? "globe" : "monitor"))}</div>
    <div class="h-body"><div class="h-name"></div><div class="h-sub"></div></div>`;
  el.querySelector(".h-name").textContent = h.name || h.target;
  el.querySelector(".h-sub").textContent = sub;
  if (kind !== "lan") {
    const del = document.createElement("button"); del.className = "icon-btn ghost h-del"; del.innerHTML = icon("trash");
    del.onclick = (e) => { e.stopPropagation(); store.set("hosts", hosts().filter((x) => x.target !== h.target)); renderHome(); };
    el.appendChild(del);
  }
  el.onclick = () => {
    const target = kind === "lan" ? h.id : h.target;
    const saved = hosts().find((x) => x.target === target || (kind === "lan" && x.target === `${h.ip}:${h.port}`));
    $("#inTarget").value = kind === "lan" ? target : h.target;
    $("#inPin").value = (saved && saved.pin) || "";
    if ($("#inPin").value) doConnect(); else { $("#inPin").focus(); toast("PIN kodni kiriting"); }
  };
  return el;
}
function renderHome() {
  const list = hosts();
  const sl = $("#savedList"); sl.innerHTML = "";
  list.forEach((h) => sl.appendChild(hostRow(h, "saved")));
  $("#savedEmpty").hidden = list.length > 0;
}
async function refreshDiscovery() {
  if (!$("#home").classList.contains("active")) return;
  const d = await fetchDiscovered();
  $("#discCard").hidden = !d.length;
  const dl = $("#discList"); dl.innerHTML = "";
  d.forEach((h) => dl.appendChild(hostRow(h, "lan")));
}
setInterval(refreshDiscovery, 2500);
function doConnect() {
  const target = $("#inTarget").value.trim(), pin = $("#inPin").value.trim();
  $("#homeError").hidden = true;
  if (!target) { $("#inTarget").focus(); return; }
  if (!pin) { $("#inPin").focus(); return; }
  C.wasConnected = false; C.retry = 0; C.authFailed = false;
  const saved = hosts().find((h) => h.target === target);
  connect(target, pin, saved ? saved.name : target);
}
$("#btnConnect").addEventListener("click", doConnect);
$("#inPin").addEventListener("keydown", (e) => { if (e.key === "Enter") doConnect(); });
$("#inTarget").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#inPin").focus(); });
$("#btnShowPin").addEventListener("click", () => { const i = $("#inPin"); i.type = i.type === "password" ? "text" : "password"; });

/* Android back button */
window.uzOnBack = () => {
  if (!$("#modal").hidden) { $("#mNo").click(); return true; }
  if ($("#panel").classList.contains("open")) { closePanel(); return true; }
  if (!$("#keybar").hidden) { $("#kbClose").click(); return true; }
  if ($("#viewer").classList.contains("active")) { openPanel(); return true; }
  return false;
};

/* ------------------------------------------------------------------ boot */
paintIcons();
buildKeybar();
buildControlPanel();
$("#ver").textContent = VERSION;
renderHome();
refreshDiscovery();
if (Q.get("connect")) {
  $("#inTarget").value = Q.get("connect"); $("#inPin").value = Q.get("pin") || "";
  if (Q.get("pin")) connect(Q.get("connect"), Q.get("pin"), Q.get("name") || Q.get("connect"));
} else if (SERVED && !A) {
  $("#inTarget").value = location.host;
}
})();
