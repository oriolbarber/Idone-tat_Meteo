// Relleu per a GitHub Actions: model del terreny de 5 m de l'ICGC (rajoles PNG RGB, només Catalunya).
// Calcula, per als sectors d'OSM que no porten climbing:orientation, cap on mira la paret i l'horitzó real.
// Mateixes fórmules que app.js (RELLEU): h = −10000 + (R·65536 + G·256 + B) · 0,1; horitzó cada 5° fins a 7 km.
import {PNG} from "pngjs";

const RAD = Math.PI / 180;
const URL0 = "https://geoserveis.icgc.cat/servei/catalunya/contextmaps-terreny-5m-rgb/wmts/";
const UA = "CEM-Idoneitat/1.0 (+https://github.com/oriolbarber/Idone-tat_Meteo)";
const tiles = new Map();
export const stats = {tiles: 0, fails: 0};

async function getTile(z, x, y){
  const k = z + "/" + x + "/" + y;
  if(!tiles.has(k)) tiles.set(k, (async () => {
    for(let t = 1; t <= 3; t++){
      try{
        const r = await fetch(URL0 + k + ".png", {headers: {"User-Agent": UA}});
        if(r.status === 404) return null;                       // fora de Catalunya
        if(!r.ok) throw new Error("HTTP " + r.status);
        const png = PNG.sync.read(Buffer.from(await r.arrayBuffer()));
        stats.tiles++; return {w: png.width, d: png.data};    // RGBA
      }catch(e){ if(t === 3){ stats.fails++; return null; } await new Promise(r => setTimeout(r, 2000 * t)); }
    }
  })());
  return tiles.get(k);
}
// Altitud (m) o null. La funció es pot substituir per provar sense xarxa (setElev).
let elevFn = async (lon, lat, z = 14) => {
  const n = 2 ** z, xf = (lon + 180) / 360 * n, s = Math.sin(lat * RAD), yf = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  const t = await getTile(z, Math.floor(xf), Math.floor(yf)); if(!t) return null;
  const px = Math.min(t.w - 1, Math.floor((xf % 1) * t.w)), py = Math.min(t.w - 1, Math.floor((yf % 1) * t.w)), i = (py * t.w + px) * 4;
  if(t.d[i + 3] === 0) return null;
  return -10000 + (t.d[i] * 65536 + t.d[i + 1] * 256 + t.d[i + 2]) * 0.1;
};
export const setElev = f => { elevFn = f; };
const elev = (...a) => elevFn(...a);

export function dest(p, az, d){ const dl = d / 6371000; const la = p[1] * RAD, lo = p[0] * RAD, b = az * RAD;
  const la2 = Math.asin(Math.sin(la) * Math.cos(dl) + Math.cos(la) * Math.sin(dl) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(dl) * Math.cos(la), Math.cos(dl) - Math.sin(la) * Math.sin(la2));
  return [lo2 / RAD, la2 / RAD]; }

// Cap on mira la paret en un punt: pla ajustat al relleu en un cercle de 60 m; la paret mira pendent avall.
// Retorna {az, slope} o null si el terreny és massa pla (< 12°: no se'n pot saber l'orientació).
export async function aspect(p){
  let sx = 0, sy = 0, sxx = 0, syy = 0, n = 0;
  const e0 = await elev(...p); if(e0 == null) return null;
  for(const r of [15, 30, 45, 60]) for(let b = 0; b < 360; b += 22.5){
    const e = await elev(...dest(p, b, r)); if(e == null) return null;
    const x = r * Math.sin(b * RAD), y = r * Math.cos(b * RAD);
    sx += (e - e0) * x; sy += (e - e0) * y; sxx += x * x; syy += y * y; n++;
  }
  const gx = sx / sxx, gy = sy / syy, slope = Math.atan(Math.hypot(gx, gy)) / RAD;
  if(slope < 12) return null;
  return {az: Math.round((Math.atan2(-gx, -gy) / RAD + 360) % 360), slope: Math.round(slope)};
}

// Horitzó real des del peu de la paret (com horizon() d'app.js): elevació màxima cada 5°, 90 = darrere la paret
const HZ_D = [100, 150, 200, 300, 400, 550, 700, 900, 1200, 1600, 2000, 2600, 3300, 4200, 5500, 7000];
export async function horizon(p, face){
  const foot = dest(p, face, 25), e0 = await elev(...foot); if(e0 == null) return null;
  const hz = new Uint8Array(72);
  for(let k = 0; k < 72; k++){
    const az = k * 5, d = ((az - face + 540) % 360) - 180;
    if(Math.abs(d) > 95){ hz[k] = 90; continue; }
    let mx = 0;
    for(const dist of HZ_D){
      const e = await elev(...dest(foot, az, dist), dist <= 1200 ? 14 : 12); if(e == null) continue;
      const ang = Math.atan((e - e0 - 1.5 - dist * dist / 12742000) / dist) / RAD; if(ang > mx) mx = ang;
    }
    hz[k] = Math.min(89, Math.round(mx));
  }
  return Buffer.from(hz).toString("base64");   // 72 graus enters → 96 caràcters
}

// climbing:orientation d'OSM: "S", "SSE", "N;E", "180"… → llista de graus
const PTS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
export function parseOri(v){
  if(!v) return [];
  return String(v).toUpperCase().replace(/O/g, "W").split(/[;,/ ]+|-(?=[A-Z])/).map(x => x.trim()).filter(Boolean).map(x => {
    if(/^\d+(\.\d+)?$/.test(x)) return Math.round(+x) % 360;
    const i = PTS.indexOf(x); return i < 0 ? null : i * 22.5;
  }).filter((x, i, a) => x != null && a.indexOf(x) === i);
}
