# CEM · Idoneïtat per escalar (V1)

App web instal·lable (PWA) en català que diu quina zona d'escalada de Catalunya és bona els propers dies.
Sense comptes ni servidor. Centre Excursionista del Masnou.

- **Mapa:** MapLibre GL (inclosa a `vendor/`) amb el topogràfic, l'ortofoto, els pendents i el model del terreny de 5 m de l'ICGC (CC BY).
- **Previsió:** [Open-Meteo](https://open-meteo.com/) (CC BY 4.0, gratuït per a ús no comercial): 3 dies passats + 16 de previsió.
- **Radar:** RainViewer.
- **Zones:** `zones.js` (catàleg de prova, coordenades aproximades). Les parets que traça cada persona es desen al mòbil i es poden exportar en JSON.

## Com es calcula el veredicte

Per a cada hora i cada paret (o per a la zona sencera si no n'hi ha cap de traçada):

1. **Secat de la roca:** l'aigua de la pluja s'acumula i s'evapora segons el tipus de roca, el sol a la paret, el vent i la humitat.
2. **Bloquejos (sempre vermell):** pluja, tempesta (codi de tempesta o CAPE alt amb probabilitat de pluja) i roca molla.
3. **Confort:** sensació tèrmica (temperatura aparent de Steadman amb radiació), corregida per activitat (escalant / assegurant) i roba.
4. **Adherència:** roca massa calenta, gelada o que «sua» (humitat alta o punt de rosada a prop).
5. **Vent:** ratxa màxima de la modalitat (a la clàssica, bloqueja).

Nota sobre 10 → verd (≥ 7), groc (≥ 4), vermell. Franges: matí (8–13 h) i tarda (14–19 h), només hores de llum.

## Parets

Toca **Traça una paret** a la fitxa d'una zona i marca punts al peu del cingle. Per a cada tram, l'app llegeix el relleu de l'ICGC:
- **orientació:** la paret mira cap al costat més baix (corregible a mà, perquè el relleu de 5 m suavitza les parets verticals);
- **horitzó real:** l'elevació màxima del relleu cada 5°, fins a 7 km, per saber quan les muntanyes del voltant fan ombra.

Obre-la a https://oriolbarber.github.io/Idone-tat_Meteo/
