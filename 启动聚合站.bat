@echo off
setlocal
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "C://Users//komo//.workbuddy//binaries//node//versions//22.22.2//node.exe" set "NODE=C://Users//komo//.workbuddy//binaries//node//versions//22.22.2//node.exe"
)
echo [GameHub] Starting aggregator on http://localhost:8123  (first fetch ~5-10s)...
start "" http://localhost:8123
"%NODE%" server.js
echo.
echo Service stopped. Press any key to close...
pause >nul
