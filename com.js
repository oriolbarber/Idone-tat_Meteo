"use strict";
/* ============ CEM · aportacions de la comunitat ============
   Model (01-11-2026): qualsevol persona registrada amb el correu confirmat publica i es veu a l'instant.
   - «provisional» → 2 confirmacions d'altres persones → «confirmada».
   - 2 rebutjos («No és correcte») → «revisio»: desapareix de l'app i va a ⋮ ▸ Revisió (administració, revisors, premium).
   - Persones marcades amb «revisar» (ho posa l'administració) → «pendent»: no es veu fins que la revisió l'aprova.
   - Comptes de menys de 7 dies: màxim 5 aportacions al dia (comprovat a firestore.rules).
   Què es pot aportar:
   - Parets traçades (col·lecció «parets», les publica cloud.js) i orientació de cada cara de sector («orientacions»).
   - Sectors nous que no són a OpenStreetMap («sectors»: punt al mapa, nom, sector | bloc, cap on mira).
   - Tipus de roca d'una zona («roques/{zona}»: canvia el temps de secat). «prev» = últim valor confirmat.
   Aquest mòdul: botó + del mapa, triar el punt d'un sector, formularis, vots ✓/✗ i safata de revisió.
   Lectura pública per l'API REST (sense carregar Firebase). */
