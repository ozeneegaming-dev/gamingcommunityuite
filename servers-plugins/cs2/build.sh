#!/usr/bin/env sh
# GCS Server Bridge — compilarea pluginului CS2 (CounterStrikeSharp, .NET 8). Rulează doar cu .NET SDK 8 instalat.
#   DOTNET_EXE=/opt/dotnet8/dotnet ./build.sh   (implicit: dotnet din PATH)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
dotnet=${DOTNET_EXE:-dotnet}
if ! command -v "$dotnet" >/dev/null 2>&1; then
  echo ".NET SDK 8 nu a fost găsit (dotnet). Vezi servers-plugins/README.md."
  exit 2
fi
# Un dotnet fără SDK (doar runtime-ul) nu poate compila.
if ! "$dotnet" --list-sdks | grep -Eq '^([89]|[0-9][0-9])\.'; then
  echo "dotnet nu are un SDK 8 sau mai nou (doar runtime-ul?). Instalează .NET SDK 8 sau setează DOTNET_EXE. Vezi servers-plugins/README.md."
  exit 2
fi
"$dotnet" build "$here/GcsBridge/GcsBridge.csproj" -c Release
