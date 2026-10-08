#!/usr/bin/env sh
# GCS Server Bridge — compilarea pluginului CS2 (CounterStrikeSharp, .NET 8). Rulează doar cu .NET SDK 8 instalat.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
if ! command -v dotnet >/dev/null 2>&1; then
  echo ".NET SDK 8 nu a fost găsit (dotnet). Vezi servers-plugins/README.md."
  exit 2
fi
dotnet build "$here/GcsBridge/GcsBridge.csproj" -c Release
