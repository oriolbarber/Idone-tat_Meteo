/* ============ CEM · Idoneïtat per escalar (V1) ============ */
// PWA sense comptes ni servidor. Mapa de l'ICGC amb MapLibre, previsió d'Open-Meteo i veredicte per zona i paret.
"use strict";

/* ---------- utilitats ---------- */
const $ = id => document.getElementById(id);
const store = {
  get(k, d = null){ try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2, "0");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const RAD = Math.PI / 180;
const TZ = "Europe/Madrid";
const DOW = ["dg.","dl.","dt.","dc.","dj.","dv.","ds."];
const MONTHS = ["gen.","febr.","març","abr.","maig","juny","jul.","ag.","set.","oct.","nov.","des."];
const CARD = ["N","NE","E","SE","S","SO","O","NO"];
const cardOf = az => CARD[Math.round(((az % 360) + 360) % 360 / 45) % 8];
// data local (Europe/Madrid) d'un instant: {key:"AAAA-MM-DD", h:0–23}
const fmtTZ = new Intl.DateTimeFormat("en-CA", {timeZone:TZ, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", hourCycle:"h23"});
function localOf(ms){
  const p = {}; fmtTZ.formatToParts(new Date(ms)).forEach(x => p[x.type] = x.value);
  return {key:`${p.year}-${p.month}-${p.day}`, h:+p.hour};
}

/* ---------- preferències ---------- */
let mod   = store.get("cem_mod", "esportiva");             // modalitat
let role  = store.get("cem_role", "climb");                // confort per a: climb (escalant) | belay (assegurant)
let clo   = store.get("cem_clo", 1);                       // roba: 0.5 lleugera · 1 normal · 1.6 d'abric
let slot  = store.get("cem_slot", null);                   // franja: am | pm (null = automàtica)
let base  = store.get("cem_base", "topo");
let ly    = Object.assign({slope:false, radar:false, wind:true, walls:true}, store.get("cem_ly", {}));
let t3d   = store.get("cem_3d", false);
const CRIT_DEF = {
  esportiva:{gustMid:45, gustMax:60},
  classica: {gustMid:30, gustMax:45},
  comfLo:10, comfHi:24          // franja de sensació còmoda (°C)
};
let crit = Object.assign(structuredClone(CRIT_DEF), store.get("cem_crit", {}));
let userWalls = store.get("cem_walls", []);               // parets traçades en aquest mòbil (w.prop = estat de la proposta)
let cloudWalls = store.get("cem_cloud_walls", []);        // parets aprovades per a tothom (col·lecció «parets», les porta cloud.js)
let azFix = store.get("cem_azfix", {});                   // correcció manual: {"paretId:tram": az}
let dayKey = null;                                        // dia enfocat (AAAA-MM-DD): el que es mostra en detall
let selDays = store.get("cem_days", []);                  // dies de la sortida (un o diversos, no cal que siguin seguits)
let selZone = null;                                       // zona oberta a la fitxa
let DATA = null;                                          // previsió: {zoneId: {t:[ms], key:[…], h:[…], …}, sun:{zoneId:{key:{rise,set}}}}

/* ---------- posició del sol (fórmules de SunCalc) ---------- */
function sunPos(ms, lat, lon){
  const d = ms / 86400000 - 0.5 + 2440588 - 2451545;
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI, e = RAD * 23.4397;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)), ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const H = RAD * (280.16 + 360.9856235 * d) + RAD * lon - ra, phi = RAD * lat;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return {alt: alt / RAD, az: (az / RAD + 180 + 360) % 360};   // az: 0 = N, en sentit horari
}

/* ---------- parets ---------- */
// Totes les parets d'una zona: les del catàleg i les traçades en aquest mòbil
// Una paret pròpia ja aprovada no es repeteix: queda la versió de tothom
function wallsOf(z){
  const pub = cloudWalls.filter(w => w.zone === z.id), ids = new Set(pub.map(w => w.id));
  return z.walls.concat(pub, userWalls.filter(w => w.zone === z.id && !(w.prop && ids.has(w.prop.id))));
}
// Estat d'una paret per a l'etiqueta: tothom | pendent | rebutjada | mòbil
function wallState(w){
  if(cloudWalls.includes(w) || w.src === "cataleg") return {k:"pub", t:"Aprovada · per a tothom"};
  if(w.prop && w.prop.estat === "pendent") return {k:"pend", t:"Proposta pendent de revisió"};
  if(w.prop && w.prop.estat === "rebutjada") return {k:"rej", t:"Rebutjada" + (w.prop.motiu ? ": " + w.prop.motiu : "")};
  return {k:"mob", t:"Només en aquest mòbil"};
}
function wallTag(w){
  const st = wallState(w), cls = {pub:"ok", pend:"mid", rej:"no", mob:"na"}[st.k];
  return `<span class="wtag lv-${cls}">${esc(st.t)}</span>` +
    ((st.k === "mob" || st.k === "rej") && userWalls.includes(w) ? `<button class="btn sm" type="button" data-propose="${w.id}">Proposa-la</button>` : "");
}
function segAz(w, i){ const f = azFix[w.id + ":" + i]; return f != null ? f : w.segs[i].azAuto; }
// horitzó (graus) cap a l'azimut a; sense dades = 0
function hzAt(hz, a){ if(!hz || !hz.length) return 0; const i = Math.round(((a % 360) + 360) % 360 / 5) % hz.length; return hz[i] || 0; }

/* ---------- dades: Open-Meteo ---------- */
const HV = ["temperature_2m","relative_humidity_2m","dew_point_2m","precipitation","precipitation_probability","weather_code",
  "wind_speed_10m","wind_gusts_10m","wind_direction_10m","shortwave_radiation_instant","direct_normal_irradiance_instant",
  "diffuse_radiation_instant","cape"];
const SHORT = {temperature_2m:"T", relative_humidity_2m:"RH", dew_point_2m:"Td", precipitation:"P", precipitation_probability:"PP",
  weather_code:"WC", wind_speed_10m:"W", wind_gusts_10m:"G", wind_direction_10m:"WD", shortwave_radiation_instant:"GHI",
  direct_normal_irradiance_instant:"DNI", diffuse_radiation_instant:"DIF", cape:"CAPE"};
function omURL(){
  return "https://api.open-meteo.com/v1/forecast?latitude=" + ZONES.map(z => z.lat).join(",") +
    "&longitude=" + ZONES.map(z => z.lon).join(",") + "&elevation=" + ZONES.map(z => z.alt).join(",") +
    "&hourly=" + HV.join(",") + "&daily=sunrise,sunset&timeformat=unixtime&timezone=" + encodeURIComponent(TZ) +
    "&past_days=3&forecast_days=16&wind_speed_unit=kmh";
}
function parseOM(arr){
  if(!Array.isArray(arr)) arr = [arr];
  const out = {zones:{}, at:Date.now()};
  arr.forEach((r, i) => {
    const z = ZONES[i], H = r.hourly, o = {t: H.time.map(s => s * 1000)};
    o.loc = o.t.map(localOf);
    HV.forEach(k => o[SHORT[k]] = H[k] || []);
    o.sun = {};
    r.daily.time.forEach((s, j) => { o.sun[localOf(s * 1000 + 12 * 3600e3).key] = {rise: r.daily.sunrise[j] * 1000, set: r.daily.sunset[j] * 1000}; });
    out.zones[z.id] = o;
  });
  return out;
}
async function load(){
  msg("Carregant la previsió…");
  try{
    const r = await fetch(omURL());
    if(!r.ok) throw new Error("HTTP " + r.status);
    DATA = parseOM(await r.json());
    store.set("cem_fc", DATA);
    msg(null);
  }catch(e){
    const old = store.get("cem_fc");
    if(old && old.zones && ZONES.every(z => old.zones[z.id])){
      DATA = old;
      msg("Sense connexió: previsió de fa " + ago(old.at) + ".", true);
    }else{ msg("No s'ha pogut carregar la previsió. Torna-ho a provar amb connexió.", true); return; }
  }
  const av = daysAvail();
  selDays = selDays.filter(k => av.includes(k));
  if(!selDays.length) selDays = [localOf(Date.now()).key];
  if(!dayKey || !selDays.includes(dayKey)) dayKey = selDays[0];
  if(!slot) slot = "dia";
  renderAll();
}
function ago(ms){ const m = Math.round((Date.now() - ms) / 60000); return m < 60 ? m + " min" : m < 1440 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " dies"; }
function daysAvail(){
  if(!DATA) return [];
  const o = DATA.zones[ZONES[0].id], today = localOf(Date.now()).key, s = new Set();
  o.loc.forEach(l => { if(l.key >= today) s.add(l.key); });
  return [...s].sort();
}

/* ---------- model: secat, confort, adherència i veredicte ---------- */
// Radiació sobre la paret (W/m²). az = cap on mira; null = mitjana de la zona (sense paret coneguda).
function wallRad(o, i, z, az, hz){
  const sp = sunPos(o.t[i], z.lat, z.lon), dni = o.DNI[i] || 0, dif = o.DIF[i] || 0, ghi = o.GHI[i] || 0;
  const one = a => {
    const inc = Math.cos(sp.alt * RAD) * Math.cos((sp.az - a) * RAD);
    const lit = sp.alt > 0 && inc > 0 && sp.alt > hzAt(hz, sp.az);
    return {I: (lit ? dni * inc : 0) + dif * 0.5 + ghi * 0.1, lit};
  };
  if(az == null){ const r = [0, 90, 180, 270].map(one); return {I: r.reduce((s, x) => s + x.I, 0) / 4, lit: null, sp}; }
  return Object.assign(one(az), {sp});
}
// Sensació tèrmica (°C): temperatura aparent de Steadman amb radiació, corregida per activitat i roba
function feelT(T, RH, wms, Q){
  const e = RH / 100 * 6.105 * Math.exp(17.27 * T / (237.7 + T));
  let at = T + 0.348 * e - 0.70 * wms + 0.70 * Q / (wms + 10) - 4.25;
  if(role === "climb") at += 4;
  return at + (clo - 1) * 7;
}
const isStorm = (o, i) => (o.WC[i] >= 95) || ((o.CAPE[i] || 0) >= 1000 && (o.PP[i] || 0) >= 40);

// Avalua totes les hores d'una zona per a una orientació (az, hz, exposició). Retorna una fila per hora.
function evalSeries(z, az, hz, exp){
  const o = DATA.zones[z.id], R = ROCKS[z.rock], wf = exp === "arrecerat" ? 0.5 : exp === "exposat" ? 1 : 0.8;
  const C = crit[mod];
  let W = 0, lastWet = null;
  return o.t.map((t, i) => {
    const T = o.T[i], RH = o.RH[i], Td = o.Td[i], P = o.P[i] || 0, PP = o.PP[i] ?? 0;
    const wms = (o.W[i] || 0) / 3.6 * wf, gust = (o.G[i] || 0) * (exp === "arrecerat" ? 0.7 : 1);
    const wr = wallRad(o, i, z, az, hz);
    // secat de la roca: aigua retinguda (mm equivalents) que entra amb la pluja i surt amb sol, vent i aire sec
    W = Math.min(R.cap, W + P * 0.6);
    const evap = R.dry * (0.05 + 0.0008 * wr.I + 0.02 * wms) * Math.max(0.1, 1 - RH / 100) * 2;
    W = Math.max(0, W - evap);
    if(W > 0.3) lastWet = t;
    // persona al peu de la paret: al sol si el sol toca la paret
    // lit = el sol toca la paret (geometria i horitzó); sunny = a més, no està tapat pels núvols
    const lit = wr.lit;
    const sunny = (lit == null ? wr.sp.alt > 0 : lit) && (o.DNI[i] || 0) > 120;
    const Q = sunny ? 0.7 * (0.25 * (o.DNI[i] || 0) + 0.5 * (o.DIF[i] || 0)) + 0.09 * wr.I : 0.21 * (o.DIF[i] || 0);
    const feel = feelT(T, RH, wms, wr.lit == null ? Q * 0.6 : Q);
    const Trock = T + 0.022 * wr.I;
    // puntuació
    const pen = []; let block = null;
    const add = (p, why) => pen.push({p, why});
    if(P >= 0.3) block = "Pluja";
    else if(isStorm(o, i)) block = "Tempesta";
    else if(W > 0.3) block = "Roca molla";
    if(W > 0.05 && W <= 0.3) add(2.5, "Roca humida");
    if(PP >= 60) add(4, "Probable pluja"); else if(PP >= 30) add(2, "Risc de pluja");
    if((o.CAPE[i] || 0) >= 600 && PP >= 20) add(2, "Risc de tempesta");
    const lo = crit.comfLo, hi = crit.comfHi;
    if(feel < lo - 6) add(3.5, "Molt fred"); else if(feel < lo) add(1.5, "Fred");
    if(feel > hi + 6) add(3.5, "Molta calor"); else if(feel > hi) add(1.5, "Calor");
    if(Trock > 32) add(2.5, "Roca calenta"); else if(Trock > 24) add(1, "Roca tèbia");
    if(Trock < 0) add(1.5, "Roca gelada");
    const sweat = Trock - Td < 2 || RH * R.hum > 88;
    if(sweat) add(2, "La roca sua"); else if(RH * R.hum > 75) add(0.8, "Humitat alta");
    if(gust > C.gustMax){ if(mod === "classica") block = block || "Vent fort"; else add(4, "Vent fort"); }
    else if(gust > C.gustMid) add(1.5, "Vent");
    pen.sort((a, b) => b.p - a.p);
    let sc = clamp(10 - pen.reduce((s, x) => s + x.p, 0), 0, 10);
    if(block) sc = Math.min(sc, 2);
    return {t, loc:o.loc[i], sc, block, pen, feel, T, RH, Td, P, PP, gust, wkmh:o.W[i] || 0, wd:o.WD[i], lit, sunny, W, lastWet, Trock, I:wr.I, sp:wr.sp};
  });
}
const lvOf = (sc, block) => block ? "no" : sc >= 7 ? "ok" : sc >= 4 ? "mid" : "no";
const LV_TXT = {ok:"Recomanat", mid:"Amb limitacions", no:"No recomanat", na:"Sense dades"};
const SLOT_H = {am:[8, 13], pm:[14, 19]};
// Veredicte d'una franja (matí o tarda) del dia triat, només amb hores de llum
function slotVerdict(rows, o, key, s){
  const sun = o.sun[key], [h0, h1] = SLOT_H[s];
  const rs = rows.filter(r => r.loc.key === key && r.loc.h >= h0 && r.loc.h <= h1 && (!sun || (r.t >= sun.rise - 1800e3 && r.t <= sun.set)));
  if(!rs.length) return {lv:"na", sc:null, why:"Fora d'hores de llum", rows:[]};
  const bl = rs.find(r => r.block);
  const sc = rs.reduce((a, r) => a + r.sc, 0) / rs.length;
  const cnt = {}; rs.forEach(r => r.pen.slice(0, 2).forEach(p => cnt[p.why] = (cnt[p.why] || 0) + p.p));
  const why = bl ? bl.block + (bl.block === "Roca molla" ? "" : " a les " + bl.loc.h + " h")
    : sc >= 8 ? "Bones condicions" : Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).join(" · ") || "Bones condicions";
  return {lv: lvOf(sc, bl), sc: bl ? Math.min(sc, 2) : sc, why, rows: rs, block: bl ? bl.block : null};
}

