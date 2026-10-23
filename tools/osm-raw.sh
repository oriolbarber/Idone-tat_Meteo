#!/usr/bin/env bash
# Baixa de l'Overpass els llocs d'escalada de Catalunya (tools/osm-query.txt) a osm-raw.json
set -u
UA="CEM-Idoneitat/1.0 (+https://github.com/oriolbarber/Idone-tat_Meteo)"
for u in https://overpass-api.de/api/interpreter https://overpass.private.coffee/api/interpreter https://overpass.kumi.systems/api/interpreter https://maps.mail.ru/osm/tools/overpass/api/interpreter; do
  rm -f osm-raw.json
  code=$(curl -sS -m 300 -A "$UA" -H "Accept: */*" -o osm-raw.json -w "%{http_code}" --data-urlencode "data@tools/osm-query.txt" "$u" || echo "ERR")
  if [ "$code" = "200" ] && head -c 200 osm-raw.json | grep -q '"elements"'; then echo "::notice::OK $u $(wc -c < osm-raw.json) bytes"; exit 0; fi
  echo "::warning::Falla $u (HTTP $code): $(head -c 160 osm-raw.json 2>/dev/null | tr '\n' ' ')"
  sleep 15
done
exit 1
