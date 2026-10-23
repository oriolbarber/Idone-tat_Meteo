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
- `app.js`: mapa (ICGC), previsió (Open-Meteo), model de veredicte (secat, confort Steadman + escalant/assegurant + roba, adherència, vent), traçat de parets amb orientació i horitzó del relleu de 5 m de l'ICGC, zones agrupades amb anell de %. Barra de dies = mitjana de les zones a la vista (matí | tarda), es recalcula a `moveend`. Dies de la sortida (`selDays`, un o diversos, no cal que siguin seguits; `dayKey` = dia enfocat) triats a la barra o al calendari (`#calSheet`); franja Matí | Tarda | Dia (`frSlot`, «dia» = mitjana i no pot ser verd si una franja està bloquejada); període = «N de M dies bons» (`periodEval`, bo = verd ≥ 7); rànquing «On anar» (`#rankSheet`, totes o a la vista). Dies ≥ 6 amb vora discontínua (orientatiu).
- `cloud.js`: comptes (correu i contrasenya + enllaç; Google no activat), perfil `usuaris/{uid}`, propostes `propostes/{id}` (correu confirmat + llicència ODbL 1.0), revisió (admin, `rol: "revisor"` o `premium`), catàleg aprovat `parets/{id}` llegit amb l'API REST pública (sense carregar Firebase).
- `restr.js`: restriccions de la comunitat (`restriccions/{id}`, lectura pública per REST): les afegeix qualsevol persona registrada amb el correu confirmat (nidificació | tancament | altres, dates o «cada any» MM-DD, sector buit = tota la zona, enllaç a la font oficial, ODbL); «per confirmar» fins a 2 confirmacions d'altres (`conf`); retirar-les: `retPer` proposa i 2 més confirmen (`ret`); admin/revisors/premium directament. No canvien la nota meteo: icona al marcador, secció a la fitxa, al rànquing les de tota la zona (o tancament / Pla Alfa 4) al final. Pla Alfa: servei ArcGIS públic dels Agents Rurals (`services7.arcgis.com/ZCqVt1fRXwwK6GF4`, capes municipals avui/demà `PERIL_M` 0–4 i tancaments), municipi de cada zona desat a `cem_muni`; només Catalunya, avui i demà.
- `firestore.rules`: regles. Administració inicial = correu `oriolbarber@gmail.com` confirmat. Es publiquen amb `.github/workflows/deploy-rules.yml` si hi ha el secret `FIREBASE_SERVICE_ACCOUNT`; si no, a mà (consola ▸ Firestore ▸ Regles).

## Decisions
- Restriccions: les posa o retira qualsevol persona registrada i les ratifiquen 2 persones més; les per confirmar es mostren en groc; no canvien la nota meteo (23-10-2026). Fonts oficials de nidificació: només webs i PDF dels parcs (sense API): s'enllacen.
- V2 oberta a tot Europa, nom «CEM», llicència de les aportacions ODbL 1.0 (23-10-2026).
- L'app es fa servir sense compte; el compte només cal per proposar.
- Les parets aprovades no porten dades personals; en esborrar el compte s'esborren les propostes.
- Firebase: projecte `cem-meteo`, Firestore `eur3`.
- L'escalada es planifica per dies i per tot Catalunya: nota de diversos dies = dies bons (23-10-2026).
- Interfície (23-10-2026): fitxa de zona a pantalla completa (enrere del mòbil torna al mapa) amb els seus dies (matí | tarda); en franja «Dia» el marcador es parteix matí | tarda; les explicacions fixes van a botons (i) (`infoContent`); atribució com a text petit fix (`.attr`).
- Sense temps de viatge (decisió de l'Oriol): coordenades amb «Copia» i «Obre al mapa» (excepció a la norma del navegador: `geo:` a Android i Apple Maps a l'iPhone obren l'app de mapes del mòbil; a l'ordinador només «Copia»).

## Pendent
- Desar i compartir el pla de sortida; escapada amb nit i càmpers.
- Catàleg aprovat com a fitxer estàtic (GitHub Actions) quan creixi.
- Sembra de zones europees des d'OpenStreetMap; relleu de 30 m fora de Catalunya.
- Gestió de revisors (donar el rol) des de l'app.
- Descàrrega per zona sense cobertura.