// Avaluació completa d'una zona: zona sencera o la millor paret
const cache = new Map();
function zoneEval(z){
  const k = [z.id, mod, role, clo, JSON.stringify(crit), JSON.stringify(azFix), userWalls.length, DATA.at].join("|");
  if(cache.has(k)) return cache.get(k);
  const ws = wallsOf(z), o = DATA.zones[z.id];
  const targets = ws.length ? ws.flatMap(w => w.segs.map((s, i) => ({w, i, az: segAz(w, i), hz: s.hz}))).filter(x => x.az != null) : [];
  const zoneRows = evalSeries(z, null, null, null);
  const segs = targets.map(x => ({...x, rows: evalSeries(z, x.az, x.hz, x.w.exp)}));
  const r = {z, o, zoneRows, segs};
  cache.set(k, r); return r;
}
// Veredicte per al dia i franja: la millor paret si n'hi ha, si no la zona
function zoneSlot(ev, key, s){
  const zs = slotVerdict(ev.zoneRows, ev.o, key, s);
  if(!ev.segs.length) return {...zs, seg:null};
  let best = null;
  ev.segs.forEach(sg => { const v = slotVerdict(sg.rows, ev.o, key, s); if(v.sc != null && (!best || v.sc > best.sc)) best = {...v, seg: sg}; });
  return best || {...zs, seg:null};
}

// Franja: am | pm | dia. «Tot el dia» = mitjana de matí i tarda; si una franja està bloquejada, el dia no pot ser verd.
function frSlot(ev, key, s = slot){
  if(s !== "dia") return zoneSlot(ev, key, s);
  const a = zoneSlot(ev, key, "am"), p = zoneSlot(ev, key, "pm"), vs = [a, p].filter(v => v.sc != null);
  if(!vs.length) return {...a, lv:"na", sc:null, why:"Fora d'hores de llum", rows:[]};
  const sc = vs.reduce((t, v) => t + v.sc, 0) / vs.length, block = a.block || p.block;
  const lv = block ? (sc >= 4 ? "mid" : "no") : lvOf(sc, null);
  let why = vs.length < 2 || a.lv === p.lv ? (lv === "ok" ? "Bones condicions tot el dia" : vs[0].why)
    : a.sc >= p.sc ? "Millor al matí · tarda: " + p.why.toLowerCase() : "Millor a la tarda · matí: " + a.why.toLowerCase();
  return {lv, sc, why, rows: a.rows.concat(p.rows), seg: (a.sc ?? -1) >= (p.sc ?? -1) ? a.seg : p.seg, block};
}
const FR_TXT = {am:"Matí", pm:"Tarda", dia:"Tot el dia"};
// Període (dies de la sortida): quants dies són bons (verds) i la nota mitjana
function periodEval(z){
  const ev = zoneEval(z), per = selDays.map(k => ({k, v: frSlot(ev, k)})), ok = per.filter(x => x.v.sc != null);
  const n = per.length, good = ok.filter(x => x.v.lv === "ok").length;
  const avg = ok.length ? ok.reduce((t, x) => t + x.v.sc, 0) / ok.length : null;
  const lv = !ok.length ? "na" : n === 1 ? per[0].v.lv : good === n ? "ok" : good > 0 && good * 2 >= n ? "mid" : "no";
  return {per, n, good, avg, lv};
}
// Dies a partir del 6è: previsió orientativa
const dayIdx = k => Math.round((Date.parse(k + "T12:00:00") - Date.parse(localOf(Date.now()).key + "T12:00:00")) / 86400e3);
const isFar = k => dayIdx(k) >= 5;
function dayLbl(k, long){
  const d = new Date(k + "T12:00:00"), i = dayIdx(k);
  const w = i === 0 ? "Avui" : i === 1 ? "Demà" : long ? ["diumenge","dilluns","dimarts","dimecres","dijous","divendres","dissabte"][d.getDay()] : DOW[d.getDay()];
  return long ? `${w} ${d.getDate()} ${MONTHS[d.getMonth()]}` : w;
}
function selTxt(){
  if(selDays.length === 1) return dayLbl(selDays[0], true);
  const s = selDays.slice().sort(), seg = s.every((k, i) => !i || dayIdx(k) === dayIdx(s[i - 1]) + 1);
  return seg ? `${dayLbl(s[0])} ${new Date(s[0] + "T12:00:00").getDate()} – ${dayLbl(s[s.length - 1])} ${new Date(s[s.length - 1] + "T12:00:00").getDate()} ${MONTHS[new Date(s[s.length - 1] + "T12:00:00").getMonth()]}`
    : s.length + " dies";
}
function setDays(arr, focus){
  selDays = [...new Set(arr)].sort(); store.set("cem_days", selDays);
  dayKey = focus && selDays.includes(focus) ? focus : selDays.includes(dayKey) ? dayKey : selDays[0];
  renderAll();
}

