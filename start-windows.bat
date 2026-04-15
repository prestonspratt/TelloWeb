@echo off
echo.
echo  DroneCode Proxy Launcher
echo  ========================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo  ERROR: Node.js is not installed!
    echo  Download it from https://nodejs.org ^(LTS version^)
    echo.
    pause
    exit /b 1
)

echo  Node.js found: 
node --version

:: Install dependencies if needed
if not exist "node_modules" (
    echo.
    echo  Installing dependencies...
    npm install
)

echo.
echo  Starting proxy server...
echo  Press Ctrl+C to stop.
echo.
node proxy.js
pause
