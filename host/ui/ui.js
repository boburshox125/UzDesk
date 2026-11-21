(() => {
"use strict";
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
let S = null, pinVisible = false, approving = null;

async function api(action, body) {
  const r = await fetch("/api/" + action, { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  return r.json().catch(() => ({}));
}
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("show"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2000); }
async function copy(t) {
  try { await navigator.clipboard.writeText(t); }
  catch (e) { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
  toast("Nusxa olindi");
}
const fmtId = (id) => id.replace(/(\d{3})(\d{3})(\d+)/, "$1 $2 $3");
const ago = (t) => { const s = Math.round(Date.now() / 1000 - t); if (s < 60) return s + " s"; if (s < 3600) return Math.floor(s / 60) + " daq"; return Math.floor(s / 3600) + " soat"; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const IC = {
  phone: '<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
  pc: '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  wifi: '<svg viewBox="0 0 24 24"><path d="M5 12.6a10 10 0 0 1 14 0M1.4 9a15 15 0 0 1 21.2 0M8.5 16.1a5 5 0 0 1 7 0M12 20h.01"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
};

$$(".nav").forEach((n) => n.addEventListener("click", () => {
  $$(".nav").forEach((x) => x.classList.toggle("active", x === n));
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === n.dataset.page));
}));

async function refresh() {
  try {
    const r = await fetch("/api/state", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    S = await r.json();
    render();
  } catch (e) {
    $("#stDot").className = "dot bad"; $("#stText").textContent = "Server javob bermayapti";
  }
}

function render() {
  $("#ver").textContent = "v" + S.version;
  $("#devId").textContent = fmtId(S.device_id);
  $("#pin").textContent = pinVisible ? S.pin : "••••••";
  const err = S.error;
  $("#errCard").hidden = !err; $("#errCard").textContent = err ? "Xato: " + err : "";
  $("#stDot").className = "dot " + (err ? "bad" : "ok");
  $("#stText").textContent = err ? "Xato" : (S.clients.length ? `${S.clients.length} ta ulanish faol` : "Ulanishga tayyor");
  $("#adminWarn").hidden = S.admin;

  const al = $("#addrList"); al.innerHTML = "";
  if (!S.addresses.length) al.innerHTML = '<div class="tun-info">Tarmoq topilmadi</div>';
  S.addresses.forEach((ip) => {
    const d = document.createElement("div"); d.className = "addr";
    d.innerHTML = `<span>${esc(ip)}:${S.port}</span><button>Nusxa</button>`;
    d.querySelector("button").onclick = () => copy(`${ip}:${S.port}`);
    al.appendChild(d);
  });

  const t = S.tunnel; const sw = $("#tunnelSw");
  if (document.activeElement !== sw) sw.checked = t.state !== "off";
  const ti = $("#tunnelInfo");
  if (t.state === "off") ti.innerHTML = "O'chiq. Yoqsangiz, boshqa shahar yoki mobil internetdan ham <b>ID</b> orqali ulanish mumkin.";
  else if (t.state === "starting") ti.innerHTML = "Ulanmoqda... (Cloudflare tunnel)";
  else if (t.state === "online") {
    ti.innerHTML = `<span style="color:#86efac">● Internetda faol</span> — telefonda ID ni kiriting yoki havoladan foydalaning:<div class="tun-url"><span>${esc(t.url)}</span><button class="ib" title="Nusxa">${'<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'}</button></div>`;
    ti.querySelector("button").onclick = () => copy(t.url);
  } else ti.innerHTML = `<span style="color:#fca5a5">${esc(t.error || "Xato")}</span>`;

  $("#cliCount").textContent = S.clients.length;
  $("#cliEmpty").hidden = S.clients.length > 0;
  const cl = $("#clients"); cl.innerHTML = "";
  S.clients.forEach((c) => {
    const d = document.createElement("div"); d.className = "item";
    d.innerHTML = `<div class="ic">${/android|iphone|telefon/i.test(c.name) ? IC.phone : IC.pc}</div>
      <div class="bd"><div class="nm">${esc(c.name)}</div><div class="sb">${esc(c.peer)} · ${ago(c.since)} · ${esc((c.codec || "").toUpperCase())} ${c.fps} FPS · ${(c.kbps / 1000).toFixed(1)} Mbit/s</div></div>
      <button class="btn danger small" style="margin:0">Uzish</button>`;
    d.querySelector("button").onclick = () => api("kick", { id: c.id }).then(refresh);
    cl.appendChild(d);
  });

  const ev = $("#events"); ev.innerHTML = "";
  S.events.slice().reverse().forEach((e) => {
    const d = document.createElement("div"); d.className = "ev";
    d.innerHTML = `<b>${new Date(e.t * 1000).toLocaleTimeString().slice(0, 5)}</b><span>${esc(e.text)}</span>`;
    ev.appendChild(d);
  });
  if (!S.events.length) ev.innerHTML = '<p class="empty">Hozircha voqea yo\'q.</p>';

  // pending approvals
  const p = S.pending[0];
  if (p && (!approving || approving !== p.id)) {
    approving = p.id; $("#apText").innerHTML = `<b>${esc(p.name)}</b> (${esc(p.peer)}) bu kompyuterni boshqarmoqchi.`; $("#approve").hidden = false;
  } else if (!p && approving) { approving = null; $("#approve").hidden = true; }

  // settings
  $$("[data-set]").forEach((i) => { if (document.activeElement !== i) i.checked = !!S.settings[i.dataset.set]; });
  if (document.activeElement !== $("#sName")) $("#sName").value = S.name;
  $("#passState").textContent = S.password_set ? "Doimiy parol o'rnatilgan. O'chirish uchun bo'sh qoldirib saqlang." : "Doimiy parol o'rnatilmagan — faqat PIN ishlaydi.";
  $("#iPort").textContent = S.port;
  $("#iEnc").textContent = S.encoders.length ? S.encoders.join(", ") : "tekshirilmoqda...";
  $("#iAdmin").textContent = S.admin ? "Ha" : "Yo'q";
  $("#iDl").textContent = S.downloads;

  renderConnect();
}

function renderConnect() {
  const disc = S.discovered || [];
  $("#cDiscCard").hidden = !disc.length;
  const dl = $("#cDisc"); dl.innerHTML = "";
  disc.forEach((h) => dl.appendChild(hostItem({ target: h.id, name: h.name, sub: `${h.ip}:${h.port} · ID ${fmtId(h.id)}` }, true)));
  const saved = S.saved_hosts || [];
  $("#cSavedEmpty").hidden = saved.length > 0;
  const sl = $("#cSaved"); sl.innerHTML = "";
  saved.forEach((h) => sl.appendChild(hostItem(Object.assign({ sub: /^\d{9,12}$/.test(h.target) ? "ID " + fmtId(h.target) : h.target }, h), false)));
}
function hostItem(h, lan) {
  const d = document.createElement("div"); d.className = "item click";
  d.innerHTML = `<div class="ic ${lan ? "lan" : ""}">${lan ? IC.wifi : IC.pc}</div><div class="bd"><div class="nm">${esc(h.name)}</div><div class="sb">${esc(h.sub)}</div></div>`;
  if (!lan) {
    const b = document.createElement("button"); b.className = "ib"; b.innerHTML = IC.x; b.title = "O'chirish";
    b.onclick = (e) => { e.stopPropagation(); api("delete_host", { target: h.target }).then(refresh); };
    d.appendChild(b);
  }
  d.onclick = () => {
    const saved = (S.saved_hosts || []).find((x) => x.target === h.target);
    $("#cTarget").value = h.target; $("#cPin").value = (saved && saved.pin) || "";
    if ($("#cPin").value) go(); else $("#cPin").focus();
  };
  return d;
}
async function go() {
  const target = $("#cTarget").value.trim().replace(/\s+/g, /^\d[\d\s]+$/.test($("#cTarget").value.trim()) ? "" : " ");
  const pin = $("#cPin").value.trim();
  if (!target || !pin) { toast("ID va PIN ni kiriting"); return; }
  const disc = (S.discovered || []).find((d) => d.id === target);
  const old = (S.saved_hosts || []).find((x) => x.target === target);
  const name = (disc && disc.name) || (old && old.name) || target;
  await api("save_host", { target, name, pin, remember: $("#cRemember").checked });
  await api("open_client", { target, pin, name });
  toast("Ulanish oynasi ochilmoqda...");
  refresh();
}
$("#cGo").onclick = go;
$("#cPin").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });

$("#pinShow").onclick = () => { pinVisible = !pinVisible; render(); };
$("#pinCopy").onclick = () => copy(S.pin);
$("#pinNew").onclick = async () => { await api("pin"); pinVisible = true; await refresh(); toast("Yangi PIN yaratildi"); };
$("#tunnelSw").onchange = async (e) => { await api("tunnel", { on: e.target.checked }); refresh(); };
$$("[data-set]").forEach((i) => i.addEventListener("change", async () => { await api("settings", { [i.dataset.set]: i.checked }); refresh(); }));
$("#sNameSave").onclick = async () => { await api("name", { name: $("#sName").value }); toast("Saqlandi"); refresh(); };
$("#sPassSave").onclick = async () => { const r = await api("password", { password: $("#sPass").value }); toast(r.ok === false ? r.error : "Saqlandi"); $("#sPass").value = ""; refresh(); };
$("#clearTrusted").onclick = async () => { await api("trusted_clear"); toast("Tozalandi"); };
$("#btnElevate").onclick = () => api("elevate");
$("#openDl").onclick = () => api("open_folder");
$("#quit").onclick = async () => { if (confirm("UzDesk to'liq yopilsinmi? Masofadan ulanish to'xtaydi.")) api("quit"); };
$$("#approve [data-dec]").forEach((b) => b.onclick = async () => {
  if (approving) await api("approve", { id: approving, decision: b.dataset.dec });
  $("#approve").hidden = true; refresh();
});

refresh();
setInterval(refresh, 1500);
})();