/* ---------- missatges ---------- */
function msg(t, err){ const m = $("msg"); m.hidden = !t; if(t){ m.textContent = t; m.classList.toggle("err", !!err); } }

/* ---------- MAPA ---------- */
const ICGC = "https://geoserveis.icgc.cat/servei/catalunya/";
const ATTR_ICGC = "© ICGC";   // sense enllaç: res obre un navegador extern
const map = new maplibregl.Map({
  container: "map",
  center: store.get("cem_view", {c:[1.6, 41.6]}).c, zoom: store.get("cem_view", {z:7.6}).z,
  pitch: t3d ? 55 : 0, maxPitch: 75, attributionControl: false,
  style: {
    version: 8,
    sources: {
      topo:  {type:"raster", tiles:[ICGC + "mapa-base/wmts/topografic/MON3857NW/{z}/{x}/{y}.png"], tileSize:256, maxzoom:18, attribution:ATTR_ICGC},
      orto:  {type:"raster", tiles:[ICGC + "mapa-base/wmts/orto/MON3857NW/{z}/{x}/{y}.png"], tileSize:256, maxzoom:20, attribution:ATTR_ICGC},
      slope: {type:"raster", tiles:[ICGC + "contextmaps-slope/wmts/{z}/{x}/{y}.png"], tileSize:256, maxzoom:16, attribution:ATTR_ICGC},
      dem:   {type:"raster-dem", tiles:[ICGC + "contextmaps-terreny-5m-rgb/wmts/{z}/{x}/{y}.png"], tileSize:512, minzoom:7, maxzoom:14,
              bounds:[0, 40.5, 4.2, 42.86], encoding:"mapbox", attribution:ATTR_ICGC}
    },
    layers: [
      {id:"topo", type:"raster", source:"topo"},
      {id:"orto", type:"raster", source:"orto", layout:{visibility:"none"}},
      {id:"slope", type:"raster", source:"slope", paint:{"raster-opacity":0.55}, layout:{visibility:"none"}}
    ]
  }
});
map.addControl(new maplibregl.AttributionControl({compact:true, customAttribution:"Previsió: Open-Meteo"}), "bottom-right");
map.addControl(new maplibregl.ScaleControl({unit:"metric"}), "bottom-left");
map.on("moveend", () => { store.set("cem_view", {c: map.getCenter().toArray(), z: map.getZoom()}); if(!drawing) renderDays(false); });

function applyBase(){
  if(!map.getLayer("topo")) return;
  map.setLayoutProperty("topo", "visibility", base === "topo" ? "visible" : "none");
  map.setLayoutProperty("orto", "visibility", base === "orto" ? "visible" : "none");
  document.querySelectorAll("#baseSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.base === base)));
}
function apply3D(){
  $("terrainBtn").setAttribute("aria-pressed", String(t3d));
  if(t3d){ map.setTerrain({source:"dem", exaggeration:1.3}); if(map.getPitch() < 30) map.easeTo({pitch:55}); }
  else { map.setTerrain(null); map.easeTo({pitch:0}); }
}
function applyLayers(){
  if(map.getLayer("slope")) map.setLayoutProperty("slope", "visibility", ly.slope ? "visible" : "none");
  ["wall-line", "wall-arrow"].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, "visibility", ly.walls ? "visible" : "none"));
  $("lySlope").checked = ly.slope; $("lyRadar").checked = ly.radar; $("lyWind").checked = ly.wind; $("lyWalls").checked = ly.walls;
  radar(ly.radar);
  renderMarkers();
}
// Radar de pluja (RainViewer): últim fotograma disponible; només fins a zoom 7 natiu
async function radar(on){
  const note = $("radarNote");
  if(!on){ if(map.getLayer("radar")) map.removeLayer("radar"); if(map.getSource("radar")) map.removeSource("radar"); note.hidden = true; return; }
  if(map.getLayer("radar")) return;
  try{
    const j = await (await fetch("https://api.rainviewer.com/public/weather-maps.json")).json();
    const f = j.radar.past[j.radar.past.length - 1];
    map.addSource("radar", {type:"raster", tiles:[j.host + f.path + "/256/{z}/{x}/{y}/2/1_1.png"], tileSize:256, maxzoom:7, attribution:"Radar: RainViewer"});
    map.addLayer({id:"radar", type:"raster", source:"radar", paint:{"raster-opacity":0.7}}, map.getLayer("wall-line") ? "wall-line" : undefined);
    const d = new Date(f.time * 1000); note.textContent = "Radar de les " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + "."; note.hidden = false;
  }catch(e){ note.textContent = "No s'ha pogut carregar el radar."; note.hidden = false; }
}

// Fletxa per a les parets (dibuixada en un canvas)
function arrowImage(){
  const s = 48, c = document.createElement("canvas"); c.width = c.height = s; const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.strokeStyle = "#1b1f18"; g.lineWidth = 3; g.lineJoin = "round";
  g.beginPath(); g.moveTo(24, 4); g.lineTo(40, 30); g.lineTo(29, 26); g.lineTo(29, 44); g.lineTo(19, 44); g.lineTo(19, 26); g.lineTo(8, 30); g.closePath();
  g.fill(); g.stroke();
  return g.getImageData(0, 0, s, s);
}
map.on("load", () => {
  map.addImage("wall-arrow", arrowImage(), {pixelRatio:2});
  map.addSource("walls", {type:"geojson", data:{type:"FeatureCollection", features:[]}});
  map.addSource("wallArrows", {type:"geojson", data:{type:"FeatureCollection", features:[]}});
  map.addSource("draw", {type:"geojson", data:{type:"FeatureCollection", features:[]}});
  map.addSource("zones", {type:"geojson", data:{type:"FeatureCollection", features:[]}, cluster:true, clusterRadius:60, clusterMaxZoom:10,
    clusterProperties: Object.fromEntries(LV_KEYS.map(k => [k, ["+", ["case", ["==", ["get", "lv"], k], 1, 0]]]))});
  map.addLayer({id:"zones-hit", type:"circle", source:"zones", paint:{"circle-radius":1, "circle-opacity":0}});
  map.on("render", () => { if(map.isSourceLoaded("zones")) updateMarkers(); });
  map.addLayer({id:"wall-line", type:"line", source:"walls", paint:{"line-color":"#d0201a", "line-width":["interpolate", ["linear"], ["zoom"], 10, 2, 16, 6]}, layout:{"line-cap":"round"}});
  map.addLayer({id:"wall-arrow", type:"symbol", source:"wallArrows", minzoom:12,
    layout:{"icon-image":"wall-arrow", "icon-rotate":["get", "az"], "icon-rotation-alignment":"map", "icon-allow-overlap":true, "icon-size":["interpolate", ["linear"], ["zoom"], 12, 0.6, 17, 1.1]}});
  map.addLayer({id:"draw-line", type:"line", source:"draw", filter:["==", "$type", "LineString"], paint:{"line-color":"#ffb000", "line-width":4, "line-dasharray":[2, 1]}});
  map.addLayer({id:"draw-pt", type:"circle", source:"draw", filter:["==", "$type", "Point"], paint:{"circle-radius":7, "circle-color":"#ffb000", "circle-stroke-color":"#000", "circle-stroke-width":2}});
  map.on("click", "wall-line", e => { if(drawing) return; const f = e.features[0]; const z = ZONES.find(z => z.id === f.properties.zone); if(z) openZone(z.id); });
  applyBase(); applyLayers(); renderWalls(); renderMarkers();
  if(t3d) apply3D();
});

