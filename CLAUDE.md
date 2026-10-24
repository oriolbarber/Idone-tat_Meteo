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
- `heat.js`: capa «Idoneïtat amb colors» (`ly.heat`, per defecte apagada): graella d'Open-Meteo cada 0,1° a < 24 km de les zones visibles (lots de 50, 8 dies, memòria 1 h), nota de zona sense parets (sense orientació, calcària) per al dia/dies i franja, imatge suavitzada per sota dels marcadors, només a prop de les zones (fosa 9→18 km), colors `--ok/--mid/--no` (tema i daltonisme), llindar «Amaga les notes per sota de» (`cem_heat_thr`), llegenda que obre (i) «capa».
- `firestore.rules`: regles. Administració inicial = correu `oriolbarber@gmail.com` confirmat. Es publiquen amb `.github/workflows/deploy-rules.yml` si hi ha el secret `FIREBASE_SERVICE_ACCOUNT`; si no, a mà (consola ▸ Firestore ▸ Regles).

## Decisions
- Restriccions: les posa o retira qualsevol persona registrada i les ratifiquen 2 persones més; les per confirmar es mostren en groc; no canvien la nota meteo (23-10-2026). Fonts oficials de nidificació: només webs i PDF dels parcs (sense API): s'enllacen.
- V2 oberta a tot Europa, nom «CEM», llicència de les aportacions ODbL 1.0 (23-10-2026).
- L'app es fa servir sense compte; el compte només cal per proposar.
- Les parets aprovades no porten dades personals; en esborrar el compte s'esborren les propostes.
- Firebase: projecte `cem-meteo`, Firestore `eur3`.
- L'escalada es planifica per dies i per tot Catalunya: nota de diversos dies = dies bons (23-10-2026).
- Interfície (23-10-2026): fitxa de zona a pantalla completa (enrere del mòbil torna al mapa) amb els seus dies (matí | tarda); en franja «Dia» el marcador es parteix matí | tarda; les explicacions fixes van a botons (i) (`infoContent`); atribució com a text petit fix (`.attr`).
- Capa de colors (24-10-2026): mateixa paleta que les rodones però apagada; només a prop de les zones; mana la rodona si no coincideixen.
- Sense temps de viatge (decisió de l'Oriol): coordenades amb «Copia» i «Obre al mapa» (excepció a la norma del navegador: `geo:` a Android i Apple Maps a l'iPhone obren l'app de mapes del mòbil; a l'ordinador només «Copia»).

## Pendent
- Desar i compartir el pla de sortida; escapada amb nit i càmpers.
- Catàleg aprovat com a fitxer estàtic (GitHub Actions) quan creixi.
- Sembra de zones europees des d'OpenStreetMap (ampliar `tools/osm-query.txt`); relleu de 30 m fora de Catalunya.
- Preferits al compte (ara només al mòbil).
- Gestió de revisors (donar el rol) des de l'app.
- Descàrrega per zona sense cobertura.
