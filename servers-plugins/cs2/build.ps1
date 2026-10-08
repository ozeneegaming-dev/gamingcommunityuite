# GCS Server Bridge — compilarea pluginului CS2 (CounterStrikeSharp, .NET 8). Rulează doar cu .NET SDK 8 instalat.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  Write-Host ".NET SDK 8 nu a fost găsit (dotnet). Vezi servers-plugins/README.md."
  exit 2
}
dotnet build (Join-Path $here "GcsBridge/GcsBridge.csproj") -c Release
exit $LASTEXITCODE
