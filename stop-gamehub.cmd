@echo off
setlocal EnableExtensions EnableDelayedExpansion
title GameHub - Stop
cd /d "%~dp0"

set "PORT=8123"
set "FOUND="

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  if not defined FOUND (
    set "FOUND=1"
    echo [GameHub] stopping PID %%P on port %PORT% ...
    taskkill /PID %%P /F >nul 2>nul
  )
)

if defined FOUND (
  echo [GameHub] stopped.
) else (
  echo [GameHub] nothing is listening on port %PORT%.
)

timeout /t 2 >nul
exit /b 0