// Marcadors de zona: rodona amb la nota i una icona del veredicte (no només color)
const LV_IC = {
  ok:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  mid:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"><path d="M12 5v9M12 19v.5"/></svg>',
  no:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  na:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7 12h10"/></svg>'
};
// Les zones van en una font GeoJSON agrupada: en allunyar-se, les properes s'ajunten en una rodona
// amb un gràfic de % pels colors dels veredictes. Els marcadors són HTML i es recalculen en moure el mapa.
const markers = {}, clusters = {};
let markersOnScreen = {}, mkVer = 0;
const LV_KEYS = ["ok", "mid", "no", "na"];
function zonesGeoJSON(){
  return {type:"FeatureCollection", features: ZONES.map(z => {
    const v = frSlot(zoneEval(z), dayKey), mid = v.rows[Math.floor(v.rows.length / 2)];
    const P = selDays.length > 1 ? periodEval(z) : null;
    return {type:"Feature", geometry:{type:"Point", coordinates:[z.lon, z.lat]},
      properties:{id:z.id, rf: window.CEM_R ? CEM_R.flags(z).ic : "", lv: P ? P.lv : v.lv, sc:v.sc == null ? -1 : Math.round(v.sc), lbl: P ? P.good + "/" + P.n : "",
        why: P ? `${P.good} de ${P.n} dies bons` : v.why, wd:mid ? mid.wd : -1, wkmh:mid ? Math.round(mid.wkmh) : -1}};
  })};
}
function renderMarkers(){
  if(!DATA || !map.getSource("zones")) return;
  mkVer++; map.getSource("zones").setData(zonesGeoJSON());
}
function zoneMarkerHTML(p){
  const z = ZONES.find(z => z.id === p.id), lvl = p.lv;
  const wind = ly.wind && p.wd >= 0 ? `<svg class="w" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${(p.wd + 180) % 360}deg)"><path d="M12 2l7 9h-4.5v11h-5V11H5z" fill="currentColor" stroke="var(--surface)" stroke-width="1.2" stroke-linejoin="round"/></svg>` : "";
  return `<span class="b lv-${lvl}${p.lbl ? " frac" : ""}">${p.lbl || (p.sc < 0 ? "–" : p.sc)}${LV_IC[lvl]}</span>${p.rf ? `<span class="rf" aria-hidden="true">${p.rf}</span>` : ""}${wind}<span class="n">${esc(z.name)}${ly.wind && p.wkmh >= 0 ? " · " + p.wkmh + " km/h" : ""}</span>`;
}
// Rodona d'un grup: anell amb el % de zones de cada color i el nombre de zones al centre
function donutHTML(p){
  const n = p.point_count, r = n < 10 ? 30 : n < 50 ? 34 : 40, w = 9, C = 2 * Math.PI * (r - w / 2);
  let off = 0;
  const arcs = LV_KEYS.map(k => { const f = (p[k] || 0) / n; if(!f) return "";
    const a = `<circle r="${r - w / 2}" cx="${r}" cy="${r}" fill="none" stroke="var(--${k === "na" ? "na" : k})" stroke-width="${w}" stroke-dasharray="${f * C} ${C}" stroke-dashoffset="${-off * C}" transform="rotate(-90 ${r} ${r})"/>`;
    off += f; return a; }).join("");
  const okp = Math.round((p.ok || 0) / n * 100);
  return `<svg width="${2 * r}" height="${2 * r}" viewBox="0 0 ${2 * r} ${2 * r}" aria-hidden="true"><circle r="${r}" cx="${r}" cy="${r}" fill="var(--surface)"/>${arcs}` +
    `<text x="${r}" y="${r - 2}" text-anchor="middle" font-size="${r > 30 ? 17 : 15}" font-weight="800" fill="var(--ink)">${n}</text>` +
    `<text x="${r}" y="${r + 13}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--muted)">${okp}% ✓</text></svg>`;
}
function updateMarkers(){
  if(!map.getSource("zones") || !map.isSourceLoaded("zones")) return;
  const next = {};
  map.querySourceFeatures("zones").forEach(f => {
    const p = f.properties, c = f.geometry.coordinates;
    if(p.cluster){
      const id = "c" + p.cluster_id;
      let m = clusters[id];
      if(!m){
        const el = document.createElement("button"); el.type = "button"; el.className = "zc";
        el.addEventListener("click", ev => { ev.stopPropagation(); if(drawing) return;
          map.getSource("zones").getClusterExpansionZoom(p.cluster_id).then(zm => map.easeTo({center: c, zoom: zm + 0.8})); });
        m = clusters[id] = new maplibregl.Marker({element: el}).setLngLat(c);
      }
      const el = m.getElement();
      if(el.dataset.v !== String(mkVer)){ el.dataset.v = mkVer; el.innerHTML = donutHTML(p);
        el.setAttribute("aria-label", `${p.point_count} zones: ${p.ok || 0} recomanades, ${p.mid || 0} amb limitacions, ${p.no || 0} no recomanades. Toca per acostar-t'hi.`); }
      next[id] = m;
    }else{
      const id = p.id;
      let m = markers[id];
      if(!m){
        const el = document.createElement("button"); el.type = "button"; el.className = "zm";
        el.addEventListener("click", ev => { ev.stopPropagation(); if(!drawing) openZone(id); });
        m = markers[id] = new maplibregl.Marker({element: el}).setLngLat(c);
      }
      const el = m.getElement();
      if(el.dataset.v !== String(mkVer)){ el.dataset.v = mkVer; el.innerHTML = zoneMarkerHTML(p);
        const z = ZONES.find(z => z.id === id);
        el.setAttribute("aria-label", `${z.name}: ${LV_TXT[p.lv]}${p.lbl ? "" : p.sc >= 0 ? ", " + p.sc + " sobre 10" : ""}. ${p.why}`); }
      next[id] = m;
    }
  });
  for(const id in next) if(!markersOnScreen[id]) next[id].addTo(map);
  for(const id in markersOnScreen) if(!next[id]) markersOnScreen[id].remove();
  markersOnScreen = next;
}
function renderWalls(){
  if(!map.getSource("walls")) return;
  const lines = [], arrows = [];
  ZONES.forEach(z => wallsOf(z).forEach(w => {
    lines.push({type:"Feature", properties:{id:w.id, zone:z.id}, geometry:{type:"LineString", coordinates:w.pts}});
    w.segs.forEach((s, i) => { const az = segAz(w, i); if(az == null) return;
      const a = w.pts[i], b = w.pts[i + 1];
      arrows.push({type:"Feature", properties:{az}, geometry:{type:"Point", coordinates:[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]}}); });
  }));
  map.getSource("walls").setData({type:"FeatureCollection", features:lines});
  map.getSource("wallArrows").setData({type:"FeatureCollection", features:arrows});
}

