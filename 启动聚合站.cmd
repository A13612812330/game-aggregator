@echo off
setlocal EnableExtensions
title GameHub - Aggregator
cd /d "%~dp0"

set "PORT=8123"
set "URL=http://localhost:%PORT%"
set "WEB=https://gamehub-agg-v4.app.workbuddy.host/"

REM ============ 1) already running? just open the browser ============
set "RUNPID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do if not defined RUNPID set "RUNPID=%%P"
if defined RUNPID (
  echo [GameHub] already running on port %PORT% ^(PID %RUNPID%^)
  echo [GameHub] opening %URL%
  start "" "%URL%"
  timeout /t 3 >nul
  exit /b 0
)

REM ============ 2) locate node ============
REM   PATH first, then the managed runtime. NEVER hard-code the version folder:
REM   it carries a build suffix (22.22.2-3) that changes whenever the runtime is
REM   updated, and a stale literal makes this fallback fail SILENTLY (the old
REM   22.22.2-2 no longer exists). Scan the folder, newest name first.
set "NODE="
set "VBASE=%USERPROFILE%\.workbuddy\binaries\node\versions"
where node >nul 2>nul && set "NODE=node"
if not defined NODE for /f "delims=" %%D in ('dir /b /ad /o-n "%VBASE%" 2^>nul') do if not defined NODE if exist "%VBASE%\%%D\node.exe" set "NODE=%VBASE%\%%D\node.exe"
if not defined NODE (
  echo [GameHub] ERROR: Node.js not found.
  echo          Install Node 18+ or edit the NODE path in this file.
  echo.
  pause
  exit /b 1
)

REM ============ 2b) wait until the port is really free (v10.42) ============
REM   Why: server.js used to bump to %PORT%+1 when the port was taken, so a
REM   restart could silently leave the OLD process on %PORT% and start a second
REM   instance next to it. server.js now refuses to shift (it exits with an
REM   error instead), but a service that is still holding the port while it
REM   shuts down would still make this launch fail. So wait here, and say so
REM   clearly instead of opening a page that cannot work.
set "WAITS=0"
:WAITFREE
set "BUSYPID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do if not defined BUSYPID set "BUSYPID=%%P"
if not defined BUSYPID goto FREEOK
set /a WAITS+=1
if %WAITS% GEQ 20 goto FREENO
timeout /t 1 >nul
goto WAITFREE
:FREENO
echo [GameHub] ERROR: port %PORT% is still in use by PID %BUSYPID% (waited 20s).
echo [GameHub]        Run stop-gamehub.cmd first, then start this launcher again.
echo [GameHub]        This launcher will NOT fall back to another port.
echo.
pause
exit /b 1
:FREEOK

REM ============ 3) show LAN address (for phone / other PCs) ============
set "LANIP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do if not defined LANIP set "LANIP=%%a"
set "LANIP=%LANIP: =%"

echo ============================================================
echo   GameHub  -  aggregator (jidi + XDGAME)
echo ------------------------------------------------------------
echo   local :  %URL%
if defined LANIP echo   LAN   :  http://%LANIP%:%PORT%
echo   node  :  %NODE%
echo   web   :  %WEB%
echo   stop  :  run "stop-gamehub.cmd"  (or close this window)
echo ============================================================
echo.

start "" "%URL%"
"%NODE%" server.js

echo.
echo [GameHub] service stopped. Press any key to close...
pause >nul
