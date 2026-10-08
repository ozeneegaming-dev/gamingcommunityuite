# GCS Server Bridge — pasul de release (specul 2026-10-08-servere-plugin-v2 §6), Windows.
# Compilează ambele pluginuri cu uneltele date (nu descarcă nimic) și scrie servers-plugins/release/: binarele, sursele
# cerute de licență, configurile-șablon și manifest.json (versiunile, sha256, uneltele). Apoi: git add servers-plugins/release.
#   .\release.ps1 -Compiler "C:\amxmodx\scripting\amxxpc.exe" -Includes "C:\easy_http","C:\reapi" -Dotnet "C:\dotnet8\dotnet.exe"
# Parametrii se pot da și prin AMXXPC, AMXX_INCLUDES (separate prin „;”) și DOTNET_EXE.
param(
  [string]$Compiler = $env:AMXXPC,
  [string[]]$Includes = @($env:AMXX_INCLUDES),
  [string]$Dotnet = $(if ($env:DOTNET_EXE) { $env:DOTNET_EXE } else { "dotnet" })
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dirs = @($Includes | ForEach-Object { "$_" -split ";" } | Where-Object { $_ })

# CS 1.6: versiunea compilatorului din ieșirea lui; orice avertisment oprește release-ul.
$amxx = & (Join-Path $here "amxx/build.ps1") -Compiler $Compiler -Includes $dirs 2>&1 | Out-String
Write-Host $amxx
if ($LASTEXITCODE -ne 0 -or $amxx -notmatch "Done\.") { Write-Host "Compilarea AMX Mod X a eșuat."; exit 1 }
if ($amxx -match "(?i)warning|error") { Write-Host "Compilarea AMX Mod X are avertismente sau erori."; exit 1 }
$amxxVersion = if ($amxx -match "Compiler (\d+(\.\d+)+)") { $Matches[1] } else { "necunoscut" }

# CS2: fără .pdb și fără căile locale în DLL (build reproductibil, vezi GcsBridge.csproj).
if (-not (Get-Command $Dotnet -ErrorAction SilentlyContinue)) { Write-Host ".NET SDK 8 nu a fost găsit (dotnet)."; exit 2 }
& $Dotnet build (Join-Path $here "cs2/GcsBridge/GcsBridge.csproj") -c Release -p:DebugType=none -p:DebugSymbols=false -warnaserror
if ($LASTEXITCODE -ne 0) { Write-Host "Compilarea CS2 a eșuat."; exit 1 }
$dotnetVersion = (& $Dotnet --version).Trim()

$names = ($dirs | ForEach-Object { Split-Path -Leaf $_ }) -join ","
node (Join-Path $here "release.mjs") --amxxpc $amxxVersion --dotnet $dotnetVersion --includes $names
exit $LASTEXITCODE
