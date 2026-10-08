# GCS Server Bridge — compilarea pluginului CS2 (CounterStrikeSharp, .NET 8). Rulează doar cu .NET SDK 8 instalat.
#   .\build.ps1 [-Dotnet "C:\tools\dotnet8\dotnet.exe"]   (implicit: dotnet din PATH sau variabila DOTNET_EXE)
param(
  [string]$Dotnet = $(if ($env:DOTNET_EXE) { $env:DOTNET_EXE } else { "dotnet" })
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Get-Command $Dotnet -ErrorAction SilentlyContinue)) {
  Write-Host ".NET SDK 8 nu a fost găsit (dotnet). Vezi servers-plugins/README.md."
  exit 2
}
# Un dotnet fără SDK (doar runtime-ul) nu poate compila.
if (-not (& $Dotnet --list-sdks | Where-Object { $_ -match '^([89]|\d\d)\.' })) {
  Write-Host "dotnet nu are un SDK 8 sau mai nou (doar runtime-ul?). Instalează .NET SDK 8 sau dă -Dotnet. Vezi servers-plugins/README.md."
  exit 2
}
& $Dotnet build (Join-Path $here "GcsBridge/GcsBridge.csproj") -c Release
exit $LASTEXITCODE
