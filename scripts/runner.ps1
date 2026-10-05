# RED-LINE runner: ruleaza scripturile din scripts\ la cererea lui Claude.
#
# - Claude scrie numele job-ului in logs\run.request; runner-ul ruleaza scripts\<job>.cmd.
# - Doar job-urile din $Allowed sunt acceptate.
# - Un job care depaseste $TimeoutMinutes, sau pentru care apare logs\run.cancel, e oprit cu tot arborele de procese.
# - logs\runner.status arata starea curenta (heartbeat), ca Claude sa stie ca runner-ul traieste.
# Porneste-l cu dublu-click pe scripts\runner.cmd. Inchide fereastra ca sa-l opresti.

$ErrorActionPreference = "Continue"
$Allowed = @("check", "docker-up", "docker-down", "git-commit")
$TimeoutMinutes = 30

$Root = Split-Path -Parent $PSScriptRoot
$Logs = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
$Request = Join-Path $Logs "run.request"
$Cancel = Join-Path $Logs "run.cancel"
$Status = Join-Path $Logs "runner.status"
$Host.UI.RawUI.WindowTitle = "RED-LINE runner (Claude)"

function Set-Status([string]$text) {
  Set-Content -Path $Status -Value "$text`r`n$(Get-Date -Format o)" -Encoding UTF8
}

Write-Host "RED-LINE runner pornit in $Root"
Write-Host "Astept cereri de la Claude. Inchide fereastra ca sa opresti."
Remove-Item $Cancel -Force -ErrorAction SilentlyContinue

while ($true) {
  Set-Status "idle"
  if (Test-Path $Request) {
    $job = ((Get-Content $Request -Raw) -replace "\s", "")
    Remove-Item $Request -Force
    if ($Allowed -contains $job) {
      $script = Join-Path $PSScriptRoot "$job.cmd"
      $jobLog = Join-Path $Logs "$job.log"
      Write-Host "[$(Get-Date -Format HH:mm:ss)] Rulez $job ..."
      Set-Status "running $job"
      $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"`"$script`"`"" -WorkingDirectory $Root -PassThru -WindowStyle Hidden
      $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
      while (-not $proc.HasExited) {
        Set-Status "running $job"
        if ((Test-Path $Cancel) -or ((Get-Date) -gt $deadline)) {
          $why = if (Test-Path $Cancel) { "anulat" } else { "timeout $TimeoutMinutes min" }
          Remove-Item $Cancel -Force -ErrorAction SilentlyContinue
          & taskkill.exe /PID $proc.Id /T /F | Out-Null
          Add-Content -Path $jobLog -Value "=== OPRIT ($why) $(Get-Date -Format o) ==="
          Write-Host "[$(Get-Date -Format HH:mm:ss)] Oprit: $job ($why)"
          break
        }
        Start-Sleep -Seconds 2
      }
      Write-Host "[$(Get-Date -Format HH:mm:ss)] Gata: $job"
    } else {
      Write-Host "[$(Get-Date -Format HH:mm:ss)] Cerere ignorata: '$job' nu e in lista permisa."
    }
  }
  Start-Sleep -Seconds 3
}
