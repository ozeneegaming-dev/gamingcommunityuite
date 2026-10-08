#!/usr/bin/env sh
# GCS Server Bridge — compilarea pluginului AMX Mod X (Linux).
# Rulează doar dacă găsește compilatorul (amxxpc) din pachetul oficial AMX Mod X; nu descarcă nimic.
#   AMXXPC=/opt/amxmodx/scripting/amxxpc AMXX_INCLUDES=/opt/easy_http:/opt/reapi ./build.sh
# AMXX_INCLUDES: unul sau mai multe foldere de include-uri, separate prin „:”.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
compiler=${AMXXPC:-}
if [ -z "$compiler" ] || [ ! -x "$compiler" ]; then
  echo "Compilatorul AMX Mod X (amxxpc) nu a fost găsit. Setează AMXXPC (vezi servers-plugins/README.md)."
  exit 2
fi
mkdir -p "$here/build"
set -- "$here/gcs_bridge.sma" -o"$here/build/gcs_bridge.amxx" -i"$here"
old_ifs=$IFS
IFS=:
for dir in ${AMXX_INCLUDES:-}; do
  [ -n "$dir" ] && set -- "$@" -i"$dir"
done
IFS=$old_ifs
"$compiler" "$@"