(() => {
const PID = "cem-meteo", KEY = "AIzaSyCHZXN2YU9Eotz0PnWrHgmVrgFvzc_4mic";
const NEED = 2, TTL = 30 * 60e3, LIC = "ODbL-1.0", NEAR = 5000;   // sector nou: a < 5 km d'una zona
const C = () => window.CEM_CLOUD;
const comOf = f => ({estat: f.estat || "confirmada", conf: f.conf || {}, reb: f.reb || {}, per: f.per || "", prev: f.prev ?? null});
const HIDDEN = new Set(["revisio", "pendent"]);

let SECS = store.get("cem_com_secs", []);     // [{id, f}] sectors nous
let ROCKC = store.get("cem_com_rocks", []);   // [{id, f}] roca de les zones
let revQ = [], revNames = {}, pick = null, pickPt = null, form = null;

/* ---------- lectura pública (REST) ---------- */
async function restList(col){
  const base = `https://firestore.googleapis.com/v1/projects/${PID}/databases/(default)/documents/${col}?pageSize=300&key=${KEY}`;
  const out = []; let tok = "";
  do{
    const r = await fetch(base + (tok ? "&pageToken=" + encodeURIComponent(tok) : "")); if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    (j.documents || []).forEach(d => { const f = {}; Object.entries(d.fields || {}).forEach(([k, v]) => f[k] = C().decodeV(v)); out.push({id: d.name.split("/").pop(), f}); });
    tok = j.nextPageToken || "";
  }while(tok);
  return out;
}
async function fetchCom(force){
  if(!force && Date.now() - store.get("cem_com_at", 0) < TTL) return;
  try{
    const [s, r] = await Promise.all([restList("sectors"), restList("roques")]);
    SECS = s; ROCKC = r; store.set("cem_com_secs", s); store.set("cem_com_rocks", r); store.set("cem_com_at", Date.now());
    render();
  }catch(e){ /* sense connexió: queden les desades */ }
}

/* ---------- aplicar al catàleg ---------- */
// Sectors nous dins de la seva zona (els de qui els ha publicat es veuen també si són pendents) i roca de la comunitat
function apply(){
  const me = C() && C().uid();
  ZONES.forEach(z => {
    if(z.sectors) z.sectors = z.sectors.filter(s => !s.com);
    if(z._rock0 !== undefined){ z.rock = z._rock0; z.rockGuess = z._rg0; }
    z.rockCom = null;
  });
  SECS.forEach(d => { const c = comOf(d.f); if(HIDDEN.has(c.estat) && !(me && c.per === me)) return;
    const z = ZONES.find(z => z.id === d.f.zone); if(!z) return;
    z.sectors.push({id: "c_" + d.id, name: d.f.name || "", lat: d.f.lat, lon: d.f.lon, kind: d.f.kind || "sector", o: "usr",
      f: d.f.az != null ? [{az: d.f.az}] : [], com: Object.assign({id: d.id, col: "sectors"}, c)}); });
  ROCKC.forEach(d => { const z = ZONES.find(z => z.id === d.id); if(!z) return; const c = comOf(d.f);
    const v = HIDDEN.has(c.estat) ? c.prev : d.f.rock;
    z.rockCom = Object.assign({id: d.id, col: "roques", rock: d.f.rock}, c);
    if(v && ROCKS[v]){ if(z._rock0 === undefined){ z._rock0 = z.rock; z._rg0 = z.rockGuess; } z.rock = v; z.rockGuess = false; } });
  cache.clear();
}
function render(){ apply(); if(typeof renderSectors === "function") renderSectors(); renderAll(); }

/* ---------- estat i vots ---------- */
const ST = {provisional: ["mid", "Provisional"], confirmada: ["ok", "Confirmada"], pendent: ["na", "Pendent de revisió"], revisio: ["no", "En revisió"]};
function voteHTML(col, id, c){
  if(!c) return "";
  const me = C() && C().uid(), n = Object.keys(c.conf || {}).length, [cl, tx] = ST[c.estat] || ST.confirmada;
  let h = `<span class="wtag lv-${cl}">${tx}${c.estat === "provisional" ? ` · ${n}/${NEED}` : ""}</span>`;
  if(c.estat === "provisional"){
    if(me && me === c.per) h += `<small class="muted">l'has publicada tu</small>`;
    else if(me && ((c.conf || {})[me] || (c.reb || {})[me])) h += `<small class="muted">ja l'has valorada</small>`;
    else h += `<button class="btn sm pri" type="button" data-vote="ok" data-col="${col}" data-id="${esc(id)}">✓ Correcte</button>` +
      `<button class="btn sm" type="button" data-vote="no" data-col="${col}" data-id="${esc(id)}">✗ No ho és</button>`;
  }else if(c.estat === "pendent") h += `<small class="muted">només la veus tu fins que es revisi</small>`;
  return `<span class="vrow">${h}</span>`;
}
async function vote(col, id, ok){
  const c = await C().need("Per confirmar o rebutjar aportacions cal un compte (gratuït)."); if(!c) return;
  const {f, db, uid} = c, ref = f.doc(db, col, id);
  try{
    const snap = await C().T(f.getDoc(ref));
    if(!snap.exists()){ msg("Aquesta aportació ja no hi és.", true); return refreshAll(); }
    const d = snap.data();
    if(d.estat !== "provisional"){ msg("Ja no és provisional: algú l'ha valorada abans.", false); return refreshAll(); }
    if(d.per === uid){ msg("No pots confirmar el que has publicat tu.", true); return; }
    if((d.conf || {})[uid] || (d.reb || {})[uid]){ msg("Ja l'havies valorada.", false); return; }
    const m = ok ? "conf" : "reb", nm = Object.assign({}, d[m] || {}, {[uid]: true}), n = Object.keys(nm).length;
    const estat = n >= NEED ? (ok ? "confirmada" : "revisio") : "provisional";
    await C().T(f.updateDoc(ref, {[m]: nm, estat}));
    patchLocal(col, id, m, nm, estat);
    msg(ok ? (estat === "confirmada" ? "Gràcies! Ara és confirmada per a tothom." : "Gràcies! Falta una confirmació més.")
      : (estat === "revisio" ? "Gràcies. S'ha amagat i la revisarà l'administració." : "Anotat. Si una altra persona tampoc la confirma, s'amagarà."));
    setTimeout(() => msg(null), 5000);
    setTimeout(refreshAll, 4000);
  }catch(e){ msg(C().errText(e), true); }
}
// Canvi immediat a la vista (després es torna a llegir de la base de dades)
function patchLocal(col, id, m, nm, estat){
  const up = o => { if(!o) return; o[m] = nm; o.estat = estat; };
  if(col === "parets"){ const w = cloudWalls.find(w => w.id === id); if(w){ up(w.com); if(HIDDEN.has(estat)) cloudWalls = cloudWalls.filter(x => x !== w); store.set("cem_cloud_walls", cloudWalls); } renderWalls(); }
  if(col === "orientacions"){ const k = Object.keys(oriMeta).find(k => oriMeta[k].id === id); if(k){ up(oriMeta[k]);
    if(HIDDEN.has(estat)){ if(oriMeta[k].prev != null) cloudOri[k] = oriMeta[k].prev; else delete cloudOri[k]; store.set("cem_cloud_ori", cloudOri); } store.set("cem_ori_meta", oriMeta); } }
  if(col === "sectors"){ const d = SECS.find(d => d.id === id); if(d){ d.f[m] = nm; d.f.estat = estat; store.set("cem_com_secs", SECS); } }
  if(col === "roques"){ const d = ROCKC.find(d => d.id === id); if(d){ d.f[m] = nm; d.f.estat = estat; store.set("cem_com_rocks", ROCKC); } }
  cache.clear(); render();
}
function refreshAll(){ C().refresh(); fetchCom(true); }

/* ---------- botó + del mapa ---------- */
function toggleAdd(v){ const m = $("addMenu"), on = v ?? m.hidden; m.hidden = !on; $("addBtn").setAttribute("aria-expanded", String(on)); }
$("addBtn").addEventListener("click", () => toggleAdd());
$("addMenu").addEventListener("click", e => {
  const b = e.target.closest("button[data-add]"); if(!b) return; toggleAdd(false);
  if(b.dataset.add === "sector") startPick(null);
  else if(b.dataset.add === "paret") startDraw();
  else { msg("Toca una zona al mapa: a la fitxa pots corregir la roca, l'orientació de cada sector i afegir restriccions.", false); setTimeout(() => msg(null), 7000); }
});

/* ---------- sector nou: tocar el mapa ---------- */
function startPick(zoneId){
  const z = zoneId ? ZONES.find(z => z.id === zoneId) : null;
  pick = {zone: zoneId}; pickPt = null; window.CEM_PICK = true; document.body.classList.add("drawing");
  $("sheet").hidden = true; $("daybar").hidden = true; $("layerPanel").hidden = true; $("pickBar").hidden = false;
  if(base !== "orto"){ base = "orto"; applyBase(); }
  if(z) map.flyTo({center: [z.lon, z.lat], zoom: Math.max(map.getZoom(), 15)}); else if(map.getZoom() < 13) msg("Apropa't al lloc del sector i toca'l al mapa.", false);
  updPick();
}
function updPick(){
  const src = map.getSource("draw");
  src && src.setData({type: "FeatureCollection", features: pickPt ? [{type: "Feature", geometry: {type: "Point", coordinates: pickPt}}] : []});
  $("pickDone").disabled = !pickPt;
  $("pickTxt").textContent = pickPt ? "Punt triat. Toca un altre lloc per moure'l, o «Fet»." : "Toca el mapa al peu del sector.";
}
function endPick(keepSheet = true){
  pick = null; pickPt = null; window.CEM_PICK = false; document.body.classList.remove("drawing"); updPick(); msg(null);
  $("pickBar").hidden = true; $("daybar").hidden = false; if(keepSheet && selZone) $("sheet").hidden = false;
}
map.on("click", e => {
  if(!$("addMenu").hidden) toggleAdd(false);
  if(!pick) return;
  pickPt = [+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)]; updPick();
});
$("pickCancel").addEventListener("click", () => endPick());
$("pickDone").addEventListener("click", () => {
  if(!pickPt) return;
  let z = pick.zone ? ZONES.find(z => z.id === pick.zone) : null, best = z ? distM(pickPt, [z.lon, z.lat]) : Infinity;
  if(!z || best > NEAR) ZONES.forEach(zz => { const d = distM(pickPt, [zz.lon, zz.lat]); if(d < best){ best = d; z = zz; } });
  if(!z || best > NEAR){ msg("És a més de 5 km de qualsevol zona: de moment els sectors nous han de ser d'una zona existent.", true); return; }
  form = {kind: "sector", zone: z.id, lat: pickPt[1], lon: pickPt[0], type: "sector", az: null, name: ""};
  endPick(false); openForm();
});

/* ---------- formularis (sector nou i roca) ---------- */
function openRock(zoneId){ const z = ZONES.find(z => z.id === zoneId); if(!z) return; form = {kind: "roca", zone: z.id, rock: z.rock}; openForm(); }
function openForm(){ renderForm(); openPanel("pCom"); }
function renderForm(){
  const z = ZONES.find(z => z.id === form.zone), me = C() && C().uid();
  const lic = `<label class="ck"><input type="checkbox" id="cfLic"> Accepto que s'incorpori al catàleg de CEM sota la llicència oberta ODbL 1.0, i confirmo que ho conec per haver-hi estat o per observació pròpia (no copiat d'una guia protegida).</label>`;
  const how = `<p class="note">Es publica a l'instant com a <b>provisional</b>. Quan 2 persones la confirmin, quedarà confirmada; si 2 diuen que no és correcta, s'amagarà fins que la revisin.</p>`;
  let h = "";
  if(form.kind === "sector"){
    $("cfTitle").textContent = "Sector nou";
    h = `<p>Zona: <b>${esc(z.name)}</b> · <span class="num">${form.lat.toFixed(5)}, ${form.lon.toFixed(5)}</span></p>` +
      `<label>Nom (si en té)<input type="text" id="cfName" maxlength="80" value="${esc(form.name)}" placeholder="P. ex.: Paret del Dàlmata"></label>` +
      `<div><span class="fl">Tipus</span><div class="seg" role="group" aria-label="Tipus" id="cfKind">` +
      `<button type="button" data-k="sector" aria-pressed="${form.type === "sector"}">Sector</button><button type="button" data-k="bloc" aria-pressed="${form.type === "bloc"}">Bloc</button></div></div>` +
      `<div><span class="fl">Cap on mira la paret</span><div class="azfix" id="cfAz">` +
      CARD.map((c, k) => `<button type="button" data-az="${k * 45}" aria-pressed="${form.az === k * 45}">${c}</button>`).join("") +
      `<button type="button" data-az="" aria-pressed="${form.az == null}">No ho sé</button></div>` +
      `<p class="note">Decideix quan hi toca el sol. Si no ho saps, la nota de la zona no el tindrà en compte.</p></div>`;
  }else{
    $("cfTitle").textContent = "Tipus de roca";
    const now = z.rockCom ? (z.rockCom.estat === "confirmada" ? "comunitat" : "provisional") : z.rockGuess ? "suposada" : "catàleg";
    h = `<p>Zona: <b>${esc(z.name)}</b> · ara: <b>${ROCKS[z.rock].name}</b> (${now})</p>` +
      `<div class="seg wrap" role="group" aria-label="Roca" id="cfRock">` +
      Object.entries(ROCKS).map(([k, r]) => `<button type="button" data-r="${k}" aria-pressed="${form.rock === k}">${r.name}</button>`).join("") + `</div>` +
      `<p class="note">Canvia quant triga a eixugar-se després de la pluja i com li afecta la humitat.</p>`;
    if(z.rockCom && HIDDEN.has(z.rockCom.estat) && z.rockCom.per !== me) h += `<div class="amsg err">Aquesta zona té una correcció en revisió: espera que la revisin.</div>`;
  }
  $("cfBody").innerHTML = h + how + lic + `<div class="amsg" id="cfMsg" hidden></div><button class="btn pri" type="button" id="cfSend">Publica</button>`;
}
const cfSay = (t, err) => { const m = $("cfMsg"); if(!m) return; m.hidden = !t; m.textContent = t || ""; m.classList.toggle("err", !!err); };
$("cfBody").addEventListener("click", e => {
  const k = e.target.closest("#cfKind button[data-k]"); if(k){ form.type = k.dataset.k; keepName(); renderForm(); return; }
  const a = e.target.closest("#cfAz button[data-az]"); if(a){ form.az = a.dataset.az === "" ? null : +a.dataset.az; keepName(); renderForm(); return; }
  const r = e.target.closest("#cfRock button[data-r]"); if(r){ form.rock = r.dataset.r; renderForm(); return; }
  if(e.target.closest("#cfSend")) send();
});
function keepName(){ const n = $("cfName"); if(n) form.name = n.value; }
async function send(){
  keepName();
  if(!$("cfLic").checked){ cfSay("Per publicar cal acceptar la llicència.", true); return; }
  const z = ZONES.find(z => z.id === form.zone);
  if(form.kind === "roca" && form.rock === z.rock){ cfSay("És la mateixa roca que ja hi ha.", true); return; }
  const c = await C().need("Per publicar cal un compte (gratuït)."); if(!c){ return; }
  const {f, db, uid} = c; cfSay("Publicant…");
  try{
    const b = f.writeBatch(db), lim = c.bump(b); if(lim){ cfSay(lim, true); return; }
    const estat = c.est0(), base = {estat, conf: {}, reb: {}, per: uid, llicencia: LIC, act: f.serverTimestamp()};
    let local;
    if(form.kind === "sector"){
      const ref = f.doc(f.collection(db, "sectors"));
      const d = {zone: z.id, name: String(form.name || "").trim().slice(0, 80), lat: form.lat, lon: form.lon, kind: form.type, az: form.az};
      b.set(ref, Object.assign(d, base)); local = () => { SECS.push({id: ref.id, f: Object.assign({}, d, {estat, conf: {}, reb: {}, per: uid})}); store.set("cem_com_secs", SECS); selSector = "c_" + ref.id; };
    }else{
      const ref = f.doc(db, "roques", z.id), cur = await C().T(f.getDoc(ref)), o = cur.exists() ? cur.data() : null;
      if(o && HIDDEN.has(o.estat)){ cfSay("Aquesta zona té una correcció en revisió: espera que la revisin.", true); return; }
      const prev = o ? ((o.estat || "confirmada") === "confirmada" ? o.rock : o.prev ?? null) : null;
      const d = {zone: z.id, rock: form.rock, prev};
      b.set(ref, Object.assign(d, base));
      local = () => { ROCKC = ROCKC.filter(x => x.id !== z.id).concat({id: z.id, f: Object.assign({}, d, {estat, conf: {}, reb: {}, per: uid})}); store.set("cem_com_rocks", ROCKC); };
    }
    await C().T(b.commit()); c.done(); await c.markOdbl();
    local(); $("pCom").hidden = true; form = null;
    render(); openZone(z.id);
    msg(estat === "provisional" ? "Publicada com a provisional. Quan 2 persones la confirmin, quedarà confirmada." : estat === "pendent" ? "Enviada: la revisió la mirarà abans de publicar-la." : "Publicada i confirmada.");
    setTimeout(() => msg(null), 6000);
  }catch(e){ cfSay(C().errText(e), true); }
}

/* ---------- fitxa de la zona ---------- */
function rockHTML(z){
  const rc = z.rockCom, src = rc && !HIDDEN.has(rc.estat) ? "" : z.rockGuess ? " (suposada)" : "";
  return `<div class="crow"><span>Roca: <b>${ROCKS[z.rock].name}</b>${src}</span>` +
    (rc && rc.rock === z.rock ? voteHTML("roques", rc.id, rc) : "") +
    `<button class="btn sm" type="button" data-crock="${esc(z.id)}">Corregeix</button></div>`;
}
document.addEventListener("click", e => {
  const v = e.target.closest && e.target.closest("button[data-vote]"); if(v){ vote(v.dataset.col, v.dataset.id, v.dataset.vote === "ok"); return; }
  const r = e.target.closest && e.target.closest("button[data-crock]"); if(r){ openRock(r.dataset.crock); return; }
  const s = e.target.closest && e.target.closest("button[data-csec]"); if(s){ startPick(s.dataset.csec); return; }
  const q = e.target.closest && e.target.closest("button[data-crv]"); if(q) revAct(q.dataset.crv, +q.dataset.i, q);
});

/* ---------- revisió: el que la comunitat ha rebutjat i el de persones marcades ---------- */
const COLS = ["parets", "sectors", "orientacions", "roques"];
async function revLoad(){
  if(!C() || !C().isRev()) return;
  const c = await C().quiet(); if(!c) return;
  const {f, db} = c;
  try{
    const res = await Promise.all(COLS.map(col => C().T(f.getDocs(f.query(f.collection(db, col), f.where("estat", "in", ["revisio", "pendent"]))))
      .then(qs => qs.docs.map(d => ({col, id: d.id, d: d.data()})), () => [])));
    revQ = res.flat();
    for(const x of revQ) if(x.d.per && !(x.d.per in revNames))
      revNames[x.d.per] = await f.getDoc(f.doc(db, "usuaris", x.d.per)).then(d => d.exists() ? d.data().nom : "(compte esborrat)", () => "?");
  }catch(e){ revQ = []; }
  C().badges(); if(!$("pRevisio").hidden) C().renderRev();
}
function revDesc(x){
  const d = x.d, z = ZONES.find(z => z.id === d.zone), zn = z ? z.name : d.zone || "";
  if(x.col === "parets"){ let p = {}; try{ p = JSON.parse(d.d); }catch(e){}
    return `<b>Paret «${esc(d.name)}»</b> · ${esc(zn)} · mira al ${(p.segs || []).map(s => s.azAuto == null ? "?" : cardOf(s.azAuto)).join(", ")}`; }
  if(x.col === "sectors") return `<b>Sector nou${d.name ? " «" + esc(d.name) + "»" : ""}</b> · ${esc(zn)} · ${d.kind === "bloc" ? "bloc · " : ""}${d.az == null ? "orientació desconeguda" : "mira al " + cardOf(d.az)}`;
  if(x.col === "orientacions") return `<b>Orientació d'un sector</b> · ${esc(zn)} · ${d.prev != null ? "de " + cardOf(d.prev) + " a " : ""}<b>${cardOf(d.az)}</b>`;
  return `<b>Roca</b> · ${esc(zn)} · ${d.prev ? ROCKS[d.prev].name + " → " : ""}<b>${ROCKS[d.rock] ? ROCKS[d.rock].name : d.rock}</b>`;
}
function revRender(box){
  if(!revQ.length) return;
  const adm = C().isAdm();
  box.insertAdjacentHTML("beforeend", `<h3 class="rvh">Aportacions de la comunitat</h3>` + revQ.map((x, i) => {
    const why = x.d.estat === "revisio" ? `${Object.keys(x.d.reb || {}).length} persones diuen que no és correcta` : "persona marcada per revisar";
    const canPrev = (x.col === "orientacions" || x.col === "roques") && x.d.prev != null;
    return `<div class="rv"><div>${revDesc(x)}</div><div class="note">${why} · ${esc(revNames[x.d.per] || "")}</div>` +
      `<div class="row"><button class="btn" type="button" data-crv="map" data-i="${i}">Al mapa</button>` +
      (canPrev ? `<button class="btn" type="button" data-crv="prev" data-i="${i}">Torna a l'anterior</button>` : "") +
      `<button class="btn" type="button" data-crv="del" data-i="${i}">${canPrev || x.col === "orientacions" || x.col === "roques" ? "Treu-la" : "Esborra"}</button>` +
      `<button class="btn pri" type="button" data-crv="ok" data-i="${i}">És correcta</button></div>` +
      (adm && x.d.per ? `<button class="lnk" type="button" data-crv="flag" data-i="${i}">Revisa sempre les aportacions d'aquesta persona</button>` : "") +
      `<div id="crvDel${i}" hidden></div></div>`;
  }).join(""));
}
async function revAct(kind, i, btn){
  const x = revQ[i]; if(!x) return;
  const c = await C().quiet(); if(!c) return;
  const {f, db} = c, ref = f.doc(db, x.col, x.id);
  if(kind === "map") return revMap(x);
  if(kind === "del"){
    const box = $("crvDel" + i); box.hidden = false;
    // treure una orientació o una roca sense valor anterior = tornar a la d'OSM / del catàleg
    slideConfirm(box, x.col === "orientacions" || x.col === "roques" ? "Llisca per treure-la" : "Llisca per esborrar", async () => {
      try{ await C().T(f.deleteDoc(ref)); done("Fet."); }catch(e){ msg(C().errText(e), true); } });
    return;
  }
  try{
    if(kind === "ok") await C().T(f.updateDoc(ref, {estat: "confirmada", conf: {}, reb: {}}));
    if(kind === "prev") await C().T(f.updateDoc(ref, x.col === "roques" ? {rock: x.d.prev, prev: null, estat: "confirmada", conf: {}, reb: {}} : {az: x.d.prev, prev: null, estat: "confirmada", conf: {}, reb: {}}));
    if(kind === "flag"){ await C().T(f.updateDoc(f.doc(db, "usuaris", x.d.per), {revisar: true})); btn.textContent = "Marcada: les seves aportacions passaran per revisió."; btn.disabled = true; return; }
    done(kind === "ok" ? "Confirmada: ja la veu tothom." : "Restaurada l'anterior.");
  }catch(e){ msg(C().errText(e), true); }
}
function done(t){ msg(t); setTimeout(() => msg(null), 4000); revLoad(); refreshAll(); }
function revMap(x){
  const d = x.d; let pts = null, ctr = null;
  if(x.col === "parets"){ try{ pts = JSON.parse(d.d).pts; }catch(e){} }
  else if(x.col === "sectors") ctr = [d.lon, d.lat];
  else if(x.col === "orientacions"){ for(const z of ZONES){ const s = (z.sectors || []).find(s => s.id === d.sector); if(s){ ctr = [s.lon, s.lat]; break; } } }
  else { const z = ZONES.find(z => z.id === d.zone); if(z) ctr = [z.lon, z.lat]; }
  document.querySelectorAll(".panel").forEach(p => p.hidden = true);
  const feats = pts ? pts.map(c => ({type: "Feature", geometry: {type: "Point", coordinates: c}})).concat([{type: "Feature", geometry: {type: "LineString", coordinates: pts}}])
    : ctr ? [{type: "Feature", geometry: {type: "Point", coordinates: ctr}}] : [];
  map.getSource("draw") && map.getSource("draw").setData({type: "FeatureCollection", features: feats});
  if(pts){ const xs = pts.map(c => c[0]), ys = pts.map(c => c[1]); map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], {padding: 120, maxZoom: 17}); }
  else if(ctr) map.easeTo({center: ctr, zoom: x.col === "roques" ? 13 : 17});
  if(base !== "orto" && x.col !== "roques"){ base = "orto"; applyBase(); }
  msg("En groc, l'aportació en revisió. Torna a ⋮ ▸ Revisió per decidir.");
  setTimeout(() => { msg(null); if(!drawing && !pick && map.getSource("draw")) map.getSource("draw").setData({type: "FeatureCollection", features: []}); }, 20000);
}

window.CEM_COM = {voteHTML, rockHTML, revLoad, revRender, revCount: () => revQ.length, render, fetch: fetchCom};
apply();
fetchCom();
document.addEventListener("visibilitychange", () => { if(!document.hidden) fetchCom(); });
})();
