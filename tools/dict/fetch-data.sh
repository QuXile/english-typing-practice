#!/usr/bin/env bash
# Download raw dictionary sources into tools/dict/.cache/  (about 110 MB).
# Run from Git Bash / any POSIX shell:  bash tools/dict/fetch-data.sh
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p .cache

ECDICT_URL="${ECDICT_URL:-https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv}"
REVISED_URL="${REVISED_URL:-https://github.com/sliuhaob/ecdict-revised/releases/download/v0.1.1/ecdict-revised-v0.1.1.zip}"

if [ ! -s .cache/ecdict.csv ]; then
  echo "==> downloading ECDICT csv"
  curl -fL --retry 3 -o .cache/ecdict.csv.part "$ECDICT_URL"
  mv .cache/ecdict.csv.part .cache/ecdict.csv
else
  echo "==> cache: ECDICT csv already present"
fi

if [ ! -s .cache/revised/data/entries.csv ]; then
  echo "==> downloading ecdict-revised v0.1.1"
  curl -fL --retry 3 -o .cache/revised.zip.part "$REVISED_URL"
  mv .cache/revised.zip.part .cache/revised.zip
  rm -rf .cache/revised
  mkdir -p .cache/revised
  unzip -qo .cache/revised.zip -d .cache/revised
else
  echo "==> cache: revised entries.csv already present"
fi

echo "==> sources:"
ls -lh .cache/ecdict.csv .cache/revised/data/entries.csv
