@echo off
rem RED-LINE runner: ruleaza scripturile din scripts\ la cererea lui Claude.
rem Claude scrie numele scriptului (ex. "verifica") in logs\run.request;
rem runner-ul ruleaza scripts\<nume>.cmd si sterge cererea. Rezultatul ramane in logs\.
rem Porneste-l cu dublu-click si lasa fereastra deschisa. Inchide fereastra ca sa-l opresti.
title RED-LINE runner (Claude)
setlocal EnableDelayedExpansion
cd /d "%~dp0.."
if not exist logs mkdir logs
echo RED-LINE runner pornit in %cd%
echo Astept cereri de la Claude. Inchide fereastra ca sa opresti.
:loop
if exist "logs\run.request" (
  set "JOB="
  set /p JOB=<"logs\run.request"
  del "logs\run.request"
  set "OK="
  for %%N in (verifica docker-up docker-down git-commit) do if /i "!JOB!"=="%%N" set "OK=1"
  if defined OK (
    echo [!time!] Rulez scripts\!JOB!.cmd ...
    call "scripts\!JOB!.cmd"
    echo [!time!] Gata: !JOB!
  ) else (
    echo [!time!] Cerere ignorata: "!JOB!" nu e in lista permisa.
  )
)
timeout /t 3 /nobreak >nul
goto loop