/* ---------- barra de dia i franja ---------- */
// Barra de dies: per a cada dia i franja, la mitjana de les zones que es veuen ara al mapa.
// Es recalcula en moure o fer zoom (moveend). Sense cap zona a la vista, gris.
function visibleZones(){
  const b = map.getBounds();
  return ZONES.filter(z => b.contains([z.lon, z.lat]));
}
function avgSlot(zs, k, s){
  const sc = zs.map(z => frSlot(zoneEval(z), k, s).sc).filter(v => v != null);
  if(!sc.length) return {lv:"na", sc:null};
  const m = sc.reduce((a, b) => a + b, 0) / sc.length;
  return {lv: lvOf(m, null), sc: m};
}
function renderDays(scroll = true){
  if(!DATA) return;
  const box = $("days"), keys = daysAvail(), zs = visibleZones();
  const cell = v => `<i class="lv-${v.lv}">${v.sc == null ? "–" : Math.round(v.sc)}</i>`;
  box.innerHTML = keys.map(k => {
    const d = new Date(k + "T12:00:00"), on = selDays.includes(k);
    const am = avgSlot(zs, k, "am"), pm = avgSlot(zs, k, "pm");
    const aria = `${dayLbl(k, true)}${on ? ", triat" : ""}${isFar(k) ? ", previsió orientativa" : ""}. Mitjana de les zones a la vista: matí ${am.sc == null ? "sense dades" : Math.round(am.sc)}, tarda ${pm.sc == null ? "sense dades" : Math.round(pm.sc)}.`;
    return `<button type="button" data-day="${k}" aria-pressed="${on}" class="${k === dayKey && selDays.length > 1 ? "foc" : ""}${isFar(k) ? " far" : ""}" aria-label="${aria}"><b>${dayLbl(k)}</b><small>${d.getDate()} ${MONTHS[d.getMonth()]}</small>` +
      `<span class="dk" aria-hidden="true">${cell(am)}${cell(pm)}</span></button>`;
  }).join("");
  $("dayHint").textContent = zs.length ? `Mitjana de ${zs.length === 1 ? "la zona" : "les " + zs.length + " zones"} a la vista · matí | tarda` : "Cap zona a la vista: mou o allunya el mapa";
  $("calBtn").querySelector("span").textContent = selDays.length === 1 ? "1 dia" : selDays.length + " dies";
  document.querySelectorAll("#slotSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.slot === slot)));
  if(scroll){ const sel = box.querySelector(".foc") || box.querySelector('[aria-pressed="true"]'); if(sel) sel.scrollIntoView({inline:"nearest", block:"nearest"}); }
  document.documentElement.style.setProperty("--daybar-h", $("daybar").offsetHeight + 16 + "px");
  if(!$("calSheet").hidden) renderCal();
  if(!$("rankSheet").hidden) renderRank();
}
$("days").addEventListener("click", e => { const b = e.target.closest("button[data-day]"); if(!b) return; const k = b.dataset.day;
  if(selDays.length > 1 && selDays.includes(k)){ dayKey = k; renderAll(); } else setDays([k], k); });
$("slotSeg").addEventListener("click", e => { const b = e.target.closest("button[data-slot]"); if(!b) return; slot = b.dataset.slot; store.set("cem_slot", slot); renderAll(); });
$("modSeg").addEventListener("click", e => { const b = e.target.closest("button[data-mod]"); if(!b) return; mod = b.dataset.mod; store.set("cem_mod", mod); renderPanels(); renderAll(); });

/* ---------- FITXA DE LA ZONA ---------- */
function openZone(id){ selZone = id; $("calSheet").hidden = true; $("rankSheet").hidden = true; $("sheet").hidden = false; renderSheet(); const z = ZONES.find(z => z.id === id); if(z && map.getZoom() < 9) map.easeTo({center:[z.lon, z.lat], zoom: 10}); }
$("sheetClose").addEventListener("click", () => { selZone = null; $("sheet").hidden = true; });
const pill = (lv, txt) => `<span class="pill lv-${lv}">${LV_IC[lv].replace("<svg", '<svg width="13" height="13"')}${esc(txt)}</span>`;
function feelLv(f){ const lo = crit.comfLo, hi = crit.comfHi; return f < lo - 6 || f > hi + 6 ? "no" : f < lo || f > hi ? "mid" : "ok"; }
function feelTxt(f){ const lo = crit.comfLo, hi = crit.comfHi; return f < lo - 6 ? "Molt fred" : f < lo ? "Fresc" : f > hi + 6 ? "Molta calor" : f > hi ? "Calor" : "Agradable"; }
function arrowSVG(az){ return `<span class="arrow" title="Mira al ${cardOf(az)}"><svg width="18" height="18" viewBox="0 0 24 24" style="transform:rotate(${az}deg)" aria-hidden="true"><path d="M12 3l6 14-6-3-6 3z" fill="currentColor"/></svg></span>`; }

function renderSheet(){
  if(!selZone || !DATA) return;
  const z = ZONES.find(z => z.id === selZone), ev = zoneEval(z), o = ev.o;
  const ws = wallsOf(z);
  $("zName").textContent = z.name;
  $("zMeta").textContent = `${ROCKS[z.rock].name} · ${z.alt} m · ${z.mods.map(m => m === "classica" ? "clàssica" : "esportiva").join(", ")}${z.src === "provisional" ? " · dades de prova" : ""}`;
  const V = {am: zoneSlot(ev, dayKey, "am"), pm: zoneSlot(ev, dayKey, "pm")};
  const cur = slot === "dia" ? frSlot(ev, dayKey, "dia") : V[slot], rows = cur.rows.length ? cur.rows : V.am.rows.concat(V.pm.rows);
  const mid = rows[Math.floor(rows.length / 2)];
  const vb = s => { const v = V[s];
    return `<button type="button" class="vb ${v.lv}" data-slot="${s}" aria-pressed="${s === slot}"><span class="h"><span class="lbl">${s === "am" ? "Matí" : "Tarda"}</span>` +
      `<span class="sc">${v.sc == null ? "–" : Math.round(v.sc)}<small>/10</small></span></span>` +
      `<span class="vt tx-${v.lv}">${LV_IC[v.lv].replace("<svg", '<svg width="18" height="18"')}${LV_TXT[v.lv]}</span><span class="why">${esc(v.why)}</span>` +
      (v.seg ? `<span class="why">Millor: ${esc(v.seg.w.name)}${v.seg.w.segs.length > 1 ? " (tram " + cardOf(v.seg.az) + ")" : ""}</span>` : "") + `</button>`; };
  let h = "";
  if(selDays.length > 1){
    const P = periodEval(z);
    h += `<div class="psum"><div class="ph"><span class="vt tx-${P.lv}">${LV_IC[P.lv].replace("<svg", '<svg width="18" height="18"')}<b>${P.good} de ${P.n} dies bons</b></span>` +
      `<span class="muted">${esc(selTxt())} · ${FR_TXT[slot].toLowerCase()}${P.avg != null ? " · mitjana " + Math.round(P.avg) : ""}</span></div>` +
      `<div class="pdays">${P.per.map(x => `<button type="button" class="pd ${x.v.lv}${isFar(x.k) ? " far" : ""}" data-pday="${x.k}" aria-pressed="${x.k === dayKey}">` +
        `<span>${dayLbl(x.k)} ${new Date(x.k + "T12:00:00").getDate()}</span><b class="num">${x.v.sc == null ? "–" : Math.round(x.v.sc)}</b><small>${esc(x.v.why)}</small></button>`).join("")}</div></div>` +
      `<p class="note">Detall de ${esc(dayLbl(dayKey, true))}:</p>`;
  }
  h += `<div class="verd">${vb("am")}${vb("pm")}</div>`;
  if(selDays.some(isFar)) h += `<p class="note">A partir del 6è dia la previsió és orientativa: torna-la a mirar més a prop de la sortida.</p>`;
  if(z.mods.indexOf(mod) < 0) h += `<p class="note">Aquesta zona no té ${mod === "classica" ? "vies clàssiques" : "escalada esportiva"} al catàleg.</p>`;
  // confort
  if(mid){
    const f = mid.feel, lv = feelLv(f);
    h += `<div class="conf"><div><span class="lbl">Sensació ${pad(mid.loc.h)} h</span><div class="big num tx-${lv}">${Math.round(f)}<small>°C</small></div></div>` +
      `<div>${pill(lv, feelTxt(f))}<div class="air">Aire ${Math.round(mid.T)} °C${mid.sunny ? " · al sol" : mid.lit ? " · núvol" : mid.lit === false ? " · a l'ombra" : ""}</div></div>` +
      `<div class="seg" role="group" aria-label="Confort per a" id="roleSeg"><button type="button" data-role="climb" aria-pressed="${role === "climb"}">Escalant</button>` +
      `<button type="button" data-role="belay" aria-pressed="${role === "belay"}">Assegurant</button></div></div>`;
  }
  // dades clau
  const allRows = (cur.seg ? cur.seg.rows : ev.zoneRows);
  const nowI = allRows.findIndex(r => r.t >= Date.now()); const ref = mid || allRows[Math.max(0, nowI)];
  const rain72 = (() => { const t1 = ref ? ref.t : Date.now(); let s = 0; o.t.forEach((t, i) => { if(t <= t1 && t > t1 - 72 * 3600e3) s += o.P[i] || 0; }); return s; })();
  const st = ref ? (ref.W > 0.3 ? "molla" : ref.W > 0.05 ? "humida" : "seca") : "–";
  const since = ref && ref.lastWet && ref.W <= 0.3 ? " · seca fa " + Math.max(1, Math.round((ref.t - ref.lastWet) / 3600e3)) + " h" : "";
  const sun = o.sun[dayKey];
  const tf = ms => { const d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  h += `<div class="facts">` +
    `<span>Roca <b>${st}</b>${since}</span><span>Pluja 72 h <b>${rain72.toFixed(1).replace(".", ",")} mm</b></span>` +
    (ref ? `<span>Vent <b>${Math.round(ref.wkmh)}</b> km/h ${cardOf(ref.wd)} · ratxa <b>${Math.round(ref.gust)}</b></span><span>Humitat <b>${Math.round(ref.RH)} %</b></span>` : "") +
    (sun ? `<span>Llum <b>${tf(sun.rise)}–${tf(sun.set)}</b></span>` : "") + `</div>`;
  // coordenades de la zona i botó per obrir-les a l'app de mapes del mòbil (no al navegador)
  const ll = `${z.lat.toFixed(5)}, ${z.lon.toFixed(5)}`, isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const mapHref = isIOS ? `https://maps.apple.com/?ll=${z.lat},${z.lon}&q=${encodeURIComponent(z.name)}` : /Android/.test(navigator.userAgent) ? `geo:${z.lat},${z.lon}?q=${z.lat},${z.lon}(${encodeURIComponent(z.name)})` : "";
  h += `<div class="zloc"><span>📍 <b class="num">${ll}</b>${z.src === "provisional" ? ' <span class="muted">(aproximades)</span>' : ""}</span>` +
    `<button class="btn sm" type="button" data-copy="${ll}">Copia</button>` + (mapHref ? `<a class="btn sm pri" href="${mapHref}">Obre al mapa</a>` : "") + `</div>`;
  if(window.CEM_R) h += CEM_R.sheetHTML(z);
  // parets
  h += `<div class="walls">`;
  if(!ws.length) h += `<p class="note">Encara no hi ha cap paret traçada: el veredicte és per a tota la zona (sol mitjà, sense orientació). Traça una paret per saber-ne el sol i l'ombra.</p>`;
  ws.forEach(w => {
    w.segs.forEach((s, i) => {
      const az = segAz(w, i), sg = ev.segs.find(x => x.w === w && x.i === i);
      h += `<div class="wall"><div class="wh"><b>${esc(w.name)}${w.segs.length > 1 ? " · tram " + (i + 1) : ""}</b>` +
        (az != null ? `${arrowSVG(az)}<span>Mira al <b>${cardOf(az)}</b> (${Math.round(az)}°)</span>` : `<span class="tx-mid">Orientació per fixar</span>`) + `</div>` +
        (i === 0 ? `<div class="wh">${wallTag(w)}</div>` : "");
      if(sg){
        const hrs = []; for(let hh = 7; hh <= 21; hh++){ const r = sg.rows.find(r => r.loc.key === dayKey && r.loc.h === hh); hrs.push(r); }
        const nowL = localOf(Date.now());
        h += `<div class="sunbar" aria-label="Sol a la paret per hores">${hrs.map((r, k) => `<i class="${r && r.lit ? "s" : ""}${nowL.key === dayKey && nowL.h === 7 + k ? " cur" : ""}" title="${7 + k} h: ${r && r.lit ? "sol" : "ombra"}"></i>`).join("")}</div>` +
          `<div class="sunlbl"><span>7 h</span><span>☀ sol · ombra</span><span>21 h</span></div>`;
      }
      h += `<details class="more"><summary>Corregeix l'orientació</summary><p class="note">El relleu de 5 m suavitza les parets verticals: si la fletxa no és bona, tria cap on mira la paret.</p>` +
        `<div class="azfix" data-wall="${w.id}" data-seg="${i}">${CARD.map((c, k) => `<button type="button" data-az="${k * 45}" aria-pressed="${azFix[w.id + ":" + i] === k * 45}">${c}</button>`).join("")}` +
        `<button type="button" data-az="auto" aria-pressed="${azFix[w.id + ":" + i] == null}">Auto</button></div>` +
        `<div class="row" style="margin:8px 0"><div class="seg" role="group" aria-label="Exposició al vent" data-exp="${w.id}">` +
        `<button type="button" data-v="exposat" aria-pressed="${w.exp !== "arrecerat"}">Exposada</button><button type="button" data-v="arrecerat" aria-pressed="${w.exp === "arrecerat"}">Arrecerada</button></div></div></details></div>`;
    });
  });
  h += `<button class="btn" type="button" id="drawStart">${ws.length ? "Traça una altra paret" : "Traça una paret"}</button></div>`;
  // detall per hores
  const dayRows = (cur.seg ? cur.seg.rows : ev.zoneRows).filter(r => r.loc.key === dayKey && r.loc.h >= 7 && r.loc.h <= 21);
  h += `<details class="more"><summary>Detall per hores</summary><table class="htab"><thead><tr><th>h</th><th>Nota</th><th>Sensació</th><th>Aire</th><th>Pluja</th><th>Vent</th><th>Sol</th></tr></thead><tbody>` +
    dayRows.map(r => `<tr><td>${pad(r.loc.h)}</td><td class="sc lv-${lvOf(r.sc, r.block)}">${Math.round(r.sc)}</td><td class="tx-${feelLv(r.feel)}"><b>${Math.round(r.feel)}°</b></td><td>${Math.round(r.T)}°</td>` +
      `<td>${r.P >= 0.1 ? r.P.toFixed(1).replace(".", ",") + " mm" : Math.round(r.PP) + " %"}</td><td>${Math.round(r.wkmh)}/${Math.round(r.gust)}</td><td>${r.lit ? "☀" : r.lit === false ? "·" : "–"}</td></tr>`).join("") +
    `</tbody></table><p class="note">Vent: mitjà / ratxa en km/h. ${cur.seg ? "Paret: " + esc(cur.seg.w.name) + "." : "Tota la zona."}</p></details>`;
  $("zBody").innerHTML = h;
}
$("zBody").addEventListener("click", e => {
  const pd = e.target.closest("button[data-pday]"); if(pd){ dayKey = pd.dataset.pday; renderAll(); return; }
  const cp = e.target.closest("button[data-copy]");
  if(cp){ const t = cp.dataset.copy; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => msg("Coordenades copiades."), () => msg(t));
    setTimeout(() => msg(null), 3000); return; }
  const s = e.target.closest(".vb[data-slot]"); if(s){ slot = s.dataset.slot; store.set("cem_slot", slot); renderAll(); return; }
  const r = e.target.closest("#roleSeg button[data-role]"); if(r){ setRole(r.dataset.role); return; }
  const a = e.target.closest(".azfix button[data-az]");
  if(a){ const box = a.parentElement, k = box.dataset.wall + ":" + box.dataset.seg;
    if(a.dataset.az === "auto") delete azFix[k]; else azFix[k] = +a.dataset.az;
    store.set("cem_azfix", azFix); renderWalls(); renderAll(); return; }
  const x = e.target.closest("[data-exp] button[data-v]");
  if(x){ const w = userWalls.find(w => w.id === x.parentElement.dataset.exp);
    if(w){ w.exp = x.dataset.v; saveWalls(); renderAll(); } else msg("Aquesta paret és de tothom: per canviar-ne l'exposició, traça-la i proposa-la de nou.", true); return; }
  if(e.target.closest("#drawStart")) startDraw();
});
// Proposar una paret: ho fa cloud.js (compte, acceptació de la llicència i enviament)
document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("button[data-propose]"); if(!b) return;
  if(window.CEM_CLOUD) CEM_CLOUD.propose(b.dataset.propose); else msg("El compte encara s'està carregant. Torna-ho a provar.", true); });
