// Construeix heat.json: la capa «Idoneïtat amb colors» ja calculada per a tothom (GitHub Actions, cada 3 h).
// Ús: node tools/heat-build.mjs [sortida.json]      (HEAT_MOCK=1 = dades inventades, per provar sense xarxa)
//
// Graella cada 0,1° a menys de REACH de qualsevol zona (zones.js + zones-osm.js). Per a cada punt es baixa la
// previsió d'Open-Meteo i es calcula la mateixa nota que fa l'app per a una zona sense parets (sense orientació,
// roca calcària), amb els llindars per defecte i roba normal, per a cada combinació de modalitat (esportiva |
// clàssica) i persona (escalant | assegurant), cada dia i cada franja (matí | tarda | dia).
// El model NO es copia: s'agafen les seccions d'app.js tal com són (si canvien els títols de secció, això falla).
import fs from "node:fs";
import vm from "node:vm";

const OUT = process.argv[2] || "heat.json";
const MOCK = !!process.env.HEAT_MOCK;
const STEP = 0.1, REACH = 26000, DAYS = 8;      // REACH = R_OUT (20 km) + marge, igual que heat.js
const read = f => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");

// ---------- model d'app.js ----------
const APP = read("app.js");
const cut = (a, b) => { const i = APP.indexOf(a), j = APP.indexOf(b, i + 1);
  if(i < 0 || j < 0) throw new Error("No trobo la secció d'app.js: " + a); return APP.slice(i, j); };
const one = re => { const m = APP.match(re); if(!m) throw new Error("No trobo a app.js: " + re); return m[0]; };
const crit = [one(/const CRIT_DEF = \{[\s\S]*?\n\};/)], hzAt = one(/function hzAt\(.*\n/);
const SRC = [
  read("zones.js"), read("zones-osm.js"),
  cut("/* ---------- utilitats", "/* ---------- preferències"),
  crit[0], hzAt,
  "let mod = 'esportiva', role = 'climb', clo = 1, slot = 'dia', DATA = null; let crit = structuredClone(CRIT_DEF);",
  cut("/* ---------- posició del sol", "/* ---------- parets"),
  cut("/* ---------- dades: Open-Meteo", "// Còpia per obrir sense connexió"),
  cut("/* ---------- model:", "const FR_TXT"),
  `globalThis.M = {ZONES, OSM_ZONES, HV, parseOM, evalSeries, frSlot, TZ,
     set(m, r){ mod = m; role = r; crit = structuredClone(CRIT_DEF); clo = 1; }};`
].join("\n;\n");
const ctx = vm.createContext({console, Intl, Date, Math, JSON, structuredClone, document: {getElementById: () => null}, localStorage: {getItem: () => null, setItem(){}}});
vm.runInContext(SRC, ctx, {filename: "model-app.js"});
const M = ctx.M;

// ---------- graella ----------
const RAD = Math.PI / 180;
const distM = (a, b) => { const dla = (b[1] - a[1]) * RAD, dlo = (b[0] - a[0]) * RAD;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dlo / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(h)); };
const zones = M.ZONES.concat(M.OSM_ZONES), cells = new Map();
zones.forEach(z => {
  const ic = Math.round(z.lat / STEP), jc = Math.round(z.lon / STEP);
  for(let i = ic - 3; i <= ic + 3; i++) for(let j = jc - 4; j <= jc + 4; j++)
    if(distM([z.lon, z.lat], [j * STEP, i * STEP]) < REACH) cells.set(i + "," + j, {i, j, lat: +(i * STEP).toFixed(2), lon: +(j * STEP).toFixed(2)});
});
const P = [...cells.values()].sort((a, b) => a.i - b.i || a.j - b.j);
console.log(`${zones.length} zones → ${P.length} punts de graella`);

