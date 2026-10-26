// Construeix zones-osm.js a partir de la resposta de l'Overpass (tools/osm-query.txt).
// Ús: node tools/osm-build.mjs osm-raw.json [--no-elev] [--no-dem] [--recompute]
// Sectors = llocs d'escalada d'OSM (cingles, blocs, climbing=crag). Zones = sectors agrupats per proximitat,
// amb el nom de l'àrea d'OSM (climbing=area) o del poble més proper. Dades © col·laboradors d'OpenStreetMap, ODbL.
import fs from "node:fs";
import {aspect, horizon, parseOri, stats} from "./dem.mjs";

const [, , rawPath = "osm-raw.json", ...flags] = process.argv;
const E = JSON.parse(fs.readFileSync(rawPath, "utf8")).elements;
const RAD = Math.PI / 180;
const dist = (a, b) => { const dla = (b.lat - a.lat) * RAD, dlo = (b.lon - a.lon) * RAD;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dlo / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(h)); };
const pos = e => e.center ? {lat: e.center.lat, lon: e.center.lon} : e.lat != null ? {lat: e.lat, lon: e.lon} : null;
const nameOf = t => (t["name:ca"] || t.name || "").trim();

// Fora: vies ferrades, rocòdroms i instal·lacions artificials, barrancs, rutes
const NOT = /ferrad|ferrata|roc[oò]drom|b[uú]lder planet|cam[ií] equipat|infantil|barranc|canal de les dames|canal del mejill/i;
const skip = t => NOT.test(t.name || "") || NOT.test(t.description || "") || t.highway === "via_ferrata" || t.leisure || t["climbing:rock"] === "no" || /route/.test(t.climbing || "");