function setRole(r){ role = r; store.set("cem_role", role); renderAll(); renderPanels(); }

function renderAll(){ if(!DATA) return; renderDays(); renderMarkers(); renderSheet(); }

/* ---------- CALENDARI: dies de la sortida ---------- */
function openSheet(id){ ["calSheet", "rankSheet"].forEach(x => $(x).hidden = x !== id); if(id === "calSheet") renderCal(); else renderRank(); }
document.addEventListener("click", e => { const c = e.target.closest && e.target.closest("[data-shclose]"); if(c) c.closest(".msheet").hidden = true; });
$("calBtn").addEventListener("click", () => openSheet("calSheet"));
$("rankBtn").addEventListener("click", () => openSheet("rankSheet"));
function presetDays(p){
  const av = daysAvail(), today = av[0];
  if(p === "avui") return [today];
  if(p === "dema") return av.slice(1, 2);
  if(p === "3") return av.slice(0, 3);
  if(p === "cs"){ // aquest cap de setmana (el pròxim dissabte i diumenge; si avui és diumenge, avui)
    const out = av.filter(k => { const d = new Date(k + "T12:00:00").getDay(); return (d === 6 || d === 0) && dayIdx(k) <= 6; });
    const sat = out.find(k => new Date(k + "T12:00:00").getDay() === 6);
    return sat ? out.filter(k => dayIdx(k) >= dayIdx(sat) && dayIdx(k) <= dayIdx(sat) + 1) : out.slice(0, 1);
  }
  return [];
}
function renderCal(){
  const av = daysAvail(), zs = visibleZones(); if(!av.length) return;
  const first = new Date(av[0] + "T12:00:00"), off = (first.getDay() + 6) % 7;   // dilluns = 0
  const cells = [];
  for(let i = 0; i < off; i++) cells.push(`<span class="cd empty"></span>`);
  av.forEach(k => { const d = new Date(k + "T12:00:00"), v = avgSlot(zs, k, slot), on = selDays.includes(k);
    cells.push(`<button type="button" class="cd${on ? " on" : ""}${isFar(k) ? " far" : ""}" data-cday="${k}" aria-pressed="${on}" aria-label="${dayLbl(k, true)}${isFar(k) ? ", previsió orientativa" : ""}">` +
      `<b>${d.getDate()}</b><i class="lv-${v.lv}">${v.sc == null ? "–" : Math.round(v.sc)}</i></button>`); });
  const pre = [["avui", "Avui"], ["dema", "Demà"], ["cs", "Cap de setmana"], ["3", "Pròxims 3 dies"]];
  $("calBody").innerHTML = `<div class="row">${pre.map(([k, t]) => `<button class="btn sm" type="button" data-pre="${k}">${t}</button>`).join("")}</div>` +
    `<div class="cal"><span>dl</span><span>dt</span><span>dc</span><span>dj</span><span>dv</span><span>ds</span><span>dg</span>${cells.join("")}</div>` +
    `<p class="note">Toca els dies que vols sortir (no cal que siguin seguits). El número és la mitjana de les zones a la vista (${FR_TXT[slot].toLowerCase()}). Amb vora discontínua, previsió orientativa (6 dies o més).</p>` +
    `<p><b>${esc(selTxt())}</b></p>`;
}
$("calBody").addEventListener("click", e => {
  const p = e.target.closest("button[data-pre]"); if(p){ const d = presetDays(p.dataset.pre); if(d.length) setDays(d, d[0]); return; }
  const c = e.target.closest("button[data-cday]"); if(!c) return; const k = c.dataset.cday;
  if(selDays.includes(k)){ if(selDays.length > 1) setDays(selDays.filter(x => x !== k)); }   // sempre en queda un
  else setDays(selDays.concat(k), k);
});

/* ---------- RÀNQUING «On anar» ---------- */
let rankScope = store.get("cem_rank_scope", "all");
function renderRank(){
  if(!DATA) return;
  const zs = rankScope === "vis" ? visibleZones() : ZONES;
  // primer les zones amb la modalitat; les tancades o amb restricció confirmada de tota la zona, al final
  const list = zs.map(z => ({z, P: periodEval(z), has: z.mods.includes(mod), F: window.CEM_R ? CEM_R.flags(z) : {}}))
    .sort((a, b) => (b.has - a.has) || (!!a.F.full - !!b.F.full) || (b.P.good - a.P.good) || ((b.P.avg ?? -1) - (a.P.avg ?? -1)));
  $("rankBody").innerHTML =
    `<div class="row rk-top"><span class="muted">${esc(selTxt())} · ${FR_TXT[slot].toLowerCase()} · ${mod === "classica" ? "clàssica" : "esportiva"}</span>` +
    `<div class="seg" role="group" aria-label="Quines zones" id="rankSeg"><button type="button" data-rs="all" aria-pressed="${rankScope === "all"}">Totes</button>` +
    `<button type="button" data-rs="vis" aria-pressed="${rankScope === "vis"}">A la vista</button></div></div>` +
    (list.length ? list.map((x, i) => { const P = x.P, z = x.z;
      return `<button type="button" class="rk${x.has ? "" : " off"}" data-zone="${z.id}"><span class="rn num">${i + 1}</span>` +
        `<span class="rm"><b>${esc(z.name)}</b><small>${ROCKS[z.rock].name} · ${z.alt} m${x.has ? "" : " · sense " + (mod === "classica" ? "clàssica" : "esportiva")}</small>` +
        (x.F.ic ? `<span class="rflag${x.F.full ? " full" : x.F.pend ? " pend" : ""}">${x.F.ic} ${esc(x.F.txt)}</span>` : "") + `` +
        `<span class="rd">${P.per.map(d => `<i class="lv-${d.v.lv}" title="${dayLbl(d.k, true)}: ${esc(d.v.why)}">${dayLbl(d.k)} ${d.v.sc == null ? "–" : Math.round(d.v.sc)}</i>`).join("")}</span>` +
        (P.n === 1 ? `<small>${esc(P.per[0].v.why)}</small>` : "") + `</span>` +
        `<span class="rv2 lv-${P.lv}">${P.n > 1 ? P.good + "/" + P.n : P.avg == null ? "–" : Math.round(P.avg)}<small>${P.n > 1 ? "dies bons" : "/10"}</small></span></button>`; }).join("")
      : `<p class="note">Cap zona a la vista. Tria «Totes» o allunya el mapa.</p>`);
}
$("rankBody").addEventListener("click", e => {
  const s = e.target.closest("button[data-rs]"); if(s){ rankScope = s.dataset.rs; store.set("cem_rank_scope", rankScope); renderRank(); return; }
  const r = e.target.closest("button[data-zone]"); if(r){ $("rankSheet").hidden = true; openZone(r.dataset.zone); }
});

