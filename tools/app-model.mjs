// Model de l'app per a les eines de GitHub Actions (heat-build.mjs, fc-build.mjs).
// El model NO es copia: s'agafen les seccions d'app.js tal com són. Si canvien els títols de secció, això falla
// (i és el que volem: millor un procés aturat que unes dades calculades amb un model diferent del de l'app).
import fs from "node:fs";
import vm from "node:vm";

export const MOCK = !!process.env.HEAT_MOCK;   // dades inventades, per provar sense xarxa
const read = f => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const APP = read("app.js");
const cut = (a, b) => { const i = APP.indexOf(a), j = APP.indexOf(b, i + 1);
  if(i < 0 || j < 0) throw new Error("No trobo la secció d'app.js: " + a); return APP.slice(i, j); };
const one = re => { const m = APP.match(re); if(!m) throw new Error("No trobo a app.js: " + re); return m[0]; };

const SRC = [
  read("zones.js"), read("zones-osm.js"),
  cut("/* ---------- utilitats", "/* ---------- preferències"),
  one(/const CRIT_DEF = \{[\s\S]*?\n\};/), one(/function hzAt\(.*\n/), one(/function distM\(a, b\)\{[^\n]*\n[^\n]*\n/),
  "let mod = 'esportiva', role = 'climb', clo = 1, slot = 'dia', DATA = null; let crit = structuredClone(CRIT_DEF);",
  cut("/* ---------- catàleg", "// Preferits (en aquest mòbil)"),          // ZONES amb les d'OSM fusionades, com a l'app
  cut("/* ---------- posició del sol", "/* ---------- parets"),
  cut("/* ---------- dades: Open-Meteo", "// Còpia per obrir sense connexió"),
  cut("/* ---------- model:", "const FR_TXT"),
  `globalThis.M = {ZONES, OSM_ZONES, HV, SHORT, omURL, parseOM, fcHydrate, evalSeries, frSlot, localOf, TZ, distM,
     set(m, r){ mod = m; role = r; crit = structuredClone(CRIT_DEF); clo = 1; }};`
].join("\n;\n");
const ctx = vm.createContext({console, Intl, Date, Math, JSON, structuredClone, Object, Array,
  window: {}, document: {getElementById: () => null}, localStorage: {getItem: () => null, setItem(){}}});
vm.runInContext(SRC, ctx, {filename: "model-app.js"});
export const M = ctx.M;

export const sleep = ms => new Promise(r => setTimeout(r, ms));
// Baixa una adreça d'Open-Meteo (amb reintents). Retorna sempre una llista (una resposta per lloc).
export async function getOM(url){
  if(MOCK) return mock(url);
  for(let t = 1; ; t++){
    const r = await fetch(url);
    if(r.ok){ const j = await r.json(); return Array.isArray(j) ? j : [j]; }
    if(t >= 4) throw new Error("Open-Meteo HTTP " + r.status + ": " + (await r.text()).slice(0, 200));
    await sleep(r.status === 429 ? 65000 : 5000 * t);   // 429 = límit per minut: s'espera i es torna a provar
  }
}
// Dades inventades (pluja al nord avui, vent al nord-est), les mateixes que fan servir les proves de l'app
function mock(url){
  const q = new URL(url).searchParams, lats = q.get("latitude").split(",").map(Number), lons = q.get("longitude").split(",").map(Number);
  const past = +(q.get("past_days") || 0), fd = +(q.get("forecast_days") || 7);
  const t0 = (Math.floor(Date.now() / 86400e3) - past) * 86400 - 7200, n = (past + fd) * 24;
  return lats.map((la, x) => { const lo = lons[x], H = {time: Array.from({length: n}, (_, i) => t0 + 3600 * i)}, f = {};
    for(let i = 0; i < n; i++){ const hr = i % 24, d = Math.floor(i / 24), sun = Math.max(0, Math.sin((hr - 7) / 12 * Math.PI));
      const T = Math.round((8 + 14 * sun - (la - 41) * 6 + (1.5 - Math.abs(lo - 1.5)) * 2) * 10) / 10, rain = la > 42.15 && d === past ? 1.2 : 0, w = 10 + Math.max(0, lo - 2.4) * 40;
      const r1 = x => Math.round(x * 10) / 10;           // mateixa precisió que Open-Meteo
      const v = {temperature_2m: T, relative_humidity_2m: Math.round(55 + (la - 41) * 15), dew_point_2m: r1(T - 12), precipitation: rain, precipitation_probability: rain ? 80 : 10,
        weather_code: rain ? 61 : 1, wind_speed_10m: r1(w), wind_gusts_10m: r1(w * 1.6), wind_direction_10m: 320, shortwave_radiation_instant: r1(700 * sun),
        direct_normal_irradiance_instant: r1(600 * sun), diffuse_radiation_instant: r1(120 * sun), cape: 0};
      for(const k in v) (f[k] = f[k] || []).push(v[k]); }
    Object.assign(H, f); const days = Array.from({length: past + fd}, (_, d) => t0 + 86400 * d + 7200);
    return {elevation: 600, hourly: H, daily: {time: days, sunrise: days.map(x => x + 5 * 3600), sunset: days.map(x => x + 16 * 3600)}}; });
}
