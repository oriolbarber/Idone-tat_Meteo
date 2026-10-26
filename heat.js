/* ============ CEM · capa d'idoneïtat (colors per sota de les zones) ============ */
// Graella de punts d'Open-Meteo (cada 0,1°) al voltant de les zones que es veuen. A cada punt es calcula la
// mateixa nota que una zona sense parets (meteo general: sense orientació ni sol/ombra de paret, roca calcària)
// per al dia i la franja triats, i es pinta com una imatge suavitzada per sota dels marcadors.
// Només es pinta a prop de les zones (com BoletRadar, que només pinta sobre bosc): lluny no s'hi fa cap estimació.
// Font de les notes: primer heat.json, que GitHub Actions calcula cada 3 h per a totes les zones (tools/heat-build.mjs,
// branca «dades»), amb els llindars per defecte i roba normal. Els punts que no hi són (zones noves) i els casos en
// què el fitxer no arriba es calculen al mòbil amb Open-Meteo, com abans.
// També pinta la PLUJA PREVISTA (Capes ▸ Pluja) quan el dia enfocat no és avui: mil·límetres de la franja a cada
// punt de la mateixa graella (heat.json la porta a «rain»; si no, de la previsió baixada al mòbil). Avui mana el radar.
"use strict";
window.CEM_H = (function(){
  const STEP = 0.1;                  // graus entre punts de la graella (~11 × 8 km)
  const R_IN = 10000, R_OUT = 20000; // color ple fins a R_IN de la zona més propera; s'esvaeix fins a R_OUT
  const TTL = 3600e3;                // la graella es torna a baixar al cap d'una hora
  const PX = 10;                     // píxels de la imatge per cel·la
  const MAXC = 700;                  // més cel·les que això (vista molt allunyada) = no es pinta
  const DAYS = 8;                    // dies de previsió de la capa (els marcadors en tenen 16)
  const OPAC = 0.5;
  const cells = new Map();           // "i,j" → {lat, lon, o, at, alt}
  const evs = new Map();             // "i,j|criteris" → avaluació
  const PRE_URL = window.CEM_HEAT_URL || "https://raw.githubusercontent.com/oriolbarber/Idone-tat_Meteo/dades/heat.json";
  const PRE_TTL = 30 * 60e3;         // es torna a mirar si hi ha fitxer nou cada mitja hora
  const PRE_OLD = 12 * 3600e3;       // amb connexió, un fitxer de més de 12 h no es fa servir (Actions aturat?)
  let pre = null, preTried = 0;      // {at, days, idx: Map("i,j" → posició), vals, dec: Map}
  let thr = store.get("cem_heat_thr", 0);
  let busy = false, again = false, timer = null, lastErr = false;

  const kOf = (i, j) => i + "," + j;
  const inView = (b, z, pad) => z.lat > b.getSouth() - pad && z.lat < b.getNorth() + pad && z.lon > b.getWest() - pad * 1.4 && z.lon < b.getEast() + pad * 1.4;
  const zonesNear = () => { const b = map.getBounds(); return shown().filter(z => inView(b, z, 0.3)); };

  // Cel·les a menys de R_OUT d'alguna zona visible
  function needed(zs){
    const s = new Map();
    zs.forEach(z => {
      const ic = Math.round(z.lat / STEP), jc = Math.round(z.lon / STEP);
      for(let i = ic - 3; i <= ic + 3; i++) for(let j = jc - 4; j <= jc + 4; j++){
        const lat = +(i * STEP).toFixed(2), lon = +(j * STEP).toFixed(2);   // igual que tools/heat-build.mjs
        if(distM([z.lon, z.lat], [lon, lat]) < R_OUT + 6000) s.set(kOf(i, j), {i, j, lat, lon});
      }
    });
    return s;
  }
  function url(pts){
    return "https://api.open-meteo.com/v1/forecast?latitude=" + pts.map(p => p.lat.toFixed(2)).join(",") +
      "&longitude=" + pts.map(p => p.lon.toFixed(2)).join(",") +
      "&hourly=" + HV.join(",") + "&daily=sunrise,sunset&timeformat=unixtime&timezone=" + encodeURIComponent(TZ) +
      "&past_days=3&forecast_days=" + DAYS + "&wind_speed_unit=kmh";
  }
  async function fetchMissing(need){
    const now = Date.now(), miss = [...need.values()].filter(p => { const k = kOf(p.i, p.j), c = cells.get(k);
      return !(inPre(k) && (!rainOn() || pre.rain)) && (!c || now - c.at > TTL); });
    if(!miss.length) return;
    note(`Carregant la capa… 0/${miss.length}`);
    for(let n = 0; n < miss.length; n += 50){
      const b = miss.slice(n, n + 50), r = await fetch(url(b));
      if(!r.ok) throw new Error("HTTP " + r.status);
      let arr = await r.json(); if(!Array.isArray(arr)) arr = [arr];
      const fz = b.map(p => ({id: "h" + kOf(p.i, p.j)})), out = {zones:{}};
      parseOM(arr, fz, out);
      b.forEach((p, x) => { const k = kOf(p.i, p.j); cells.set(k, {...p, o: out.zones[fz[x].id], alt: arr[x].elevation ?? 500, at: now});
        [...evs.keys()].forEach(e => e.startsWith(k + "|") && evs.delete(e)); });
      note(`Carregant la capa… ${Math.min(n + 50, miss.length)}/${miss.length}`);
      draw();                                             // es va pintant a mesura que arriba
    }
  }

  // ---------- fitxer precalculat (heat.json) ----------
  function usePre(j, from){
    if(!j || j.v !== 1 || !Array.isArray(j.cells)) return false;
    const idx = new Map(); for(let n = 0; n < j.cells.length; n += 2) idx.set(kOf(j.cells[n], j.cells[n + 1]), n / 2);
    pre = {at: j.at, days: j.days, idx, vals: j.vals, rain: j.rain || null, dec: new Map(), from}; return true;
  }
  async function loadPre(){
    if(Date.now() - preTried < PRE_TTL && pre) return;
    preTried = Date.now();
    try{
      const r = await fetch(PRE_URL, {cache: "no-cache"}); if(!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if(Date.now() - j.at > PRE_OLD) throw new Error("vell");
      if(usePre(j, "net")) dPut("heat", j);              // còpia per a sense connexió (Cache Storage, vegeu app.js)
    }catch(e){
      // sense connexió o fitxer vell: la còpia desada si és de menys de 2 dies; si no, tot al mòbil
      const old = await dGet("heat");
      if(!pre && old && Date.now() - old.at < 48 * 3600e3) usePre(old, "copia"); else if(pre && Date.now() - pre.at > 48 * 3600e3) pre = null;
    }
  }
  // nota (0–10) d'un punt del fitxer per a un dia i franja; null = no hi és
  function preVal(n, d, s){
    const key = mod + "|" + role, dk = key + "|" + d + "|" + s;
    let u = pre.dec.get(dk);
    if(u === undefined){ const b = pre.vals[key] && pre.vals[key][d] && pre.vals[key][d][s];
      u = b ? Uint8Array.from(atob(b), ch => ch.charCodeAt(0)) : null; pre.dec.set(dk, u); }
    if(!u || u[n] === 255) return null; return u[n] / 10;
  }
  const inPre = k => pre && pre.idx.has(k);

  // Nota d'una cel·la per al dia o dies triats i la franja (null = sense dades)
  function score(k, c){
    const ks = selDays.length > 1 ? selDays : [dayKey];
    if(inPre(k)){ const n = pre.idx.get(k), v = ks.map(d => preVal(n, d, slot)).filter(x => x != null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
    if(!c || !c.o) return null;
    const ck = k + "|" + [mod, role, clo, JSON.stringify(crit)].join("|");
    let ev = evs.get(ck);
    if(!ev){ const z = {id: "h" + k, lat: c.lat, lon: c.lon, alt: c.alt, rock: "calcaria"};
      ev = {z, o: c.o, zoneRows: evalSeries(z, null, null, null, c.o), segs: []}; evs.set(ck, ev); }
    const v = ks.map(d => frSlot(ev, d).sc).filter(x => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }

  // ---------- pluja prevista ----------
  // Capa «Pluja» activa i dia enfocat diferent d'avui (avui es veu el radar de RainViewer, a app.js)
  const rainOn = () => !!ly.radar && dayKey !== localOf(Date.now()).key;
  const RAIN_H = {am:[8, 13], pm:[14, 19], dia:[8, 19]};   // com a tools/heat-build.mjs
  // mil·límetres previstos en un punt per al dia enfocat i la franja (null = sense dades)
  function rainVal(k, c){
    if(inPre(k) && pre.rain){
      const dk = "rain|" + dayKey + "|" + slot; let u = pre.dec.get(dk);
      if(u === undefined){ const b = pre.rain[dayKey] && pre.rain[dayKey][slot]; u = b ? Uint8Array.from(atob(b), ch => ch.charCodeAt(0)) : null; pre.dec.set(dk, u); }
      if(u && u[pre.idx.get(k)] !== 255) return u[pre.idx.get(k)] / 10;
    }
    if(!c || !c.o) return null;
    const [h0, h1] = RAIN_H[slot]; let mm = 0, n = 0;
    c.o.t.forEach((t, i) => { const l = c.o.loc[i]; if(l.key === dayKey && l.h >= h0 && l.h <= h1){ mm += c.o.P[i] || 0; n++; } });
    return n ? mm : null;
  }
  // Colors com un radar (blau → verd → groc → vermell). Amb la capa d'idoneïtat a sota, en gris fosc (com el radar).
  const RAIN_ST = [[0.2, [170, 215, 255]], [1, [70, 150, 255]], [3, [30, 90, 215]], [6, [30, 170, 80]], [10, [240, 200, 0]], [18, [255, 120, 0]], [30, [215, 0, 40]]];
  function rainCol(mm){
    if(mm < 0.2) return null;
    let c = RAIN_ST[RAIN_ST.length - 1][1];
    for(let s = 1; s < RAIN_ST.length; s++) if(mm <= RAIN_ST[s][0]){ const [a0, c0] = RAIN_ST[s - 1], [a1, c1] = RAIN_ST[s], t = (mm - a0) / (a1 - a0);
      c = c0.map((x, i) => x + (c1[i] - x) * t); break; }
    const a = clamp((mm - 0.2) / 0.8, 0.35, 1);
    if(ly.heat){ const gr = 70 - Math.min(40, mm * 3); return [gr, gr, gr, a * 0.75]; }
    return [c[0], c[1], c[2], a];
  }

  // Colors: els mateixos dels marcadors (segueixen tema i daltonisme), en rampa contínua
  function rgb(v){ const c = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const h = c.replace("#", ""); return [0, 2, 4].map(x => parseInt(h.substr(x, 2), 16)); }
  function ramp(){
    const no = rgb("--no"), mid = rgb("--mid"), ok = rgb("--ok"), mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
    const stops = [[0, no], [3, no], [4.5, mid], [6, mid], [7.5, ok], [10, ok]];
    return sc => { for(let s = 1; s < stops.length; s++) if(sc <= stops[s][0]){ const [a0, c0] = stops[s - 1], [a1, c1] = stops[s];
      return mix(c0, c1, a1 === a0 ? 0 : (sc - a0) / (a1 - a0)); } return ok; };
  }
  const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2));
  const latOf = y => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;

  const canv = {};
  function draw(){
    drawRain();
    if(!ly.heat || !DATA || !map.getLayer("zones-hit")) return hide();
    const zs = zonesNear(), need = needed(zs);
    if(!need.size || need.size > MAXC){ hide(); if(need.size > MAXC) note("Acosta't una mica per veure la capa de colors."); return; }
    const col = ramp();
    raster("heat", zs, need, k => score(k, cells.get(k)), sc => { if(sc < thr) return null; const c = col(sc); return [c[0], c[1], c[2], 1]; }, OPAC);
    $("heatLeg").hidden = false;
  }
  function drawRain(){
    const L = $("rainLeg");
    if(!rainOn() || !DATA || !map.getLayer("zones-hit")){ if(map.getLayer("rainfc")) map.setLayoutProperty("rainfc", "visibility", "none"); if(L) L.hidden = true; return; }
    const zs = zonesNear(), need = needed(zs);
    if(!need.size || need.size > MAXC){ if(map.getLayer("rainfc")) map.setLayoutProperty("rainfc", "visibility", "none"); if(L) L.hidden = true; return; }
    raster("rainfc", zs, need, k => rainVal(k, cells.get(k)), rainCol, 0.8);
    if(L){ L.hidden = false; L.classList.toggle("grey", !!ly.heat); $("rainLegT").textContent = "Pluja prevista · " + dayLbl(dayKey, true).toLowerCase() + " · " + FR_TXT[slot].toLowerCase(); }
  }
  // Pinta una imatge suavitzada de la graella per sota dels marcadors (només a prop de les zones)
  function raster(id, zs, need, valOf, colOf, opac){
    let i0 = 1e9, i1 = -1e9, j0 = 1e9, j1 = -1e9;
    need.forEach(p => { i0 = Math.min(i0, p.i); i1 = Math.max(i1, p.i); j0 = Math.min(j0, p.j); j1 = Math.max(j1, p.j); });
    const ni = i1 - i0 + 1, nj = j1 - j0 + 1, V = new Float32Array(ni * nj).fill(NaN);
    need.forEach(p => { const k = kOf(p.i, p.j), s = valOf(k); if(s != null) V[(p.i - i0) * nj + (p.j - j0)] = s; });
    // imatge: columnes uniformes en longitud, files uniformes en Mercator (com el mapa)
    const W = nj * PX, H = ni * PX;
    const west = (j0 - 0.5) * STEP, east = (j1 + 0.5) * STEP, north = (i1 + 0.5) * STEP, south = (i0 - 0.5) * STEP;
    const yN = mercY(north), yS = mercY(south);
    const canvas = canv[id] = canv[id] || document.createElement("canvas"); canvas.width = W; canvas.height = H;
    const g = canvas.getContext("2d"), img = g.createImageData(W, H), d = img.data;
    const zl = zs.map(z => [z.lat, z.lon, Math.cos(z.lat * RAD)]);
    for(let y = 0; y < H; y++){
      const lat = latOf(yN + (yS - yN) * (y + 0.5) / H), fi = lat / STEP - i0, ia = Math.floor(fi), ty = fi - ia;
      for(let x = 0; x < W; x++){
        const lon = west + (east - west) * (x + 0.5) / W;
        // distància a la zona més propera (aproximació plana, prou bona a 20 km)
        let dm = 1e12; for(const q of zl){ const dy = (lat - q[0]) * 111195, dx = (lon - q[1]) * 111195 * q[2], dd = dx * dx + dy * dy; if(dd < dm) dm = dd; }
        dm = Math.sqrt(dm); if(dm >= R_OUT) continue;
        // interpolació bilineal de la nota entre els 4 punts veïns (sense els que no tenen dades)
        const fj = lon / STEP - j0, ja = Math.floor(fj), tx = fj - ja;
        let sw = 0, sv = 0;
        for(const [di, dj, w] of [[0, 0, (1 - ty) * (1 - tx)], [0, 1, (1 - ty) * tx], [1, 0, ty * (1 - tx)], [1, 1, ty * tx]]){
          const a = ia + di, b = ja + dj; if(a < 0 || b < 0 || a >= ni || b >= nj) continue;
          const v = V[a * nj + b]; if(!isNaN(v) && w > 0){ sw += w; sv += v * w; } }
        if(sw < 0.15) continue;
        const c = colOf(sv / sw); if(!c) continue;
        const t = clamp((R_OUT - dm) / (R_OUT - R_IN), 0, 1), al = t * t * (3 - 2 * t);
        const o = (y * W + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = Math.round(255 * al * c[3]);
      }
    }
    g.putImageData(img, 0, 0);
    const coords = [[west, north], [east, north], [east, south], [west, south]], u = canvas.toDataURL();
    const src = map.getSource(id);
    if(src) src.updateImage({url: u, coordinates: coords});
    else{
      map.addSource(id, {type:"image", url: u, coordinates: coords});
      // la pluja sempre per sobre de la capa d'idoneïtat
      const before = id === "heat" && map.getLayer("rainfc") ? "rainfc" : "zones-hit";
      map.addLayer({id, type:"raster", source:id, paint:{"raster-opacity": opac, "raster-fade-duration": 0, "raster-resampling":"linear"}}, before);
    }
    map.setLayoutProperty(id, "visibility", "visible");
  }
  function hide(){
    if(map.getLayer("heat")) map.setLayoutProperty("heat", "visibility", "none");
    const l = $("heatLeg"); if(l) l.hidden = true;
  }
  function note(t, err){ const n = $("heatNote"); if(!n) return; n.hidden = !t; if(t){ n.textContent = t; n.classList.toggle("err", !!err); } }

  // Torna a calcular (en moure el mapa, canviar de dia o de franja, o de criteris). Agrupa les crides seguides.
  function update(){
    clearTimeout(timer); timer = setTimeout(run, 150);
  }
  async function run(){
    renderUI();
    if((!ly.heat && !rainOn()) || !DATA){ hide(); drawRain(); note(null); return; }
    if(busy){ again = true; return; }
    busy = true;
    try{ await loadPre(); draw();
      const need = needed(zonesNear());
      if(need.size && need.size <= MAXC) await fetchMissing(need);
      lastErr = false; note(pre && ly.heat ? "Capa calculada fa " + ago(pre.at) + (pre.from === "copia" ? " (còpia desada, sense connexió)." : ".") : null);
    }catch(e){ lastErr = true; note("No s'ha pogut carregar tota la " + (ly.heat ? "capa de colors" : "pluja prevista") + " (sense connexió?).", true); }
    busy = false; draw();
    if(again){ again = false; run(); }
  }
  function renderUI(){
    const c = $("lyHeat"); if(c) c.checked = !!ly.heat;
    const r = $("heatThrRow"); if(r) r.hidden = !ly.heat;
    const i = $("heatThr"); if(i){ i.value = thr; $("heatThrV").textContent = thr ? thr : "0 (es veu tot)"; }
  }
  document.addEventListener("input", e => { if(e.target.id !== "heatThr") return; thr = +e.target.value; store.set("cem_heat_thr", thr); renderUI(); draw(); });
  if(map.loaded()) update(); else map.once("load", update);
  return {update, redraw: draw, _dbg: {score, kOf, cells, pre: () => pre}};   // _dbg: per a proves
})();