/* ---------- RELLEU: lectura del model del terreny de l'ICGC (5 m, RGB) ---------- */
// Cada rajola PNG codifica l'altitud: h = −10000 + (R·65536 + G·256 + B) · 0,1
const demTiles = new Map();
function demTile(z, x, y){
  const k = z + "/" + x + "/" + y;
  if(!demTiles.has(k)) demTiles.set(k, new Promise(res => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { try{ const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext("2d", {willReadFrequently:true}); g.drawImage(img, 0, 0); res({w:c.width, d:g.getImageData(0, 0, c.width, c.height).data}); }catch(e){ res(null); } };
    img.onerror = () => res(null);
    img.src = ICGC + "contextmaps-terreny-5m-rgb/wmts/" + k + ".png";
  }));
  return demTiles.get(k);
}
async function elev(lon, lat, z = 14){
  const n = 2 ** z, xf = (lon + 180) / 360 * n, s = Math.sin(lat * RAD), yf = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  const t = await demTile(z, Math.floor(xf), Math.floor(yf)); if(!t) return null;
  const px = Math.min(t.w - 1, Math.floor((xf % 1) * t.w)), py = Math.min(t.w - 1, Math.floor((yf % 1) * t.w)), i = (py * t.w + px) * 4;
  if(t.d[i + 3] === 0) return null;
  return -10000 + (t.d[i] * 65536 + t.d[i + 1] * 256 + t.d[i + 2]) * 0.1;
}
// Punt a d metres en la direcció az des de [lon, lat]
function dest(p, az, d){ const dl = d / 6371000; const la = p[1] * RAD, lo = p[0] * RAD, b = az * RAD;
  const la2 = Math.asin(Math.sin(la) * Math.cos(dl) + Math.cos(la) * Math.sin(dl) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(dl) * Math.cos(la), Math.cos(dl) - Math.sin(la) * Math.sin(la2));
  return [lo2 / RAD, la2 / RAD]; }
function bearing(a, b){ const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD);
  const x = Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) - Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360; }
function distM(a, b){ const dla = (b[1] - a[1]) * RAD, dlo = (b[0] - a[0]) * RAD;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dlo / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(h)); }

// Orientació d'un tram: la paret mira cap al costat més baix (es compara l'altitud a banda i banda)
async function segFacing(a, b){
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], br = bearing(a, b);
  const sides = [br + 90, br - 90].map(x => (x + 360) % 360);
  const hs = [];
  for(const s of sides){ const e1 = await elev(...dest(m, s, 30)), e2 = await elev(...dest(m, s, 60)); if(e1 == null || e2 == null) return null; hs.push(e1 + e2); }
  if(Math.abs(hs[0] - hs[1]) < 6) return null;          // pla o massa suau: cal fixar-la a mà
  return hs[0] < hs[1] ? sides[0] : sides[1];
}
// Horitzó real des del peu de la paret: elevació màxima del relleu cada 5°, fins a 7 km (cap al davant de la paret)
const HZ_D = [100, 150, 200, 300, 400, 550, 700, 900, 1200, 1600, 2000, 2600, 3300, 4200, 5500, 7000];
async function horizon(a, b, face){
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], foot = dest(m, face, 25);
  const e0 = await elev(...foot); if(e0 == null) return null;
  const hz = new Array(72).fill(0);
  for(let k = 0; k < 72; k++){
    const az = k * 5, d = ((az - face + 540) % 360) - 180;
    if(Math.abs(d) > 95){ hz[k] = 90; continue; }       // darrere la paret: el sol no la toca
    let mx = 0;
    for(const dist of HZ_D){
      const e = await elev(...dest(foot, az, dist), dist <= 1200 ? 14 : 12); if(e == null) continue;
      const ang = Math.atan((e - e0 - 1.5 - dist * dist / 12742000) / dist) / RAD; if(ang > mx) mx = ang;
    }
    hz[k] = Math.round(mx * 10) / 10;
  }
  return hz;
}

/* ---------- traçat de parets ---------- */
let drawing = false, drawPts = [];
function startDraw(){
  const z = ZONES.find(z => z.id === selZone);
  drawing = true; drawPts = []; document.body.classList.add("drawing");
  $("sheet").hidden = true; $("daybar").hidden = true; $("drawBar").hidden = false; $("layerPanel").hidden = true;
  if(base !== "orto"){ base = "orto"; applyBase(); }
  if(z && map.getZoom() < 14) map.flyTo({center:[z.lon, z.lat], zoom: 15});
  updDraw();
}
function updDraw(){
  const f = drawPts.map(p => ({type:"Feature", geometry:{type:"Point", coordinates:p}}));
  if(drawPts.length > 1) f.push({type:"Feature", geometry:{type:"LineString", coordinates:drawPts}});
  map.getSource("draw") && map.getSource("draw").setData({type:"FeatureCollection", features:f});
  $("drawDone").disabled = drawPts.length < 2; $("drawUndo").disabled = !drawPts.length;
  $("drawTxt").textContent = drawPts.length ? `${drawPts.length} punts. Segueix el peu del cingle; cada tram tindrà la seva orientació.` : "Toca el mapa al llarg del cingle, d'una punta a l'altra.";
}
function endDraw(){ drawing = false; drawPts = []; updDraw(); document.body.classList.remove("drawing"); $("drawBar").hidden = true; $("daybar").hidden = false; if(selZone) $("sheet").hidden = false; }
map.on("click", e => { if(!drawing) return; drawPts.push([+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)]); updDraw(); });
$("drawUndo").addEventListener("click", () => { drawPts.pop(); updDraw(); });
$("drawCancel").addEventListener("click", endDraw);
$("drawDone").addEventListener("click", async () => {
  const pts = drawPts.slice(), mid = pts[Math.floor(pts.length / 2)];
  let z = ZONES.find(z => z.id === selZone) || null, best = Infinity;
  ZONES.forEach(zz => { const d = distM(mid, [zz.lon, zz.lat]); if(d < best){ best = d; z = zz; } });
  if(best > 15000){ msg("Aquesta paret és lluny de qualsevol zona del catàleg (més de 15 km).", true); return; }
  $("drawDone").disabled = true; $("drawTxt").textContent = "Calculant l'orientació i l'horitzó amb el relleu…";
  const segs = [];
  for(let i = 0; i < pts.length - 1; i++){
    const az = await segFacing(pts[i], pts[i + 1]);
    const hz = az != null ? await horizon(pts[i], pts[i + 1], az) : null;
    segs.push({azAuto: az != null ? Math.round(az) : null, hz});
  }
  const n = userWalls.filter(w => w.zone === z.id).length + 1;
  const w = {id: "w" + Date.now().toString(36), zone: z.id, name: "Paret " + n, pts, segs, exp: "exposat", created: new Date().toISOString()};
  userWalls.push(w); saveWalls(); selZone = z.id; endDraw();
  const bad = segs.filter(s => s.azAuto == null).length;
  msg(bad ? `Paret desada. ${bad} tram${bad > 1 ? "s" : ""} sense orientació clara: fixa-la a mà a la fitxa.` : "Paret desada amb orientació i horitzó.", !!bad);
  setTimeout(() => msg(null), 6000);
  renderAll();
});
function saveWalls(){ store.set("cem_walls", userWalls); cache.clear(); renderWalls(); renderPanels(); }