// ---------- Open-Meteo ----------
const url = b => "https://api.open-meteo.com/v1/forecast?latitude=" + b.map(p => p.lat).join(",") + "&longitude=" + b.map(p => p.lon).join(",") +
  "&hourly=" + M.HV.join(",") + "&daily=sunrise,sunset&timeformat=unixtime&timezone=" + encodeURIComponent(M.TZ) +
  "&past_days=3&forecast_days=" + DAYS + "&wind_speed_unit=kmh";
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(b){
  if(MOCK) return mock(b);
  for(let t = 1; ; t++){
    const r = await fetch(url(b));
    if(r.ok){ const j = await r.json(); return Array.isArray(j) ? j : [j]; }
    if(t >= 4) throw new Error("Open-Meteo HTTP " + r.status + ": " + (await r.text()).slice(0, 200));
    await sleep(r.status === 429 ? 65000 : 5000 * t);   // 429 = límit per minut: s'espera i es torna a provar
  }
}
// Dades inventades (pluja al nord avui, vent al nord-est), per provar l'app i aquest script sense xarxa
function mock(b){
  const past = 3, t0 = (Math.floor(Date.now() / 86400e3) - past) * 86400 - 7200, n = (past + DAYS) * 24;
  return b.map(p => { const H = {time: Array.from({length: n}, (_, i) => t0 + 3600 * i)}, f = {};
    for(let i = 0; i < n; i++){ const hr = i % 24, d = Math.floor(i / 24), sun = Math.max(0, Math.sin((hr - 7) / 12 * Math.PI));
      const T = Math.round((8 + 14 * sun - (p.lat - 41) * 6 + (1.5 - Math.abs(p.lon - 1.5)) * 2) * 10) / 10, rain = p.lat > 42.15 && d === past ? 1.2 : 0, w = 10 + Math.max(0, p.lon - 2.4) * 40;
      const v = {temperature_2m: T, relative_humidity_2m: 55 + (p.lat - 41) * 15, dew_point_2m: Math.round((T - 12) * 10) / 10, precipitation: rain, precipitation_probability: rain ? 80 : 10,
        weather_code: rain ? 61 : 1, wind_speed_10m: w, wind_gusts_10m: w * 1.6, wind_direction_10m: 320, shortwave_radiation_instant: 700 * sun,
        direct_normal_irradiance_instant: 600 * sun, diffuse_radiation_instant: 120 * sun, cape: 0};
      for(const k in v) (f[k] = f[k] || []).push(v[k]); }
    Object.assign(H, f); const days = Array.from({length: past + DAYS}, (_, d) => t0 + 86400 * d + 7200);
    return {elevation: 600, hourly: H, daily: {time: days, sunrise: days.map(x => x + 5 * 3600), sunset: days.map(x => x + 16 * 3600)}}; });
}

// ---------- càlcul ----------
const COMBOS = [["esportiva", "climb"], ["esportiva", "belay"], ["classica", "climb"], ["classica", "belay"]];
const SL = ["am", "pm", "dia"], today = new Intl.DateTimeFormat("en-CA", {timeZone: M.TZ}).format(new Date());
let days = null; const val = {};          // val["mod|role"][dia][franja] = Uint8Array(P.length): nota × 10, 255 = sense dades
for(let n = 0; n < P.length; n += 50){
  const b = P.slice(n, n + 50), arr = await get(b), out = {zones: {}}, fz = b.map((p, x) => ({id: "c" + (n + x)}));
  M.parseOM(arr, fz, out);
  b.forEach((p, x) => {
    const o = out.zones[fz[x].id], z = {id: fz[x].id, lat: p.lat, lon: p.lon, alt: arr[x].elevation ?? 500, rock: "calcaria"};
    if(!days) days = [...new Set(o.loc.map(l => l.key))].filter(k => k >= today).sort().slice(0, DAYS);
    COMBOS.forEach(([m, r]) => {
      M.set(m, r);
      const ev = {z, o, zoneRows: M.evalSeries(z, null, null, null, o), segs: []}, c = val[m + "|" + r] = val[m + "|" + r] || {};
      days.forEach(d => { c[d] = c[d] || Object.fromEntries(SL.map(s => [s, new Uint8Array(P.length).fill(255)]));
        SL.forEach(s => { const v = M.frSlot(ev, d, s); if(v.sc != null) c[d][s][n + x] = Math.round(v.sc * 10); }); });
    });
  });
  if(!MOCK) await sleep(400);
  process.stdout.write(`\r${Math.min(n + 50, P.length)}/${P.length}`);
}
const b64 = u => Buffer.from(u).toString("base64");
const J = {v: 1, at: Date.now(), step: STEP, days, src: MOCK ? "mock" : "open-meteo",
  cells: P.flatMap(p => [p.i, p.j]),
  vals: Object.fromEntries(Object.entries(val).map(([k, c]) => [k, Object.fromEntries(Object.entries(c).map(([d, s]) => [d, Object.fromEntries(SL.map(x => [x, b64(s[x])]))]))]))};
fs.writeFileSync(OUT, JSON.stringify(J));
console.log(`\n${OUT}: ${P.length} punts · ${days.length} dies · ${(fs.statSync(OUT).size / 1024).toFixed(0)} kB`);
