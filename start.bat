@echo off
REM ============================================================
REM  EduCode — one-click restart (Windows)
REM  Double-click this file. It:
REM    1. Kills every old node process (fixes "old backend still running")
REM    2. Applies all database updates (safe, idempotent)
REM    3. Starts the backend + frontend in two new windows
REM ============================================================
cd /d "%~dp0"

echo.
echo [1/5] Stopping old EduCode processes...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul


echo [3/5] Starting backend (API on port 5000)...
start "EduCode API" cmd /k "cd /d "%~dp0backend" && npm install && npm start"
timeout /t 3 /nobreak >nul

echo [4/5] Starting frontend (app on port 5173)...
start "EduCode Web" cmd /k "cd /d "%~dp0frontend" && npm install && npm run dev"

echo [5/5] Starting judge service (app on port 2358)...
start "EduCode Judge" cmd /k "cd /d "%~dp0backend\judge-service\" && npm install && npm start"

echo.
echo ============================================================
echo  DONE! Wait ~5 seconds, then open:
echo      http://localhost:5173
echo  Login: admin@educode.dev / Admin@123
echo  (Press Ctrl+Shift+R once in the browser to clear old cache)
echo ============================================================
pause