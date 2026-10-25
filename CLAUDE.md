# CEM · Idoneïtat per escalar

PWA en català que diu quina zona d'escalada és bona els propers dies (Catalunya → Europa), amb parets que aporta la comunitat i revisen persones voluntàries. Club: Centre Excursionista del Masnou. Derivada d'Ocata Vent (`oriolbarber/mar-del-masnou`, `oriolbarber/OcataVent`).

Pla complet: document «CEM — transferència de coneixement des d'Ocata Vent» (Claude Docs, artefacte 6b3e5905-8309-43b1-a02b-ac3a8c374302).

## Com treballar amb l'Oriol
- Respon sempre en català, concís. Abans/després quan hi hagi canvis visibles. Reconeix els errors. Avisa de les decisions de disseny.
- És novell amb Firebase i GitHub: passos numerats i curts quan hagi de fer alguna cosa a la consola.
- Commit i push al final de cada canvi. Apuja `CACHE` a `sw.js` i les `?v=` d'`index.html`.

## Normes (com Ocata Vent)
- Res obre un navegador extern. Tot gran i clar. Esborrar sempre amb `slideConfirm`. Tema clar/fosc i opció de daltonisme (no dependre només del color).
- HTML, CSS i JS sense framework ni compilació. MapLibre inclosa a `vendor/`.

