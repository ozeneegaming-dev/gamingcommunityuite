@echo off
rem Ruleaza install, test, typecheck si lint si scrie totul in logs\verifica.log.
rem Claude citeste log-ul dupa rulare. Fereastra se inchide singura la final.
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs
set "LOG=logs\verifica.log"
echo === START %date% %time% === > "%LOG%"
where node >> "%LOG%" 2>&1
call node -v >> "%LOG%" 2>&1
where docker >> "%LOG%" 2>&1
where git >> "%LOG%" 2>&1
echo. >> "%LOG%"
echo === pnpm install === >> "%LOG%"
call pnpm.cmd install >> "%LOG%" 2>&1
echo [install exit %errorlevel%] >> "%LOG%"
echo === pnpm test === >> "%LOG%"
call pnpm.cmd test >> "%LOG%" 2>&1
echo [test exit %errorlevel%] >> "%LOG%"
echo === pnpm typecheck === >> "%LOG%"
call pnpm.cmd typecheck >> "%LOG%" 2>&1
echo [typecheck exit %errorlevel%] >> "%LOG%"
echo === pnpm lint === >> "%LOG%"
call pnpm.cmd lint >> "%LOG%" 2>&1
echo [lint exit %errorlevel%] >> "%LOG%"
echo === GATA %date% %time% === >> "%LOG%"
endlocal
