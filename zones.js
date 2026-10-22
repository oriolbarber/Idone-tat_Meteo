/* ============ CEM · catàleg de zones (V1: fitxer al repositori) ============ */
// Zones de prova. Coordenades i altituds APROXIMADES (centre de la zona): cal revisar-les amb OpenStreetMap
// (climbing=crag) i amb escaladors del CEM abans d'obrir l'app.
// rock: "calcaria" | "conglomerat" | "granit" | "gres" — canvia el temps de secat i la tolerància a la humitat.
// mods: modalitats que s'hi practiquen ("esportiva", "classica").
// walls: parets traçades al mapa. Les que traça cada persona es desen al mòbil (vegeu app.js · parets).
//   Format d'una paret: {id, name, pts:[[lon,lat],…], segs:[{az, azAuto}], exp:"exposat"|"arrecerat", hz:[…]}
//   az = cap on mira la paret (graus, 0 = N), hz = horitzó real cada 5° d'azimut (graus d'elevació).
const ZONES = [
  {id:"montserrat", name:"Montserrat",            lat:41.600, lon:1.810, alt:1000, rock:"conglomerat", mods:["esportiva","classica"], src:"provisional", walls:[]},
  {id:"stllorenc",  name:"Sant Llorenç del Munt", lat:41.645, lon:2.020, alt:1000, rock:"conglomerat", mods:["esportiva","classica"], src:"provisional", walls:[]},
  {id:"siurana",    name:"Siurana",               lat:41.258, lon:0.933, alt:700,  rock:"calcaria",    mods:["esportiva"],             src:"provisional", walls:[]},
  {id:"margalef",   name:"Margalef",              lat:41.285, lon:0.755, alt:450,  rock:"conglomerat", mods:["esportiva"],             src:"provisional", walls:[]},
  {id:"garraf",     name:"Garraf",                lat:41.270, lon:1.860, alt:250,  rock:"calcaria",    mods:["esportiva"],             src:"provisional", walls:[]}
];

// Tipus de roca: aigua que pot retenir (cap, mm), factor de secat (1 = calcària) i com li afecta la humitat (hum)
const ROCKS = {
  calcaria:    {name:"Calcària",    cap:1.5, dry:1.0, hum:1.0},
  granit:      {name:"Granit",      cap:1.2, dry:1.1, hum:0.9},
  conglomerat: {name:"Conglomerat", cap:2.5, dry:0.8, hum:1.1},
  gres:        {name:"Gres",        cap:4.0, dry:0.5, hum:1.3}   // xucla aigua, s'eixuga a poc a poc i es trenca mullat
};
