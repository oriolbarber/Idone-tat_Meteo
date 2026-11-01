"use strict";
/* ============ CEM · valoracions de confort ============
   Després d'escalar, cada persona diu com hi ha estat (de −3 molt fred a +3 molta calor) en una zona, una paret o
   un sector, un dia i una franja. Es desa en aquest mòbil (cem_vots) amb la sensació que preveia l'app.
   - Perfil: amb ≥ 3 valoracions a ≥ 2 llocs diferents, l'app busca el desplaçament de la franja còmoda que fa
     coincidir millor el que deia l'app amb el que has notat, i el proposa (abans → després). No es canvia sol.
   - Ombra de la paret: si la persona té compte confirmat i ho vol, la valoració d'una paret aprovada o d'un sector
     va a «valoracions» (només la llegeixen la persona, l'administració i revisors). Les persones revisores veuen,
     per a cada paret amb ≥ 5 valoracions al sol de ≥ 3 persones, el nivell d'ombra que en surt i l'aproven
     («ombres/{clau}», lectura pública). La diferència de cada valoració ja és respecte a la franja de cada
     persona: així es separa «soc calorós» (perfil) de «la paret té menys ombra» (comunitat). */
(() => {
const VK = "cem_vots", MAXV = 300, RECENT = 20;
const MIN_V = 3, MIN_LLOCS = 2, MAX_OFF = 8;          // perfil: valoracions, llocs diferents, desplaçament màxim (°C) sobre el neutre
const SH_MIN_V = 5, SH_MIN_U = 3, SH_SUN = 0.3, SH_PT = 2;   // ombra: valoracions, persones, part de la franja al sol, punts per nivell
const SCALE = [[-3, "Molt fred"], [-2, "Fred"], [-1, "Una mica fresc"], [0, "Bé"], [1, "Una mica de calor"], [2, "Calor"], [3, "Molta calor"]];

let V = store.get(VK, []);
let dismissAt = store.get("cem_sug_no", 0);
let form = null, revV = null, revAt = 0, revBusy = false;

const adj = (r, c) => (r === "climb" ? 4 : 0) + (c - 1) * 7;   // el mateix que feelT
// Vot que esperaria l'app per a una sensació F i una franja còmoda lo–hi (0 a dins; ±0,5 a la vora; ±3 a 10 °C fora)
function expVote(F, lo, hi){ return F > hi ? Math.min(3, 0.5 + (F - hi) / 4) : F < lo ? Math.max(-3, -0.5 - (lo - F) / 4) : 0; }
const r2 = x => Math.round(x * 100) / 100;

/* ---------- dies que es poden valorar: avui i els 3 anteriors (la previsió en porta 3 de passats) ---------- */
function pastDays(){
  if(!DATA) return [];
  const o = Object.values(DATA.zones)[0], today = localOf(Date.now()).key, s = new Set();
  o.loc.forEach(l => { if(l.key <= today) s.add(l.key); });
  return [...s].sort().reverse().slice(0, 4);
}
function pdLbl(k){ const i = dayIdx(k), d = new Date(k + "T12:00:00");
  return (i === 0 ? "Avui" : i === -1 ? "Ahir" : DOW[d.getDay()]) + " " + d.getDate(); }

/* ---------- predicció de l'app per a la franja valorada ---------- */
function predict(z, key, day, slot, r, c){
  const ev = zoneEval(z), sg = key === "zona" ? null : ev.segs.find(x => x.key === key);
  const rows = slotVerdict(sg ? sg.rows : ev.zoneRows, ev.o, day, slot).rows;
  if(!rows.length) return null;
  const d = adj(r, c) - adj(role, clo);
  return {F: rows.reduce((s, x) => s + x.feel, 0) / rows.length + d, sun: rows.filter(x => x.sunGeo).length / rows.length,
    lvl: sg ? sg.sh.lv : null, src: sg ? sg.sh.src : null};
}
// Es pot compartir: sectors d'OSM i parets aprovades (les d'aquest mòbil no les veu ningú més)
const shareable = key => key.startsWith("s:") || cloudWalls.some(w => key.startsWith(w.id + ":"));

/* ---------- proposta de perfil ---------- */
// Pes: amb sol a la paret i ombra no revisada, la diferència pot ser de la paret i no de la persona
const wt = v => v.sun >= SH_SUN && v.src !== "com" ? 0.5 : 1;
function suggestion(){
  const vs = V.slice(-RECENT);
  if(vs.length < MIN_V || new Set(vs.map(v => v.zone + "|" + v.key)).size < MIN_LLOCS) return null;
  if(!vs.some(v => v.at > dismissAt)) return null;
  const lo = crit.comfLo, hi = crit.comfHi, cur = lo - CRIT_DEF.comfLo;
  let best = {s: 0, c: Infinity};
  for(let s = -MAX_OFF - cur; s <= MAX_OFF - cur; s++){
    let c = 0.1 * s * s;                                   // preferència pels canvis petits
    vs.forEach(v => { c += wt(v) * (v.vote - expVote(v.F, lo + s, hi + s)) ** 2; });
    if(c < best.c - 1e-9) best = {s, c};
  }
  return best.s ? {s: best.s, n: vs.length, lo, hi} : null;
}
function sugHTML(){
  const g = suggestion(); if(!g) return "";
  const a = Math.abs(g.s);
  return `<div class="sug"><b>${g.s < 0 ? "Notes més calor" : "Notes més fred"} del que preveu l'app</b>` +
    `<p>Amb les teves ${g.n} últimes valoracions, la franja còmoda que hi encaixa més és ${g.s < 0 ? a + " °C més baixa" : a + " °C més alta"}:</p>` +
    `<p class="ba"><span>Ara <b>${g.lo}–${g.hi} °C</b></span><span aria-hidden="true">→</span><span>Proposta <b>${g.lo + g.s}–${g.hi + g.s} °C</b></span></p>` +
    `<div class="row"><button class="btn" type="button" data-sug="no">Ara no</button><button class="btn pri" type="button" data-sug="ok" data-s="${g.s}">Aplica-ho</button></div></div>`;
}
function applySug(s){
  crit.comfLo += s; crit.comfHi += s; store.set("cem_crit", crit);
  perfil = "pers"; store.set("cem_perfil", perfil);
  dismissAt = Date.now(); store.set("cem_sug_no", dismissAt);
  renderPanels(); renderAll(); msg(`Franja còmoda: ${crit.comfLo}–${crit.comfHi} °C.`); setTimeout(() => msg(null), 4000);
}

/* ---------- fitxa de zona: botó i proposta ---------- */
function sheetHTML(z){
  if(!pastDays().length) return "";
  const n = V.filter(v => v.zone === z.id).length;
  return `<div class="vote-cta"><button class="btn" type="button" data-vote="${esc(z.id)}">Com hi has estat? Valora el confort</button>` +
    (n ? `<small class="muted">${n} valoraci${n > 1 ? "ons" : "ó"} teva${n > 1 ? "s" : ""} aquí</small>` : "") + `</div>` + sugHTML();
}

/* ---------- formulari ---------- */
function open(zid){
  const z = ZONES.find(z => z.id === zid); if(!z || !DATA) return;
  const day = pastDays()[0], slot = localOf(Date.now()).h < 14 ? "am" : "pm", sv = zoneSlot(zoneEval(z), day, slot);
  form = {zone: zid, day, slot, key: sv.seg ? sv.seg.key : "zona", role, clo, vote: null, share: true};
  ["calSheet", "rankSheet", "infoSheet"].forEach(x => $(x).hidden = true);
  $("voteSheet").hidden = false; render();
}
function render(){
  const z = ZONES.find(z => z.id === form.zone), ev = zoneEval(z), p = predict(z, form.key, form.day, form.slot, form.role, form.clo);
  const seg = (lbl, attr, opts, cur) => `<div class="prow"><span class="lbl">${lbl}</span><div class="seg" role="group" aria-label="${lbl}">` +
    opts.map(([v, t]) => `<button type="button" data-${attr}="${v}" aria-pressed="${String(v) === String(cur)}">${t}</button>`).join("") + `</div></div>`;
  const faces = ev.segs.map(x => [x.key, x.w.name + (x.w.sector ? " – " : " · ") + cardOf(x.az) + (x.sh.lv ? " (" + SHADE[x.sh.lv].t.toLowerCase() + ")" : "")]);
  const acc = !!(window.CEM_CLOUD && CEM_CLOUD.uid()), canShare = form.key !== "zona" && shareable(form.key);
  let h = `<p><b>${esc(z.name)}</b></p>` +
    seg("Dia", "vd", pastDays().map(k => [k, pdLbl(k)]), form.day) +
    seg("Franja", "vs", [["am", "Matí"], ["pm", "Tarda"]], form.slot) +
    `<div class="prow"><label class="lbl" for="vKey">On</label><select id="vKey" class="sel">` +
    faces.map(([k, t]) => `<option value="${esc(k)}"${k === form.key ? " selected" : ""}>${esc(t)}</option>`).join("") +
    `<option value="zona"${form.key === "zona" ? " selected" : ""}>No ho sé / tota la zona</option></select></div>` +
    seg("Hi estaves", "vr", [["climb", "Escalant"], ["belay", "Assegurant"]], form.role) +
    seg("Roba", "vc", [[0.5, "Lleugera"], [1, "Normal"], [1.6, "D'abric"]], form.clo);
  h += p ? `<p class="note">L'app preveia una sensació d'uns <b>${Math.round(p.F)} °C</b> (${feelTxt(p.F).toLowerCase()})${p.sun >= SH_SUN ? ", amb sol a la paret" : ""}.</p>`
    : `<p class="note">Aquesta franja no té hores de llum: tria'n una altra.</p>`;
  h += `<div class="prow"><span class="lbl">Com hi has estat?</span><div class="vscale" role="group" aria-label="Com hi has estat">` +
    SCALE.map(([v, t]) => `<button type="button" data-vv="${v}" aria-pressed="${form.vote === v}" class="v${v < 0 ? "c" : v > 0 ? "h" : "o"}"><b>${v > 0 ? "+" + v : v}</b>${t}</button>`).join("") + `</div></div>`;
  if(canShare) h += acc ? `<label class="ck"><input type="checkbox" id="vShare"${form.share ? " checked" : ""}> Comparteix-la per ajustar l'ombra d'aquesta paret per a tothom (sense el teu nom)</label>`
    : `<p class="note">Amb un compte (⋮ ▸ Compte) la pots compartir per ajustar l'ombra de la paret per a tothom.</p>`;
  h += `<button class="btn pri" type="button" data-vsave${form.vote == null || !p ? " disabled" : ""}>Desa la valoració</button>`;
  $("voteBody").innerHTML = h;
}
async function save(){
  const z = ZONES.find(z => z.id === form.zone), p = predict(z, form.key, form.day, form.slot, form.role, form.clo);
  if(!p || form.vote == null) return;
  const e = expVote(p.F, crit.comfLo, crit.comfHi);
  const v = {id: "v" + Date.now().toString(36), at: Date.now(), zone: form.zone, key: form.key, day: form.day, slot: form.slot, role: form.role, clo: form.clo,
    vote: form.vote, F: Math.round(p.F * 10) / 10, lo: crit.comfLo, hi: crit.comfHi, dif: r2(form.vote - e), sun: r2(p.sun), lvl: p.lvl, src: p.src};
  // la mateixa franja i lloc es pot tornar a valorar: queda l'última
  const same = x => x.zone === v.zone && x.key === v.key && x.day === v.day && x.slot === v.slot && x.role === v.role;
  const old = V.find(same);
  V = V.filter(x => !same(x)).concat(v).slice(-MAXV); store.set(VK, V);
  const share = form.share && v.key !== "zona" && shareable(v.key);
  $("voteSheet").hidden = true; form = null;
  renderAll(); renderPanels();
  msg("Valoració desada." + (suggestion() ? " A la fitxa tens una proposta per ajustar la teva franja." : "")); setTimeout(() => msg(null), 5000);
  if(share) upload(v, old);
}
async function upload(v, old){
  try{
    const q = window.CEM_CLOUD && await CEM_CLOUD.quiet(); if(!q) return;
    const {f, db, uid} = q;
    if(old && old.up) await f.deleteDoc(f.doc(db, "valoracions", old.up)).catch(() => {});
    const ref = await CEM_CLOUD.T(f.addDoc(f.collection(db, "valoracions"), {userId: uid, zone: v.zone, key: v.key, dia: v.day, franja: v.slot,
      rol: v.role, vot: v.vote, dif: v.dif, sol: v.sun, nivell: v.lvl ?? 0, creat: f.serverTimestamp()}));
    const x = V.find(x => x.id === v.id); if(x){ x.up = ref.id; store.set(VK, V); }
  }catch(e){ msg("La valoració s'ha desat en aquest mòbil, però no s'ha pogut compartir: " + CEM_CLOUD.errText(e), true); }
}

/* ---------- Menú ▸ Llindars ---------- */
function panel(){
  const box = $("confSug"); if(!box) return;
  box.innerHTML = sugHTML() + (V.length ? `<details class="more"><summary>${V.length} valoraci${V.length > 1 ? "ons" : "ó"} de confort en aquest mòbil</summary><div id="vDel"></div></details>`
    : `<p class="note">Després d'escalar, valora el confort a la fitxa de la zona: amb unes quantes, l'app et proposa ajustar la franja.</p>`);
  const d = $("vDel"); if(d) slideConfirm(d, "Llisca per esborrar les valoracions", () => { V = []; store.set(VK, V); panel(); renderAll(); });
}

/* ---------- revisió: nivell d'ombra que surt de les valoracions ---------- */
function nameOf(key){
  if(key.startsWith("s:")){ const [, sid, c] = key.split(":");
    for(const z of ZONES){ const s = (z.sectors || []).find(s => s.id === sid);
      if(s) return {z, t: (s.name || "Sector sense nom") + (s.f && s.f[+c] ? " – " + cardOf(cloudOri[key] ?? s.f[+c].az) : ""), def: null}; } return null; }
  const i = key.lastIndexOf(":"), w = cloudWalls.find(w => w.id === key.slice(0, i)); if(!w) return null;
  const z = ZONES.find(z => z.id === w.zone), s = w.segs[+key.slice(i + 1)];
  return {z, t: w.name + (w.segs.length > 1 ? " · tram " + (+key.slice(i + 1) + 1) : ""), def: s ? s.om : null};
}
function shadeSugs(){
  const by = {};
  (revV || []).forEach(v => { if(v.sol >= SH_SUN && v.nivell != null) (by[v.key] = by[v.key] || []).push(v); });
  const out = [];
  Object.entries(by).forEach(([key, vs]) => {
    const u = new Set(vs.map(v => v.userId)).size; if(vs.length < SH_MIN_V || u < SH_MIN_U) return;
    const nm = nameOf(key); if(!nm) return;
    const target = Math.round(vs.reduce((s, v) => s + clamp(v.nivell - v.dif / SH_PT, 0, 3), 0) / vs.length);
    const cur = cloudShade[key] ?? nm.def ?? 0;
    if(target !== cur) out.push({key, nm, n: vs.length, u, target, cur, m: vs.reduce((s, v) => s + v.dif, 0) / vs.length});
  });
  return out;
}
async function loadRev(){
  if(revBusy) return; revBusy = true;
  try{ const q = window.CEM_CLOUD && await CEM_CLOUD.quiet(); if(!q || !q.isRev) return;
    const qs = await CEM_CLOUD.T(q.f.getDocs(q.f.collection(q.db, "valoracions")));
    revV = qs.docs.map(d => d.data()); revAt = Date.now();
  }catch(e){ revV = revV || []; }
  finally{ revBusy = false; }
  const b = $("revShade"); if(b) b.innerHTML = revHTML();
}
function revHTML(){
  if(!revV) return `<p class="note">Carregant les valoracions…</p>`;
  const ss = shadeSugs();
  return ss.length ? ss.map(s => `<div class="rv"><div><b>${esc(s.nm.t)}</b> · ${esc(s.nm.z ? s.nm.z.name : "")}</div>` +
      `<div class="note">${s.n} valoracions al sol de ${s.u} persones: de mitjana, ${s.m > 0 ? "més calor" : "més fred"} del previst (${s.m > 0 ? "+" : ""}${s.m.toFixed(1).replace(".", ",")}).</div>` +
      `<p class="ba"><span>Ara <b>${SHADE[s.cur].t}</b></span><span aria-hidden="true">→</span><span>Proposta <b>${SHADE[s.target].t}</b></span></p>` +
      `<div class="row"><button class="btn pri" type="button" data-shok="${esc(s.key)}" data-lv="${s.target}" data-n="${s.n}">Aplica-la</button></div></div>`).join("")
    : `<p class="note">Cap paret amb prou valoracions (${SH_MIN_V} al sol, de ${SH_MIN_U} persones) que demani canviar l'ombra.</p>`;
}
function revRender(box){
  const d = document.createElement("div"); d.className = "acc"; d.innerHTML = `<h3>Ombra de les parets (valoracions)</h3><div id="revShade">${revHTML()}</div>`;
  box.appendChild(d);
  if(Date.now() - revAt > 10 * 60e3) loadRev();
}
async function approveShade(key, lv, n){
  try{
    const q = await CEM_CLOUD.quiet(); if(!q || !q.isRev) return;
    const nm = nameOf(key);
    await CEM_CLOUD.T(q.f.setDoc(q.f.doc(q.db, "ombres", key.replace(/[:/]/g, "_")), {key, zone: nm && nm.z ? nm.z.id : "", nivell: lv, n, v: 1, aprovat: q.f.serverTimestamp()}));
    cloudShade[key] = lv; store.set("cem_cloud_shade", cloudShade);
    renderAll(); const b = $("revShade"); if(b) b.innerHTML = revHTML();
    msg("Nivell d'ombra aplicat: ja el veu tothom."); setTimeout(() => msg(null), 4000);
  }catch(e){ msg(CEM_CLOUD.errText(e), true); }
}

/* ---------- events ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest ? e.target : null; if(!t) return;
  const o = t.closest("button[data-vote]"); if(o){ open(o.dataset.vote); return; }
  const sg = t.closest("button[data-sug]");
  if(sg){ if(sg.dataset.sug === "ok") applySug(+sg.dataset.s); else { dismissAt = Date.now(); store.set("cem_sug_no", dismissAt); renderAll(); renderPanels(); } return; }
  const sk = t.closest("button[data-shok]"); if(sk){ approveShade(sk.dataset.shok, +sk.dataset.lv, +sk.dataset.n); return; }
  if(!form || !t.closest("#voteBody")) return;
  const b = t.closest("button");
  if(!b) return;
  if(b.dataset.vd){ form.day = b.dataset.vd; render(); }
  else if(b.dataset.vs){ form.slot = b.dataset.vs; render(); }
  else if(b.dataset.vr){ form.role = b.dataset.vr; render(); }
  else if(b.dataset.vc){ form.clo = +b.dataset.vc; render(); }
  else if(b.dataset.vv != null){ form.vote = +b.dataset.vv; render(); }
  else if(b.hasAttribute("data-vsave")) save();
});
document.addEventListener("change", e => {
  if(!form) return;
  if(e.target.id === "vKey"){ form.key = e.target.value; render(); }
  if(e.target.id === "vShare") form.share = e.target.checked;
});

window.CEM_CONF = {sheetHTML, panel, revRender, expVote, suggestion};
renderPanels(); renderAll();
})();
