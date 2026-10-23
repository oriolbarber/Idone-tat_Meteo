"use strict";
/* ============ CEM · restriccions (comunitat) i risc d'incendi (Pla Alfa, Agents Rurals) ============
   Restriccions (col·lecció «restriccions», lectura pública per l'API REST):
   - Qualsevol persona registrada amb el correu confirmat n'afegeix una (nidificació, tancament o altre),
     amb dates (o «cada any»), el sector afectat (buit = tota la zona) i l'enllaç a la font oficial.
   - Queda «per confirmar» (es mostra en groc) fins que 2 persones més la confirmen.
   - Per retirar-la: algú ho proposa i 2 persones més ho confirmen. L'administració i els premium ho poden fer directament.
   - No canvia la nota meteo: es mostra al costat. Al rànquing, les confirmades de tota la zona van al final.
   Pla Alfa: servei públic ArcGIS dels Agents Rurals (avui i demà, per municipi) i tancaments d'espais naturals.
   Només per a zones de Catalunya. Nivell 4 = accés restringit a espais naturals. */
(() => {
const PID = "cem-meteo", KEY = "AIzaSyCHZXN2YU9Eotz0PnWrHgmVrgFvzc_4mic";
const NEED = 2;                                   // confirmacions d'altres persones
const TTL = 30 * 60e3;                            // cada quan es tornen a llegir
const AR = "https://services7.arcgis.com/ZCqVt1fRXwwK6GF4/arcgis/rest/services/";
const ALFA_L = {avui: AR + "Pla_Alfa_Municipal_Avui_FL_2_view/FeatureServer/0", dema: AR + "pla_alfa_municipal_dema_FL_VW/FeatureServer/5"};
const TANC_L = {avui: AR + "tancaments_pla_alfa_avui_VW/FeatureServer/2", dema: AR + "tancaments_pla_alfa_dema_VW/FeatureServer/2"};
const CAT_BOX = [0.15, 40.5, 3.35, 42.9];         // Catalunya (aprox.)
const TIPUS = {niu:{t:"Nidificació", ic:"🐦"}, tanc:{t:"Tancament", ic:"⛔"}, altre:{t:"Altres", ic:"⚠️"}};
const ALFA_TXT = ["Risc baix", "Risc moderat", "Risc alt", "Risc molt alt", "Risc extrem"];

let R = store.get("cem_restr", []);              // restriccions (no retirades)
let ALFA = store.get("cem_alfa", null);          // {at, dies:{avui:"AAAA-MM-DD", dema}, lv:{avui:{muni:n}, dema}, tanc:{avui:[zoneId], dema}}
let MUNI = store.get("cem_muni", {});            // zona → codi de municipi (no canvia)
let formZone = null;

/* ---------- dates ---------- */
// Una restricció és activa un dia (AAAA-MM-DD). «Cada any»: compara MM-DD (també si passa de cap d'any).
function activeOn(r, k){
  if(r.cadaAny){ const md = k.slice(5); return r.des <= r.fins ? md >= r.des && md <= r.fins : md >= r.des || md <= r.fins; }
  return k >= r.des && k <= r.fins;
}
const fmtD = (d, any) => { const [y, m, dd] = any ? ["", ...d.split("-")] : d.split("-"); return `${+dd} ${MONTHS[+m - 1]}${any ? "" : " " + y}`; };
const rangeTxt = r => `${r.cadaAny ? "Cada any, " : ""}del ${fmtD(r.des, r.cadaAny)} al ${fmtD(r.fins, r.cadaAny)}`;
const confN = r => Object.keys(r.conf || {}).length, retN = r => Object.keys(r.ret || {}).length;

/* ---------- lectura pública (REST) ---------- */
function decode(v){
  if(v == null) return null;
  if("stringValue" in v) return v.stringValue;
  if("booleanValue" in v) return v.booleanValue;
  if("integerValue" in v) return +v.integerValue;
  if("doubleValue" in v) return v.doubleValue;
  if("timestampValue" in v) return v.timestampValue;
  if("nullValue" in v) return null;
  if("mapValue" in v){ const o = {}; Object.entries(v.mapValue.fields || {}).forEach(([k, x]) => o[k] = decode(x)); return o; }
  if("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  return null;
}
async function fetchRestr(force){
  if(!force && Date.now() - store.get("cem_restr_at", 0) < TTL) return;
  const base = `https://firestore.googleapis.com/v1/projects/${PID}/databases/(default)/documents/restriccions?pageSize=300&key=${KEY}`;
  const out = []; let tok = "";
  try{
    do{
      const r = await fetch(base + (tok ? "&pageToken=" + encodeURIComponent(tok) : "")); if(!r.ok) throw 0;
      const j = await r.json();
      (j.documents || []).forEach(d => { const o = {id: d.name.split("/").pop()}; Object.entries(d.fields || {}).forEach(([k, v]) => o[k] = decode(v)); if(o.estat !== "retirada") out.push(o); });
      tok = j.nextPageToken || "";
    }while(tok);
    R = out; store.set("cem_restr", R); store.set("cem_restr_at", Date.now()); refresh();
  }catch(e){}
}

/* ---------- Pla Alfa ---------- */
const inCat = z => z.lon >= CAT_BOX[0] && z.lon <= CAT_BOX[2] && z.lat >= CAT_BOX[1] && z.lat <= CAT_BOX[3];
const q = (layer, params) => fetch(layer + "/query?" + new URLSearchParams({f:"json", ...params})).then(r => r.ok ? r.json() : Promise.reject()).then(j => j.error ? Promise.reject(j.error) : j);
const ptQ = z => ({geometry:`${z.lon},${z.lat}`, geometryType:"esriGeometryPoint", inSR:"4326", spatialRel:"esriSpatialRelIntersects", returnGeometry:"false"});
async function fetchAlfa(force){
  const today = localOf(Date.now()).key;
  if(!force && ALFA && ALFA.dies.avui === today && Date.now() - ALFA.at < TTL) return;
  const zs = ZONES.filter(inCat); if(!zs.length) return;
  try{
    // municipi de cada zona (un cop per zona; es desa)
    for(const z of zs) if(!MUNI[z.id]){
      const j = await q(ALFA_L.avui, {...ptQ(z), outFields:"CODIMUNI,NOMMUNI"});
      const a = j.features && j.features[0] && j.features[0].attributes; if(a) MUNI[z.id] = {c:a.CODIMUNI, n:a.NOMMUNI};
    }
    store.set("cem_muni", MUNI);
    const lv = {}, tanc = {};
    for(const d of ["avui", "dema"]){
      const j = await q(ALFA_L[d], {where:"PERIL_M>0", outFields:"CODIMUNI,PERIL_M", returnGeometry:"false"});
      lv[d] = {}; (j.features || []).forEach(f => lv[d][f.attributes.CODIMUNI] = f.attributes.PERIL_M);
      // tancaments d'espais naturals: només es consulta zona per zona si n'hi ha algun
      tanc[d] = [];
      const c = await q(TANC_L[d], {where:"1=1", returnCountOnly:"true"});
      if(c.count > 0) for(const z of zs){ const t = await q(TANC_L[d], {...ptQ(z), returnCountOnly:"true"}); if(t.count > 0) tanc[d].push(z.id); }
    }
    const dema = new Date(Date.parse(today + "T12:00:00") + 86400e3);
    ALFA = {at: Date.now(), dies:{avui: today, dema: `${dema.getFullYear()}-${pad(dema.getMonth() + 1)}-${pad(dema.getDate())}`}, lv, tanc};
    store.set("cem_alfa", ALFA); refresh();
  }catch(e){ /* sense connexió o servei canviat: queda l'últim desat */ }
}
// Pla Alfa d'una zona per a un dia (només avui i demà)
function alfaOf(z, k){
  if(!ALFA || !inCat(z)) return null;
  const d = k === ALFA.dies.avui ? "avui" : k === ALFA.dies.dema ? "dema" : null; if(!d) return null;
  const m = MUNI[z.id]; const lv = m ? (ALFA.lv[d][m.c] || 0) : 0;
  return {d, lv, tanc: ALFA.tanc[d].includes(z.id), muni: m ? m.n : ""};
}

/* ---------- indicadors per a app.js ---------- */
// Estat d'una zona per als dies triats: icona per al marcador, si va al final del rànquing i el text curt
function flags(z){
  const rs = R.filter(r => r.zone === z.id && selDays.some(k => activeOn(r, k)));
  const conf = rs.filter(r => r.estat === "confirmada"), pend = rs.filter(r => r.estat !== "confirmada");
  const al = selDays.map(k => alfaOf(z, k)).filter(Boolean);
  const closed = al.some(a => a.tanc || a.lv >= 4), fire3 = al.some(a => a.lv === 3);
  const full = closed || conf.some(r => !r.sector);
  const ic = closed ? "⛔" : conf.length ? TIPUS[conf[0].tipus]?.ic || "⚠️" : fire3 ? "🔥" : pend.length ? "❔" : "";
  const txt = closed ? "Accés restringit (Pla Alfa)" : conf.length ? TIPUS[conf[0].tipus].t + (conf[0].sector ? " (part de la zona)" : "") : fire3 ? "Risc d'incendi molt alt" : pend.length ? "Restricció per confirmar" : "";
  return {ic, full, txt, pend: !conf.length && !closed && pend.length > 0};
}

/* ---------- fitxa de la zona ---------- */
function sheetHTML(z){
  const me = window.CEM_CLOUD && CEM_CLOUD.uid(), rev = window.CEM_CLOUD && CEM_CLOUD.isRev();
  let h = `<div class="rsec"><div class="rh"><b>Restriccions i accés</b><button class="btn sm" type="button" data-radd="${z.id}">+ Afegeix</button></div>`;
  // Pla Alfa
  if(inCat(z)){
    const al = selDays.map(k => [k, alfaOf(z, k)]).filter(x => x[1]);
    if(al.length) h += al.map(([k, a]) => `<div class="rrow ${a.tanc || a.lv >= 4 ? "no" : a.lv === 3 ? "mid" : ""}"><span>${a.tanc || a.lv >= 4 ? "⛔" : "🔥"}</span>` +
      `<span><b>${esc(dayLbl(k, true))}: Pla Alfa nivell ${a.lv}</b> · ${ALFA_TXT[a.lv] || ""}${a.muni ? " a " + esc(a.muni) : ""}` +
      (a.tanc ? ". <b>Espai natural tancat.</b>" : a.lv >= 4 ? ". Pot estar restringit l'accés als espais naturals." : a.lv === 3 ? ". Prohibit fer foc i fer servir màquines que facin espurnes a prop del bosc." : "") + `</span></div>`).join("");
    else h += `<p class="note">Risc d'incendi (Pla Alfa): ${ALFA ? "només es publica per avui i demà." : "sense dades ara (cal connexió)."}</p>`;
  }
  // restriccions de la comunitat (totes les no retirades, actives o no els dies triats)
  const rs = R.filter(r => r.zone === z.id).sort((a, b) => (selDays.some(k => activeOn(b, k)) - selDays.some(k => activeOn(a, k))));
  if(!rs.length) h += `<p class="note">Cap restricció coneguda. Si n'hi ha alguna (nidificació, tancament…), afegeix-la amb l'enllaç a la font oficial.</p>`;
  rs.forEach(r => {
    const act = selDays.some(k => activeOn(r, k)), c = confN(r), rt = retN(r), mine = me && r.creatPer === me;
    const st = r.retPer ? `Retirada proposada · ${rt}/${NEED} confirmacions` : r.estat === "confirmada" ? "Confirmada" : `Per confirmar · ${c}/${NEED}`;
    h += `<div class="rrow ${r.estat === "confirmada" && act ? "no" : "mid"}${act ? "" : " off"}"><span>${TIPUS[r.tipus]?.ic || "⚠️"}</span><span>` +
      `<b>${TIPUS[r.tipus]?.t || "Restricció"}${r.sector ? ": " + esc(r.sector) : ": tota la zona"}</b> · ${rangeTxt(r)}${act ? "" : " (no afecta els dies triats)"}` +
      (r.desc ? `<br>${esc(r.desc)}` : "") + (r.font ? `<br><span class="muted">Font: ${esc(r.font.replace(/^https?:\/\//, "").slice(0, 60))}</span> <button class="lnk" type="button" data-rcopy="${esc(r.font)}">copia l'enllaç</button>` : "") +
      `<br><span class="rst ${r.estat === "confirmada" && !r.retPer ? "ok" : "mid"}">${st}</span></span><span class="racts">`;
    if(r.retPer){
      if(me && me !== r.retPer && !(r.ret || {})[me]) h += `<button class="btn sm" type="button" data-r="ret" data-id="${r.id}">Confirmo que es retira</button>`;
      if(me && (me === r.retPer || rev)) h += `<button class="btn sm" type="button" data-r="keep" data-id="${r.id}">Es manté</button>`;
    }else{
      if(r.estat !== "confirmada" && !mine && !(r.conf || {})[me || "-"]) h += `<button class="btn sm pri" type="button" data-r="conf" data-id="${r.id}">Confirmo</button>`;
      if(r.estat === "confirmada" || !mine) h += `<button class="btn sm" type="button" data-r="retp" data-id="${r.id}">Ja no és vigent</button>`;
      if(mine && r.estat !== "confirmada") h += `<button class="btn sm" type="button" data-r="del" data-id="${r.id}">Retira-la</button>`;
    }
    if(rev) h += `<button class="btn sm" type="button" data-r="admin" data-id="${r.id}">Admin</button>`;
    h += `</span></div>`;
  });
  return h + `</div>`;
}

/* ---------- accions ---------- */
async function act(kind, id){
  const r = R.find(r => r.id === id); if(!r) return;
  const c = await CEM_CLOUD.need("Per confirmar o retirar restriccions cal un compte (gratuït)."); if(!c) return;
  const {f, db, uid} = c, ref = f.doc(db, "restriccions", id);
  try{
    if(kind === "conf"){
      const n = confN(r) + 1, upd = {["conf." + uid]: true, act: f.serverTimestamp()};
      if(n >= NEED) upd.estat = "confirmada";
      await f.updateDoc(ref, upd);
      msg(n >= NEED ? "Confirmada: ara compta per a tothom." : `Gràcies. Falta${NEED - n > 1 ? "en" : ""} ${NEED - n} confirmaci${NEED - n > 1 ? "ons" : "ó"} més.`);
    }else if(kind === "retp"){
      await f.updateDoc(ref, {retPer: uid, ret: {}, act: f.serverTimestamp()});
      msg(`Retirada proposada. Cal que ${NEED} persones més ho confirmin.`);
    }else if(kind === "ret"){
      const n = retN(r) + 1, upd = {["ret." + uid]: true, act: f.serverTimestamp()};
      if(n >= NEED) upd.estat = "retirada";
      await f.updateDoc(ref, upd);
      msg(n >= NEED ? "Retirada: ja no es mostra." : "Gràcies. Encara falta alguna confirmació.");
    }else if(kind === "keep"){
      await f.updateDoc(ref, {retPer: f.deleteField(), ret: f.deleteField(), act: f.serverTimestamp()});
      msg("La restricció es manté.");
    }else if(kind === "del"){
      await f.deleteDoc(ref); msg("Restricció retirada.");
    }else if(kind === "admin"){
      const v = prompt("Administració: escriu «c» per confirmar-la, «r» per retirar-la o «e» per esborrar-la.", "");
      if(v === "c") await f.updateDoc(ref, {estat:"confirmada", retPer: f.deleteField(), ret: f.deleteField(), act: f.serverTimestamp()});
      else if(v === "r") await f.updateDoc(ref, {estat:"retirada", act: f.serverTimestamp()});
      else if(v === "e") await f.deleteDoc(ref);
      else return;
      msg("Fet.");
    }
    setTimeout(() => msg(null), 5000);
    await fetchRestr(true);
  }catch(e){ msg(CEM_CLOUD.errText(e), true); }
}

/* ---------- formulari ---------- */
async function openForm(zoneId){
  const c = await CEM_CLOUD.need("Per afegir restriccions cal un compte (gratuït)."); if(!c) return;
  formZone = ZONES.find(z => z.id === zoneId); if(!formZone) return;
  const y = new Date().getFullYear();
  $("rfZone").textContent = formZone.name;
  $("rfDes").value = `${y}-01-01`; $("rfFins").value = `${y}-07-31`; $("rfAny").checked = true;
  $("rfSector").value = ""; $("rfDesc").value = ""; $("rfFont").value = "";
  document.querySelectorAll("#rfTipus button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.t === "niu")));
  $("rfLicRow").hidden = c.odbl; $("rfLic").checked = c.odbl;
  $("rfMsg").hidden = true;
  openPanel("pRestr");
}
async function sendForm(){
  const say = (t, err) => { const m = $("rfMsg"); m.textContent = t; m.hidden = !t; m.classList.toggle("err", !!err); };
  const tipus = document.querySelector('#rfTipus button[aria-pressed="true"]')?.dataset.t || "niu";
  const any = $("rfAny").checked, d1 = $("rfDes").value, d2 = $("rfFins").value;
  const font = $("rfFont").value.trim(), sector = $("rfSector").value.trim().replace(/\s+/g, " ").slice(0, 120), desc = $("rfDesc").value.trim().slice(0, 300);
  if(!d1 || !d2){ say("Posa les dues dates.", true); return; }
  if(!any && d2 < d1){ say("La data final és anterior a la inicial.", true); return; }
  if(font && !/^https?:\/\/\S+\.\S+/.test(font)){ say("L'enllaç de la font ha de començar per https://", true); return; }
  if(!$("rfLic").checked){ say("Cal acceptar la llicència per afegir-la.", true); return; }
  const c = await CEM_CLOUD.need(); if(!c) return;
  const {f, db, uid} = c;
  say("Enviant…");
  try{
    await f.addDoc(f.collection(db, "restriccions"), {zone: formZone.id, tipus, cadaAny: any, des: any ? d1.slice(5) : d1, fins: any ? d2.slice(5) : d2,
      sector, desc, font: font.slice(0, 300), estat:"pendent", conf:{}, creatPer: uid, llicencia:"ODbL-1.0", creat: f.serverTimestamp(), act: f.serverTimestamp()});
    await c.markOdbl();
    $("pRestr").hidden = true; msg(`Restricció afegida. Es mostra «per confirmar» fins que ${NEED} persones més la confirmin.`); setTimeout(() => msg(null), 6000);
    await fetchRestr(true);
  }catch(e){ say(CEM_CLOUD.errText(e), true); }
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-radd],[data-r],[data-rcopy],#rfTipus button,#rfSend"); if(!t) return;
  if(t.dataset.radd) openForm(t.dataset.radd);
  else if(t.dataset.r) act(t.dataset.r, t.dataset.id);
  else if(t.dataset.rcopy){ (navigator.clipboard ? navigator.clipboard.writeText(t.dataset.rcopy) : Promise.reject()).then(() => msg("Enllaç copiat: enganxa'l al navegador."), () => msg(t.dataset.rcopy)); setTimeout(() => msg(null), 4000); }
  else if(t.id === "rfSend") sendForm();
  else document.querySelectorAll("#rfTipus button").forEach(b => b.setAttribute("aria-pressed", String(b === t)));
});

function refresh(){ if(typeof renderAll === "function") renderAll(); }
window.CEM_R = {flags, sheetHTML, refresh: () => { fetchRestr(true); fetchAlfa(true); }};
fetchRestr(); fetchAlfa();
document.addEventListener("visibilitychange", () => { if(!document.hidden){ fetchRestr(); fetchAlfa(); } });
})();