/* ---------- MENÚ ⋮ i pàgines ---------- */
function openPanel(id){ $(id).hidden = false; renderPanels(); }
$("menuBtn").addEventListener("click", () => openPanel("menu"));
document.addEventListener("click", e => {
  const p = e.target.closest("[data-page]"); if(p){ openPanel(p.dataset.page); return; }
  if(e.target.closest("[data-back]")) e.target.closest(".panel").hidden = true;
  if(e.target.closest("[data-close]")) document.querySelectorAll(".panel").forEach(x => x.hidden = true);
});
// tema
let theme = store.get("cem_theme", "auto"), size = store.get("cem_size", "normal"), cb = store.get("cem_cb", "0");
function applyLook(){
  const r = document.documentElement;
  if(theme === "auto") delete r.dataset.theme; else r.dataset.theme = theme;
  if(size === "big") r.dataset.size = "big"; else delete r.dataset.size;
  if(cb === "1") r.dataset.cb = "1"; else delete r.dataset.cb;
  const dark = theme === "dark" || (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  $("themeColor").setAttribute("content", dark ? "#11140f" : "#eef0ea");
}
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyLook);
const CLO_TXT = {0.5:"lleugera", 1:"normal", 1.6:"d'abric"};
function renderPanels(){
  const pr = (sel, attr, val) => document.querySelectorAll(sel).forEach(b => b.setAttribute("aria-pressed", String(b.dataset[attr] === String(val))));
  pr("#themeSeg button", "theme", theme); pr("#sizeSeg button", "size", size); pr("#cbSeg button", "cb", cb);
  pr("#roleSeg2 button", "role", role); pr("#cloSeg button", "clo", clo); pr("#modSeg button", "mod", mod);
  $("sub").textContent = mod === "classica" ? "Clàssica" : "Esportiva";
  $("peekAsp").textContent = {auto:"Tema automàtic", dark:"Tema fosc", light:"Tema clar"}[theme] + " · lletra " + (size === "big" ? "gran" : "petita") + (cb === "1" ? " · alt contrast" : "");
  $("peekLl").textContent = (role === "climb" ? "Escalant" : "Assegurant") + " · roba " + CLO_TXT[clo];
  $("peekPar").textContent = userWalls.length ? userWalls.length + " traçades en aquest mòbil" : "Cap paret traçada";
  // llindars
  const C = crit[mod], mname = mod === "classica" ? "clàssica" : "esportiva";
  $("crit").innerHTML =
    `<label>Sensació còmoda des de<span class="cv"><input type="range" min="0" max="20" step="1" value="${crit.comfLo}" data-k="comfLo"><b>${crit.comfLo} °C</b></span></label>` +
    `<label>Sensació còmoda fins a<span class="cv"><input type="range" min="15" max="35" step="1" value="${crit.comfHi}" data-k="comfHi"><b>${crit.comfHi} °C</b></span></label>` +
    `<label>Ratxa a partir de la qual es nota (${mname})<span class="cv"><input type="range" min="15" max="80" step="5" value="${C.gustMid}" data-k="gustMid"><b>${C.gustMid} km/h</b></span></label>` +
    `<label>Ratxa màxima (${mname})<span class="cv"><input type="range" min="20" max="100" step="5" value="${C.gustMax}" data-k="gustMax"><b>${C.gustMax} km/h</b></span></label>`;
  // parets
  $("wList").innerHTML = userWalls.length ? userWalls.map(w => { const z = ZONES.find(z => z.id === w.zone);
    return `<div class="wli"><b>${esc(w.name)}</b><span class="muted">${esc(z ? z.name : "?")} · ${w.segs.length} tram${w.segs.length > 1 ? "s" : ""}</span>${wallTag(w)}` +
      `<button class="btn" type="button" data-wdel="${w.id}">Esborra</button></div><div id="del-${w.id}" hidden></div>`; }).join("") : `<p class="note">Cap paret traçada.</p>`;
  const da = $("wDelAll"); da.innerHTML = "";
  if(userWalls.length > 1) slideConfirm(da, "Llisca per esborrar-les totes", () => { userWalls = []; azFix = {}; store.set("cem_azfix", azFix); saveWalls(); renderAll(); });
}
document.addEventListener("click", e => {
  const b = e.target.closest("button[data-theme]"); if(b){ theme = b.dataset.theme; store.set("cem_theme", theme); applyLook(); renderPanels(); }
  const s = e.target.closest("button[data-size]"); if(s){ size = s.dataset.size; store.set("cem_size", size); applyLook(); renderPanels(); }
  const c = e.target.closest("button[data-cb]"); if(c){ cb = c.dataset.cb; store.set("cem_cb", cb); applyLook(); renderPanels(); }
  const r = e.target.closest("#roleSeg2 button[data-role]"); if(r) setRole(r.dataset.role);
  const k = e.target.closest("#cloSeg button[data-clo]"); if(k){ clo = +k.dataset.clo; store.set("cem_clo", clo); renderPanels(); renderAll(); }
  const d = e.target.closest("button[data-wdel]");
  if(d){ const id = d.dataset.wdel, box = $("del-" + id); box.hidden = false;
    slideConfirm(box, "Llisca per esborrar", () => { userWalls = userWalls.filter(w => w.id !== id); Object.keys(azFix).forEach(k => k.startsWith(id + ":") && delete azFix[k]); store.set("cem_azfix", azFix); saveWalls(); renderAll(); }); }
});
$("crit").addEventListener("input", e => { const i = e.target.closest("input[data-k]"); if(!i) return; const k = i.dataset.k, v = +i.value;
  if(k === "comfLo" || k === "comfHi") crit[k] = v; else crit[mod][k] = v;
  i.nextElementSibling.textContent = v + (k.startsWith("comf") ? " °C" : " km/h"); store.set("cem_crit", crit); });
$("crit").addEventListener("change", () => renderAll());
$("resetCrit").addEventListener("click", () => { crit = structuredClone(CRIT_DEF); store.set("cem_crit", crit); renderPanels(); renderAll(); });
// còpia de seguretat de les parets
$("wExport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({app:"cem-idoneitat", v:1, walls:userWalls, azFix}, null, 1)], {type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "cem-parets-" + localOf(Date.now()).key + ".json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$("wImport").addEventListener("change", async e => {
  const f = e.target.files[0]; if(!f) return;
  try{ const j = JSON.parse(await f.text()); if(!Array.isArray(j.walls)) throw 0;
    const ids = new Set(userWalls.map(w => w.id)); let n = 0;
    j.walls.forEach(w => { if(w && w.id && Array.isArray(w.pts) && Array.isArray(w.segs) && !ids.has(w.id)){ userWalls.push(w); n++; } });
    Object.assign(azFix, j.azFix || {}); store.set("cem_azfix", azFix); saveWalls(); renderAll(); msg(n + " parets importades."); setTimeout(() => msg(null), 4000);
  }catch(err){ msg("El fitxer no és una còpia de parets vàlida.", true); }
  e.target.value = "";
});

/* ---------- confirmació lliscant (copiada d'Ocata Vent) ---------- */
function slideConfirm(el, label, onDone){
  el.innerHTML = `<div class="slc" tabindex="0" role="slider" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="slc-t">${esc(label)}</span><span class="slc-k" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span></div>`;
  const tr = el.firstChild, kn = tr.querySelector(".slc-k"); let x0 = null, dx = 0, max = 0;
  const set = v => { dx = Math.max(0, Math.min(max, v)); kn.style.transform = `translateX(${dx}px)`; tr.style.setProperty("--p", max ? dx / max : 0); tr.setAttribute("aria-valuenow", String(Math.round(max ? dx / max * 100 : 0))); };
  const done = () => { tr.classList.add("ok"); set(max); setTimeout(onDone, 120); };
  kn.addEventListener("pointerdown", e => { max = tr.clientWidth - kn.offsetWidth - 8; x0 = e.clientX - dx; kn.setPointerCapture(e.pointerId); e.preventDefault(); });
  kn.addEventListener("pointermove", e => { if(x0 != null) set(e.clientX - x0); });
  const up = () => { if(x0 == null) return; x0 = null; if(dx >= max * 0.9) done(); else set(0); };
  kn.addEventListener("pointerup", up); kn.addEventListener("pointercancel", up);
  tr.addEventListener("keydown", e => { if(e.key !== "ArrowRight" && e.key !== "End") return; max = tr.clientWidth - kn.offsetWidth - 8; e.preventDefault(); set(e.key === "End" ? max : dx + max / 4); if(dx >= max * 0.99) done(); });
}

/* ---------- eines del mapa ---------- */
$("layerBtn").addEventListener("click", () => { const p = $("layerPanel"); p.hidden = !p.hidden; $("layerBtn").setAttribute("aria-expanded", String(!p.hidden)); });
$("baseSeg").addEventListener("click", e => { const b = e.target.closest("button[data-base]"); if(!b) return; base = b.dataset.base; store.set("cem_base", base); applyBase(); });
[["lySlope", "slope"], ["lyRadar", "radar"], ["lyWind", "wind"], ["lyWalls", "walls"]].forEach(([id, k]) =>
  $(id).addEventListener("change", e => { ly[k] = e.target.checked; store.set("cem_ly", ly); applyLayers(); }));
$("terrainBtn").addEventListener("click", () => { t3d = !t3d; store.set("cem_3d", t3d); apply3D(); });
$("locBtn").addEventListener("click", () => {
  if(!navigator.geolocation){ msg("Aquest mòbil no dona la ubicació.", true); return; }
  navigator.geolocation.getCurrentPosition(p => map.flyTo({center:[p.coords.longitude, p.coords.latitude], zoom: 11}),
    () => { msg("No s'ha pogut obtenir la ubicació.", true); setTimeout(() => msg(null), 4000); }, {timeout:10000});
});

/* ---------- instal·lació i funcionament sense connexió ---------- */
let deferred = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; $("install").hidden = false; });
$("install").addEventListener("click", async () => { if(!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $("install").hidden = true; });
if("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
addEventListener("online", load);
// Torna a carregar si l'app ha estat en segon pla més d'una hora
document.addEventListener("visibilitychange", () => { if(!document.hidden && DATA && Date.now() - DATA.at > 3600e3) load(); });

/* ---------- inici ---------- */
applyLook(); renderPanels(); load();