## Fitxers
- `zones.js`: catàleg de zones (de prova, coordenades aproximades) i tipus de roca.
- `zones-osm.js`: GENERAT (no editar). Zones i sectors de Catalunya d'OpenStreetMap: `.github/workflows/osm-zones.yml` (dilluns i a mà) → `tools/osm-raw.sh` (Overpass, consulta `tools/osm-query.txt`) → `tools/osm-build.mjs` (treu vies ferrades i rocòdroms, agrupa sectors a < 1,5 km, nom = àrea OSM / sector únic / poble més proper, altitud d'Open-Meteo). A `app.js` una zona OSM a < 4 km d'una de `zones.js` s'hi afegeix com a sectors. Roca desconeguda = calcària amb «?» (`rockGuess`).
- Preferits (`cem_favs`, en aquest mòbil) i «Només les preferides» (`cem_onlyfav`, capes): mostra i baixa la previsió només d'aquestes. La previsió es baixa per lots de 50; la còpia sense connexió desa totes les zones si hi caben, si no només les preferides.
- Tocar el mapa tanca capes, calendari, «On anar» i informació; el menú ⋮ és un calaix lateral i tocar l'ombra el tanca; Esc tanca el que hi ha a sobre.
- `app.js`: mapa (ICGC), previsió (Open-Meteo), model de veredicte (secat, confort Steadman + escalant/assegurant + roba, adherència, vent), traçat de parets amb orientació i horitzó del relleu de 5 m de l'ICGC, zones agrupades amb anell de %. Barra de dies = mitjana de les zones a la vista (matí | tarda), es recalcula a `moveend`. Dies de la sortida (`selDays`, un o diversos, no cal que siguin seguits; `dayKey` = dia enfocat) triats a la barra o al calendari (`#calSheet`); franja Matí | Tarda | Dia (`frSlot`, «dia» = mitjana i no pot ser verd si una franja està bloquejada); període = «N de M dies bons» (`periodEval`, bo = verd ≥ 7); rànquing «On anar» (`#rankSheet`, totes o a la vista). Dies ≥ 6 amb vora discontínua (orientatiu).
- `cloud.js`: comptes (correu i contrasenya + enllaç; Google no activat), perfil `usuaris/{uid}`, propostes `propostes/{id}` (correu confirmat + llicència ODbL 1.0), revisió (admin, `rol: "revisor"` o `premium`), catàleg aprovat `parets/{id}` llegit amb l'API REST pública (sense carregar Firebase).
- `restr.js`: restriccions de la comunitat (`restriccions/{id}`, lectura pública per REST): les afegeix qualsevol persona registrada amb el correu confirmat (nidificació | tancament | altres, dates o «cada any» MM-DD, sector buit = tota la zona, enllaç a la font oficial, ODbL); «per confirmar» fins a 2 confirmacions d'altres (`conf`); retirar-les: `retPer` proposa i 2 més confirmen (`ret`); admin/revisors/premium directament. No canvien la nota meteo: icona al marcador, secció a la fitxa, al rànquing les de tota la zona (o tancament / Pla Alfa 4) al final. Pla Alfa: servei ArcGIS públic dels Agents Rurals (`services7.arcgis.com/ZCqVt1fRXwwK6GF4`, capes municipals avui/demà `PERIL_M` 0–4 i tancaments), municipi de cada zona desat a `cem_muni`; només Catalunya, avui i demà.
- `heat.js`: capa «Idoneïtat amb colors» (`ly.heat`, per defecte apagada): nota de zona sense parets (sense orientació, calcària) per al dia/dies i franja en una graella cada 0,1° a prop de les zones visibles, imatge suavitzada per sota dels marcadors, només a prop de les zones (color ple fins a 10 km, fosa fins a 20 km), colors `--ok/--mid/--no` (tema i daltonisme), llindar «Amaga les notes per sota de» (`cem_heat_thr`), llegenda que obre (i) «capa». Font: primer `heat.json` de la branca `dades` (raw.githubusercontent.com, es mira cada 30 min, no es fa servir si té > 12 h; còpia `cem_heat` per a sense connexió fins a 48 h); els punts que no hi són o si no arriba, Open-Meteo des del mòbil (lots de 50, 8 dies, memòria 1 h). Amb la capa activa, el radar es pinta en gris fosc (`radarStyle`) perquè els seus colors no es barregin amb els de la capa.
- Dades precalculades: `.github/workflows/dades.yml` (cada 3 h, minut 23, i a mà) publica a la branca orfe `dades` (un sol commit reescrit) `fc.json` i `heat.json`, que l'app llegeix de raw.githubusercontent.com (gzip, CORS, memòria 5 min). Si no arriben o tenen > 12 h, l'app consulta Open-Meteo des del mòbil com abans.
  - `tools/app-model.mjs`: carrega el model d'app.js sense copiar-lo, per títol de secció (`utilitats`, `catàleg` fins a `// Preferits`, `posició del sol`, `dades: Open-Meteo`, `model:` fins a `const FR_TXT`, més `CRIT_DEF`, `hzAt` i `distM`); si es reanomenen, el procés falla. `HEAT_MOCK=1` = dades inventades (mateixa precisió que Open-Meteo) per provar.
  - `tools/fc-build.mjs` → `fc.json`: previsió EN BRUT de totes les zones amb la mateixa adreça (`omURL`), en enters (valor × `sc`, sense pèrdua; avisa si n'hi ha), un sol `t0`/`n` d'hores i `sun` per dia. A l'app, `load()` fa `fcHydrate` (FC_URL) i només demana a Open-Meteo les zones que no hi són. Cada mòbil hi aplica els SEUS llindars, roba i parets.
  - `tools/heat-build.mjs` → `heat.json`: capa ja calculada (a < 26 km de les zones, ~380 punts), notes × 10 en Uint8 (255 = sense dades) en base64 per a esportiva|clàssica × escalant|assegurant, llindars per defecte i roba normal.
- `firestore.rules`: regles. Administració inicial = correu `oriolbarber@gmail.com` confirmat. Es publiquen soles amb `.github/workflows/deploy-rules.yml` en cada canvi de `firestore.rules` (secret `FIREBASE_SERVICE_ACCOUNT` = clau JSON del compte `firebase-adminsdk-…`, posat el 25-10-2026; al compte se li van afegir a IAM els rols «Consumidor de Service Usage» i «Administrador de Firebase Rules», sense els quals falla amb 403 a serviceusage).

## Decisions
- Restriccions: les posa o retira qualsevol persona registrada i les ratifiquen 2 persones més; les per confirmar es mostren en groc; no canvien la nota meteo (23-10-2026). Fonts oficials de nidificació: només webs i PDF dels parcs (sense API): s'enllacen.
- V2 oberta a tot Europa, nom «CEM», llicència de les aportacions ODbL 1.0 (23-10-2026).
- L'app es fa servir sense compte; el compte només cal per proposar.
- Les parets aprovades no porten dades personals; en esborrar el compte s'esborren les propostes.
- Firebase: projecte `cem-meteo`, Firestore `eur3`.
- L'escalada es planifica per dies i per tot Catalunya: nota de diversos dies = dies bons (23-10-2026).
- Interfície (23-10-2026): fitxa de zona a pantalla completa (enrere del mòbil torna al mapa) amb els seus dies (matí | tarda); en franja «Dia» el marcador es parteix matí | tarda; les explicacions fixes van a botons (i) (`infoContent`); atribució com a text petit fix (`.attr`).
- Capa de colors (24-10-2026): mateixa paleta que les rodones però apagada; només a prop de les zones (20 km, no tot el mapa, per no gastar Open-Meteo); mana la rodona si no coincideixen; precalculada a GitHub amb els llindars per defecte (els personals no la canvien).
- Previsió de les zones precalculada a GitHub en brut (24-10-2026): cada persona manté els seus llindars a les rodones; la capa de colors sí que fa servir els llindars per defecte.
- Sense temps de viatge (decisió de l'Oriol): coordenades amb «Copia» i «Obre al mapa» (excepció a la norma del navegador: `geo:` a Android i Apple Maps a l'iPhone obren l'app de mapes del mòbil; a l'ordinador només «Copia»).

## Pendent
- Desar i compartir el pla de sortida; escapada amb nit i càmpers.
- Catàleg aprovat com a fitxer estàtic (GitHub Actions) quan creixi.
- Sembra de zones europees des d'OpenStreetMap (ampliar `tools/osm-query.txt`); relleu de 30 m fora de Catalunya.
- Preferits al compte (ara només al mòbil).
- Gestió de revisors (donar el rol) des de l'app.
- Descàrrega per zona sense cobertura.
