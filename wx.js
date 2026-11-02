"use strict";
/* ============ CEM · mapes meteo (temperatura, pluja, vent) — com la pestanya Mapes d'Ocata Vent ============ */
// Vista a pantalla completa (com la fitxa de zona): el botó enrere o el del sistema tornen al mapa.
// Temperatura, vent i pluja prevista: mapa incrustat de Windy (model ECMWF, amb línia de temps per als propers dies).
// Pluja «Radar»: RainViewer animat, última hora (mateix servei que la capa «Pluja» del mapa; zoom natiu màxim 7).
// Els iframes van amb sandbox sense allow-popups: cap enllaç de Windy pot obrir el navegador extern.
// En tancar la vista es treu l'iframe i s'atura el radar (no gasta dades si no es mira).
(() => {
  const WX_RV_FRAMES = 7;                 // 7 fotogrames cada 10 min = última hora (RainViewer: màx. 100 peticions/min)
  const WX_RV_FRESH = 5 * 60e3;
  const OV = {temp:{t:"Temperatura", ov:"temp"}, wind:{t:"Vent", ov:"wind"}, gust:{t:"Ratxes", ov:"gust"}, rainfc:{t:"Pluja prevista", ov:"rain"}};
  const PLAY = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>`;
  const PAUSE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;

  let kind = store.get("cem_wx", "temp");          // temp | rain | wind
  let rainMode = store.get("cem_wx_rain", "radar"); // radar | fc
  let windMode = store.get("cem_wx_wind", "wind");  // wind | gust
  let histLen = 0;                                  // llargada de l'historial en obrir la vista (amb el pas propi)
  let at = null;                                    // {lat, lon, z} = on mirava el mapa en obrir
  let rvMap = null, rvFrames = [], rvIdx = 0, rvTimer = null, rvAt = 0, rvMk = null;

  const open = () => !$("wxView").hidden;
  // Cada mapa va en un iframe NOU (canviar l'adreça d'un iframe existent afegeix un pas a l'historial).
  function frameNew(u){
    const old = $("wxFrame"), f = document.createElement("iframe");
    ["id", "title", "sandbox", "referrerpolicy"].forEach(a => old.hasAttribute(a) && f.setAttribute(a, old.getAttribute(a)));
    f.hidden = old.hidden;
    if(u){ f.src = u; f.dataset.u = u; }
    old.replaceWith(f);
  }

  function windyUrl(ov){
    const z = clamp(Math.round(at.z), 4, 11);
    return "https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=km%2Fh" +
      `&zoom=${z}&overlay=${ov}&product=ecmwf&level=surface&lat=${at.lat.toFixed(3)}&lon=${at.lon.toFixed(3)}` +
      `&detailLat=${at.lat.toFixed(3)}&detailLon=${at.lon.toFixed(3)}&marker=true&message=true`;
  }
  function sub(){
    const k = kind === "rain" ? (rainMode === "radar" ? null : "rainfc") : kind === "wind" ? windMode : "temp";
    $("wxSrc").textContent = k ? `${OV[k].t} · Windy.com (model ECMWF)` : "Radar de pluja · RainViewer";
  }

  function show(){
    document.querySelectorAll("#wxSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.wx === kind)));
    document.querySelectorAll("#wxRainSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.rm === rainMode)));
    document.querySelectorAll("#wxWindSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.wm === windMode)));
    $("wxRainSeg").hidden = kind !== "rain";
    $("wxWindSeg").hidden = kind !== "wind";
    const radar = kind === "rain" && rainMode === "radar";
    $("wxRadarBox").hidden = !radar;
    if(radar){ if($("wxFrame").dataset.u) frameNew(null); $("wxFrame").hidden = true; rvOpen(); }
    else{
      rvPlay(false);
      const ov = kind === "temp" ? "temp" : kind === "wind" ? windMode : "rain";
      const u = windyUrl(ov);
      if($("wxFrame").dataset.u !== u) frameNew(u);
      $("wxFrame").hidden = false;
    }
    sub();
  }

  /* ---------- radar animat (RainViewer) ---------- */
  function rvEnsure(){
    if(rvMap) return true;
    if(!window.maplibregl) return false;
    rvMap = new maplibregl.Map({
      container: "wxRadar", center: [at.lon, at.lat], zoom: clamp(at.z, 4, 9), maxZoom: 10, minZoom: 3,
      attributionControl: false, dragRotate: false, pitchWithRotate: false,
      style: {version: 8, sources: {topo: {type:"raster", tiles:[ICGC + "mapa-base/wmts/topografic/MON3857NW/{z}/{x}/{y}.png"], tileSize:256, maxzoom:18}},
              layers: [{id:"topo", type:"raster", source:"topo", paint:{"raster-saturation":-0.6, "raster-opacity":0.85}}]}
    });
    rvMap.touchZoomRotate.disableRotation();
    return true;
  }
  function rvShow(i){
    if(!rvFrames.length) return;
    rvIdx = (i + rvFrames.length) % rvFrames.length;
    rvFrames.forEach((f, j) => rvMap.getLayer("rv" + j) && rvMap.setPaintProperty("rv" + j, "raster-opacity", j === rvIdx ? 0.8 : 0));
    const d = new Date(rvFrames[rvIdx].time * 1000), ago = Math.round((Date.now() - d) / 60000);
    $("wxTime").textContent = pad(d.getHours()) + ":" + pad(d.getMinutes()) + (ago > 0 ? " · fa " + ago + " min" : "");
    $("wxSlider").value = rvIdx;
  }
  function rvPlay(on){
    clearTimeout(rvTimer); rvTimer = null;
    if(on && rvFrames.length){
      const step = () => { rvShow(rvIdx + 1); rvTimer = setTimeout(step, rvIdx === rvFrames.length - 1 ? 1500 : 650); };
      rvTimer = setTimeout(step, 650);
    }
    $("wxPlay").innerHTML = rvTimer ? PAUSE : PLAY;
    $("wxPlay").setAttribute("aria-label", rvTimer ? "Atura l'animació" : "Reprodueix l'animació");
  }
  function rvClear(){
    if(!rvMap) return;
    for(let j = 0; j < 30; j++){ if(rvMap.getLayer("rv" + j)) rvMap.removeLayer("rv" + j); if(rvMap.getSource("rv" + j)) rvMap.removeSource("rv" + j); }
  }
  async function rvLoad(){
    $("wxTime").textContent = "Carregant…";
    try{
      const j = await (await fetch("https://api.rainviewer.com/public/weather-maps.json", {cache:"no-store"})).json();
      rvClear();
      rvFrames = (j.radar?.past || []).slice(-WX_RV_FRAMES);
      rvFrames.forEach((f, i) => {
        rvMap.addSource("rv" + i, {type:"raster", tiles:[j.host + f.path + "/256/{z}/{x}/{y}/2/1_1.png"], tileSize:256, maxzoom:7});
        rvMap.addLayer({id:"rv" + i, type:"raster", source:"rv" + i, paint:{"raster-opacity":0, "raster-fade-duration":0}});
      });
      rvAt = Date.now();
      $("wxSlider").max = Math.max(0, rvFrames.length - 1);
      if(!rvFrames.length){ $("wxTime").textContent = "Sense imatges ara mateix"; return; }
      // l'últim fotograma molt vell = RainViewer sense dades recents: s'avisa en comptes de fer-lo passar per actual
      const last = rvFrames[rvFrames.length - 1].time * 1000;
      rvShow(rvFrames.length - 1);
      if(Date.now() - last > 40 * 60e3) $("wxTime").textContent += " · radar endarrerit";
      if(open() && kind === "rain" && rainMode === "radar") rvPlay(true);
    }catch(e){ $("wxTime").textContent = "Sense connexió"; }
  }
  function rvOpen(){
    if(!rvEnsure()){ $("wxTime").textContent = "No s'ha pogut carregar el mapa"; return; }
    if(!rvFrames.length) $("wxTime").textContent = "Carregant…";
    setTimeout(() => {
      rvMap.resize();
      rvMap.jumpTo({center:[at.lon, at.lat], zoom: clamp(at.z, 4, 9)});
      if(rvMk) rvMk.setLngLat([at.lon, at.lat]);
      else{ const el = document.createElement("div"); el.className = "wx-pt"; rvMk = new maplibregl.Marker({element: el}).setLngLat([at.lon, at.lat]).addTo(rvMap); }
      const go = () => { if(Date.now() - rvAt > WX_RV_FRESH || !rvFrames.length) rvLoad(); else rvPlay(true); };
      // no s'espera «load» (que espera les rajoles): si el fons no arriba, el radar ha de dir igualment què passa
      rvMap.isStyleLoaded() ? go() : rvMap.once("style.load", go);
    }, 0);
  }

  /* ---------- obrir i tancar ---------- */
  function wxOpen(){
    const c = map.getCenter();
    at = {lat: c.lat, lon: c.lng, z: map.getZoom()};
    closeFloating();
    $("wxView").hidden = false;
    if(!(history.state && history.state.cemWx)) history.pushState({cemWx:1}, "");
    histLen = history.length;
    show();
  }
  function wxShut(){
    $("wxView").hidden = true;
    frameNew(null);                               // atura Windy (dades) i treu els seus passos de l'historial
    rvPlay(false);
  }
  $("wxBtn").addEventListener("click", wxOpen);
  // Un sol toc: Windy afegeix passos a l'historial (canvis de mapa, línia de temps) i Chrome no els treu encara
  // que es tregui l'iframe. Per això se salta de cop fins a abans d'obrir la vista: tots els passos afegits + el propi.
  $("wxClose").addEventListener("click", () => {
    if(!(history.state && history.state.cemWx)){ wxShut(); return; }
    const n = Math.max(0, history.length - histLen);
    history.go(-(n + 1));
  });
  addEventListener("popstate", () => { if(open()) wxShut(); });
  window.CEM_WX = {close: () => $("wxClose").click(), isOpen: open};

  $("wxSeg").addEventListener("click", e => { const b = e.target.closest("button[data-wx]"); if(!b) return; kind = b.dataset.wx; store.set("cem_wx", kind); show(); });
  $("wxRainSeg").addEventListener("click", e => { const b = e.target.closest("button[data-rm]"); if(!b) return; rainMode = b.dataset.rm; store.set("cem_wx_rain", rainMode); show(); });
  $("wxWindSeg").addEventListener("click", e => { const b = e.target.closest("button[data-wm]"); if(!b) return; windMode = b.dataset.wm; store.set("cem_wx_wind", windMode); show(); });
  $("wxPlay").addEventListener("click", () => rvPlay(!rvTimer));
  $("wxSlider").addEventListener("input", e => { rvPlay(false); rvShow(+e.target.value); });
  document.addEventListener("visibilitychange", () => {
    if(!open() || kind !== "rain" || rainMode !== "radar") return;
    if(document.hidden) rvPlay(false); else if(Date.now() - rvAt > WX_RV_FRESH) rvLoad(); else rvPlay(true);
  });
})();
