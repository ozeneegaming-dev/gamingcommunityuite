@echo off
rem Ruleaza install, test, typecheck, lint si build; scrie totul in logs\check.log.
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs
set "LOG=logs\check.log"
set "CHECKPOINT_DISABLE=1"
set "PRISMA_HIDE_UPDATE_MESSAGE=1"
set "NEXT_TELEMETRY_DISABLED=1"
set "TURBO_TELEMETRY_DISABLED=1"
echo === START %date% %time% === > "%LOG%"
call node -v >> "%LOG%" 2>&1 < nul

echo === pnpm install === >> "%LOG%"
call pnpm.cmd install >> "%LOG%" 2>&1 < nul
echo [install exit %errorlevel%] >> "%LOG%"
echo === pnpm test === >> "%LOG%"
call pnpm.cmd test >> "%LOG%" 2>&1 < nul
echo [test exit %errorlevel%] >> "%LOG%"
echo === pnpm typecheck === >> "%LOG%"
call pnpm.cmd typecheck >> "%LOG%" 2>&1 < nul
echo [typecheck exit %errorlevel%] >> "%LOG%"
echo === pnpm lint === >> "%LOG%"
call pnpm.cmd lint >> "%LOG%" 2>&1 < nul
echo [lint exit %errorlevel%] >> "%LOG%"
echo === pnpm build === >> "%LOG%"
call pnpm.cmd build >> "%LOG%" 2>&1 < nul
echo [build exit %errorlevel%] >> "%LOG%"
echo === GATA %date% %time% === >> "%LOG%"
endlocal
