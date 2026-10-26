#!/usr/bin/env bash
# Baixa de l'Overpass els llocs d'escalada de Catalunya (tools/osm-query.txt) a osm-raw.json
# Els servidors públics de l'Overpass sovint estan saturats: es fan fins a 3 voltes pels 3 servidors, amb 4 min
# d'espera entre voltes. Si tot falla, l'app es queda amb les zones de l'última actualització (no es perd res):
#   - si zones-osm.js té menys de 21 dies → avís i el procés acaba bé (sense correu d'error)
#   - si en té més → error (correu), perquè vol dir que fa setmanes que no s'actualitza
set -u
UA="CEM-Idoneitat/1.0 (+https://github.com/oriolbarber/Idone-tat_Meteo)"
SRV="https://overpass-api.de/api/interpreter https://maps.mail.ru/osm/tools/overpass/api/interpreter https://overpass.kumi.systems/api/interpreter"
for round in 1 2 3; do
  for u in $SRV; do
    rm -f osm-raw.json
    code=$(curl -sS -m 300 -A "$UA" -H "Accept: */*" -o osm-raw.json -w "%{http_code}" --data-urlencode "data@tools/osm-query.txt" "$u" || echo "ERR")
    if [ "$code" = "200" ] && grep -q '"elements"' osm-raw.json; then echo "::notice::OK $u $(wc -c < osm-raw.json) bytes (volta $round)"; exit 0; fi
    echo "Falla $u (HTTP $code, volta $round): $(head -c 120 osm-raw.json 2>/dev/null | tr '\n' ' ')"
    sleep 20
  done
  [ "$round" -lt 3 ] && sleep 240
done
rm -f osm-raw.json
age=$(( ( $(date +%s) - $(git log -1 --format=%ct -- zones-osm.js 2>/dev/null || date +%s) ) / 86400 ))
if [ "$age" -lt 21 ]; then
  echo "::warning::L'Overpass està saturat: zones no actualitzades aquesta setmana (les actuals tenen $age dies). Es torna a provar la setmana que ve."
  echo "skip=1" >> "${GITHUB_OUTPUT:-/dev/null}"; exit 0
fi
echo "::error::Fa $age dies que no es poden actualitzar les zones d'OpenStreetMap (l'Overpass falla)."; exit 1
