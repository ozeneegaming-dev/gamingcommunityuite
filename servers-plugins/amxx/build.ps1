# GCS Server Bridge — compilarea pluginului AMX Mod X (Windows).
# Rulează doar dacă găsește compilatorul (amxxpc.exe) din pachetul oficial AMX Mod X; nu descarcă nimic.
#   .\build.ps1 -Compiler "C:\amxmodx\addons\amxmodx\scripting\amxxpc.exe" [-Includes "C:\includes"]
param(
  [string]$Compiler = $env:AMXXPC,
  [string]$Includes = $env:AMXX_INCLUDES
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Compiler -or -not (Test-Path $Compiler)) {
  Write-Host "Compilatorul AMX Mod X (amxxpc.exe) nu a fost găsit. Setează -Compiler sau variabila AMXXPC (vezi servers-plugins/README.md)."
  exit 2
}
$out = Join-Path $here "build"
New-Item -ItemType Directory -Force $out | Out-Null
$compileArgs = @((Join-Path $here "gcs_bridge.sma"), "-o$(Join-Path $out 'gcs_bridge.amxx')", "-i$here")
# Include-urile AmxxEasyHttp (easy_http.inc) și, opțional, ReAPI (reapi.inc).
if ($Includes) { $compileArgs += "-i$Includes" }
& $Compiler @compileArgs
exit $LASTEXITCODE
