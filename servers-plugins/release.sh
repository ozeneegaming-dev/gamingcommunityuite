#!/usr/bin/env sh
# GCS Server Bridge — pasul de release (specul 2026-10-08-servere-plugin-v2 §6), Linux.
# Compilează ambele pluginuri cu uneltele date (nu descarcă nimic) și scrie servers-plugins/release/: binarele, sursele
# cerute de licență, configurile-șablon și manifest.json (versiunile, sha256, uneltele). Apoi: git add servers-plugins/release.
#   AMXXPC=/opt/amxmodx/scripting/amxxpc AMXX_INCLUDES=/opt/easy_http:/opt/reapi DOTNET_EXE=/opt/dotnet8/dotnet ./release.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
dotnet=${DOTNET_EXE:-dotnet}

# CS 1.6: versiunea compilatorului din ieșirea lui; orice avertisment oprește release-ul.
out=$("$here/amxx/build.sh" 2>&1) || { echo "$out"; echo "Compilarea AMX Mod X a eșuat."; exit 1; }
echo "$out"
echo "$out" | grep -q "Done\." || { echo "Compilarea AMX Mod X a eșuat."; exit 1; }
if echo "$out" | grep -Eqi "warning|error"; then echo "Compilarea AMX Mod X are avertismente sau erori."; exit 1; fi
amxx_version=$(echo "$out" | sed -n 's/.*Compiler \([0-9][0-9.]*\).*/\1/p' | head -n 1)

# CS2: fără .pdb și fără căile locale în DLL (build reproductibil, vezi GcsBridge.csproj).
if ! command -v "$dotnet" >/dev/null 2>&1; then echo ".NET SDK 8 nu a fost găsit (dotnet)."; exit 2; fi
"$dotnet" build "$here/cs2/GcsBridge/GcsBridge.csproj" -c Release -p:DebugType=none -p:DebugSymbols=false -warnaserror
dotnet_version=$("$dotnet" --version)

names=""
old_ifs=$IFS
IFS=:
for dir in ${AMXX_INCLUDES:-}; do
  [ -n "$dir" ] && names="${names:+$names,}$(basename "$dir")"
done
IFS=$old_ifs
node "$here/release.mjs" --amxxpc "${amxx_version:-necunoscut}" --dotnet "$dotnet_version" --includes "$names"