const places = [], areas = [], sites = [];
const memberOf = new Map();   // "n123" → nom de l'àrea
for(const e of E){
  const t = e.tags || {}, p = pos(e); if(!p) continue;
  if(t.place && !t.sport && !t.climbing){ places.push({name: nameOf(t), ...p}); continue; }
  if(t.climbing === "area"){ areas.push({name: nameOf(t), ...p});
    (e.members || []).forEach(m => memberOf.set(m.type[0] + m.ref, nameOf(t))); continue; }
  if(skip(t)) continue;
  sites.push({osm: e.type[0] + e.id, name: nameOf(t), kind: t.climbing === "boulder" || t["climbing:boulder"] === "yes" ? "bloc" : "sector",
    rock: t["climbing:rock"], sport: t["climbing:sport"], trad: t["climbing:trad"], ori: t["climbing:orientation"], ...p});
}
// Relacions de sector (climbing=crag) que contenen altres llocs: es queda la relació
// Duplicats: mateix nom a menys de 150 m
const out = [];
for(const s of sites){
  const d = out.find(o => o.name && o.name.toLowerCase() === s.name.toLowerCase() && dist(o, s) < 150);
  if(d) continue;
  out.push(s);
}
// Agrupa per proximitat (enllaç simple, 1,5 km)
const LINK = 1500, groups = [];
const seen = new Set();
for(const s of out){
  if(seen.has(s)) continue;
  const g = [s]; seen.add(s);
  for(let i = 0; i < g.length; i++) for(const o of out) if(!seen.has(o) && dist(g[i], o) < LINK){ seen.add(o); g.push(o); }
  groups.push(g);
}
const ROCK = {limestone: "calcaria", granite: "granit", conglomerate: "conglomerat", sandstone: "gres"};
const used = new Map();
const slug = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
let zones = groups.map(g => {
  const lat = g.reduce((a, s) => a + s.lat, 0) / g.length, lon = g.reduce((a, s) => a + s.lon, 0) / g.length, c = {lat, lon};
  // nom: àrea d'OSM (relació o a menys de 3 km), el sector si és l'únic, el poble més proper (fins a 8 km) o el primer sector amb nom
  let name = g.map(s => memberOf.get(s.osm)).find(Boolean);
  if(!name){ const a = areas.filter(a => dist(a, c) < 3000).sort((x, y) => dist(x, c) - dist(y, c))[0]; if(a) name = a.name; }
  // un sol sector amb nom: la zona es diu com el sector (p. ex. «Oliana»)
  if(!name && g.length === 1 && g[0].name) name = g[0].name;
  if(!name){ const p = places.filter(p => p.name && dist(p, c) < 8000).sort((x, y) => dist(x, c) - dist(y, c))[0]; if(p) name = p.name; }
  if(!name) name = (g.find(s => s.name) || {}).name || "Zona sense nom";
  const n = (used.get(name) || 0) + 1; used.set(name, n);
  const rocks = g.map(s => ROCK[s.rock]).filter(Boolean);
  const mods = [];
  if(g.some(s => s.sport !== "no")) mods.push("esportiva");
  if(g.some(s => s.trad && s.trad !== "no")) mods.push("classica");
  return {id: "osm-" + slug(name) + (n > 1 ? "-" + n : ""), name: n > 1 ? name + " " + n : name,
    lat: +lat.toFixed(5), lon: +lon.toFixed(5), alt: null, rock: rocks[0] || null, mods: mods.length ? mods : ["esportiva"], src: "osm",
    sectors: g.map(s => ({id: s.osm, name: s.name || "", kind: s.kind, lat: +s.lat.toFixed(5), lon: +s.lon.toFixed(5), ori: s.ori}))
      .sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || a.name.localeCompare(b.name, "ca"))};
});
// Altitud del centre de cada zona (Open-Meteo, model de 90 m), de 100 en 100
if(!flags.includes("--no-elev")){
  for(let i = 0; i < zones.length; i += 100){
    const b = zones.slice(i, i + 100);
    const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${b.map(z => z.lat).join(",")}&longitude=${b.map(z => z.lon).join(",")}`);
    if(!r.ok) throw new Error("Elevació: HTTP " + r.status);
    (await r.json()).elevation.forEach((h, k) => b[k].alt = Math.round(h));
  }
}
// Orientació i horitzó de cada sector (vegeu dem.mjs). f = cares [{az, hz}], o = "osm" (etiqueta) | "dem" (calculada).
// Es reaprofita el càlcul de la setmana anterior si el sector no s'ha mogut ni ha canviat l'etiqueta
// (menys feina per a l'ICGC), i també si aquesta vegada el relleu no arriba.
const nOri = {osm: 0, dem: 0, flat: 0};
if(!flags.includes("--no-dem")){
  const old = new Map();
  try{ const t = fs.readFileSync("zones-osm.js", "utf8"); JSON.parse(t.slice(t.indexOf("["), t.lastIndexOf("]") + 1))
    .forEach(z => z.sectors.forEach(s => old.set(s.id, s))); }catch(e){}
  for(const z of zones) for(const s of z.sectors){
    const ori = s.ori; delete s.ori;
    const prev = old.get(s.id), same = prev && prev.lat === s.lat && prev.lon === s.lon && (prev.tag || "") === (ori || "");
    if(same && !flags.includes("--recompute") && (prev.f || prev.flat)){ if(prev.f){ s.f = prev.f; s.o = prev.o; } else s.flat = 1; }
    else{
      const p = [s.lon, s.lat], az = parseOri(ori);
      if(az.length){ s.o = "osm"; s.f = []; for(const a of az) s.f.push({az: a, hz: await horizon(p, a)}); }
      else{ const a = await aspect(p);
        if(a){ s.o = "dem"; s.f = [{az: a.az, hz: await horizon(p, a.az)}]; }
        else if(prev && prev.f && stats.fails) { s.f = prev.f; s.o = prev.o; }   // l'ICGC no ha respost: es queda l'anterior
        else if(stats.fails === 0) s.flat = 1; }                               // pla de debò: no cal tornar-ho a mirar
      if(s.f) s.f.forEach(f => { if(!f.hz) delete f.hz; });
    }
    if(ori) s.tag = ori;
    nOri[s.o || "flat"]++;
  }
} else zones.forEach(z => z.sectors.forEach(s => delete s.ori));
zones.sort((a, b) => a.name.localeCompare(b.name, "ca"));
const nS = zones.reduce((a, z) => a + z.sectors.length, 0);
const js = `/* ============ CEM · zones i sectors d'OpenStreetMap (fitxer generat: no l'editis a mà) ============ */
// Font: © col·laboradors d'OpenStreetMap, llicència ODbL 1.0. Generat per tools/osm-build.mjs (GitHub Actions, cada setmana).
// ${zones.length} zones · ${nS} sectors. Els sectors s'agrupen en zones per proximitat (1,5 km).
const OSM_ZONES = ${JSON.stringify(zones).replace(/\},\{"id":"osm-/g, '},\n{"id":"osm-')};
`;
fs.writeFileSync("zones-osm.js", js);
console.log(zones.length + " zones, " + nS + " sectors" + (flags.includes("--no-dem") ? "" :
  `; orientació: ${nOri.osm} d'OSM, ${nOri.dem} calculades, ${nOri.flat} sense (${stats.tiles} rajoles de relleu${stats.fails ? ", " + stats.fails + " fallades" : ""})`));
