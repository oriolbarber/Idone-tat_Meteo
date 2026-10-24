// Construeix fc.json: la previsió en brut de totes les zones (GitHub Actions, cada 3 h), perquè l'app no hagi de
// consultar Open-Meteo zona per zona. Ús: node tools/fc-build.mjs [sortida.json]   (HEAT_MOCK=1 = dades inventades)
//
// Es fan servir les mateixes zones (zones.js + zones-osm.js fusionades com a l'app) i la mateixa adreça (omURL d'app.js).
// Els valors es desen com a enters (valor × escala) perquè el fitxer sigui petit; l'escala és la precisió que dona
// Open-Meteo, de manera que en tornar-los a dividir surt exactament el mateix número. Si no fos així, avisa.
// No hi ha notes calculades: cada mòbil hi aplica els seus llindars, la seva roba i les seves parets.
import fs from "node:fs";
import {M, MOCK, getOM, sleep} from "./app-model.mjs";

const OUT = process.argv[2] || "fc.json";
const SC = {T:10, RH:1, Td:10, P:100, PP:1, WC:1, W:10, G:10, WD:1, GHI:10, DNI:10, DIF:10, CAPE:10};
const zs = M.ZONES;
console.log(`${zs.length} zones`);

const out = {zones: {}};
for(let n = 0; n < zs.length; n += 50){
  const b = zs.slice(n, n + 50);
  M.parseOM(await getOM(M.omURL(b)), b, out);
  if(!MOCK) await sleep(400);
}
// totes les zones han de tenir les mateixes hores (mateixa petició): es desa un sol t0
const first = Object.values(out.zones)[0], t0 = first.t[0], N = first.t.length;
let lossy = 0;
const J = {v: 1, at: Date.now(), src: MOCK ? "mock" : "open-meteo", t0, n: N, sc: SC, zones: {}};
for(const z of zs){
  const o = out.zones[z.id];
  if(o.t[0] !== t0 || o.t.length !== N) throw new Error("Hores diferents a la zona " + z.id);
  const h = {};
  for(const s of Object.keys(SC)){
    h[s] = o[s].map(v => { if(v == null) return null; const q = Math.round(v * SC[s]); if(q / SC[s] !== v) lossy++; return q; });
  }
  const sun = {}; for(const [k, v] of Object.entries(o.sun)) sun[k] = [Math.round(v.rise / 1000), Math.round(v.set / 1000)];
  J.zones[z.id] = {h, sun};
}
fs.writeFileSync(OUT, JSON.stringify(J));
const kB = fs.statSync(OUT).size / 1024;
console.log(`${OUT}: ${zs.length} zones · ${N} hores · ${kB.toFixed(0)} kB` + (lossy ? ` · ${lossy} valors arrodonits` : ""));
if(lossy && !MOCK) console.log("::warning::fc.json: " + lossy + " valors no són exactes amb l'escala actual (revisa SC)");
