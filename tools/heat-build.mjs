// Construeix heat.json: la capa «Idoneïtat amb colors» ja calculada per a tothom (GitHub Actions, cada 3 h).
// Ús: node tools/heat-build.mjs [sortida.json]      (HEAT_MOCK=1 = dades inventades, per provar sense xarxa)
//
// Graella cada 0,1° a menys de REACH de qualsevol zona (zones.js + zones-osm.js). Per a cada punt es baixa la
// previsió d'Open-Meteo i es calcula la mateixa nota que fa l'app per a una zona sense parets (sense orientació,
// roca calcària), amb els llindars per defecte i roba normal, per a cada combinació de modalitat (esportiva |
// clàssica) i persona (escalant | assegurant), cada dia i cada franja (matí | tarda | dia).
// El model NO es copia: el carrega tools/app-model.mjs a partir d'app.js.
// També hi va «rain»: mil·límetres previstos a cada punt per dia i franja (× 10, 255 = sense dades), per a la capa
// Pluja els dies que no són avui (heat.js). Surt de la mateixa previsió: cap crida més a Open-Meteo.
import fs from "node:fs";
import {M, MOCK, getOM, sleep} from "./app-model.mjs";

const OUT = process.argv[2] || "heat.json";
const STEP = 0.1, REACH = 26000, DAYS = 8;      // REACH = R_OUT (20 km) + marge, igual que heat.js

// ---------- graella ----------
const RAD = Math.PI / 180;
const distM = (a, b) => { const dla = (b[1] - a[1]) * RAD, dlo = (b[0] - a[0]) * RAD;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dlo / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(h)); };
const zones = M.ZONES, cells = new Map();   // les mateixes zones que l'app (OSM ja fusionades)
zones.forEach(z => {
  const ic = Math.round(z.lat / STEP), jc = Math.round(z.lon / STEP);
  for(let i = ic - 3; i <= ic + 3; i++) for(let j = jc - 4; j <= jc + 4; j++)
    if(distM([z.lon, z.lat], [j * STEP, i * STEP]) < REACH) cells.set(i + "," + j, {i, j, lat: +(i * STEP).toFixed(2), lon: +(j * STEP).toFixed(2)});
});
const P = [...cells.values()].sort((a, b) => a.i - b.i || a.j - b.j);
console.log(`${zones.length} zones → ${P.length} punts de graella`);

// ---------- Open-Meteo (mateixa petició que heat.js) ----------
const url = b => "https://api.open-meteo.com/v1/forecast?latitude=" + b.map(p => p.lat).join(",") + "&longitude=" + b.map(p => p.lon).join(",") +
  "&hourly=" + M.HV.join(",") + "&daily=sunrise,sunset&timeformat=unixtime&timezone=" + encodeURIComponent(M.TZ) +
  "&past_days=3&forecast_days=" + DAYS + "&wind_speed_unit=kmh";

// ---------- càlcul ----------
const COMBOS = [["esportiva", "climb"], ["esportiva", "belay"], ["classica", "climb"], ["classica", "belay"]];
const SL = ["am", "pm", "dia"], today = new Intl.DateTimeFormat("en-CA", {timeZone: M.TZ}).format(new Date());
let days = null; const val = {}, rain = {};
const RAIN_H = {am: [8, 13], pm: [14, 19], dia: [8, 19]};   // com a heat.js          // val["mod|role"][dia][franja] = Uint8Array(P.length): nota × 10, 255 = sense dades
for(let n = 0; n < P.length; n += 50){
  const b = P.slice(n, n + 50), arr = await getOM(url(b)), out = {zones: {}}, fz = b.map((p, x) => ({id: "c" + (n + x)}));
  M.parseOM(arr, fz, out);
  b.forEach((p, x) => {
    const o = out.zones[fz[x].id], z = {id: fz[x].id, lat: p.lat, lon: p.lon, alt: arr[x].elevation ?? 500, rock: "calcaria"};
    if(!days) days = [...new Set(o.loc.map(l => l.key))].filter(k => k >= today).sort().slice(0, DAYS);
    days.forEach(d => { rain[d] = rain[d] || Object.fromEntries(SL.map(s => [s, new Uint8Array(P.length).fill(255)]));
      SL.forEach(s => { const [h0, h1] = RAIN_H[s]; let mm = 0, k = 0;
        o.t.forEach((t, i) => { const l = o.loc[i]; if(l.key === d && l.h >= h0 && l.h <= h1){ mm += o.P[i] || 0; k++; } });
        if(k) rain[d][s][n + x] = Math.min(254, Math.round(mm * 10)); }); });
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
  rain: Object.fromEntries(Object.entries(rain).map(([d, s]) => [d, Object.fromEntries(SL.map(x => [x, b64(s[x])]))])),
  vals: Object.fromEntries(Object.entries(val).map(([k, c]) => [k, Object.fromEntries(Object.entries(c).map(([d, s]) => [d, Object.fromEntries(SL.map(x => [x, b64(s[x])]))]))]))};
fs.writeFileSync(OUT, JSON.stringify(J));
console.log(`\n${OUT}: ${P.length} punts · ${days.length} dies · ${(fs.statSync(OUT).size / 1024).toFixed(0)} kB`);
