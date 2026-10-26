@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
cd /d "%~dp0"
set "ROOT=%CD%"
title SmartODL Setup and Launcher

cls
echo ============================================================
echo              SmartODL - Automatic Windows Setup
echo ============================================================
echo.

rem ---------- Required tools ----------
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js 20 LTS or newer, then run Setup.bat again.
  goto :failed
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js with npm enabled.
  goto :failed
)

set "NODE_MAJOR="
for /f "delims=" %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR (
  echo [ERROR] Could not determine the Node.js version.
  goto :failed
)
if %NODE_MAJOR% LSS 20 (
  echo [ERROR] Node.js 20 or newer is required. Current version:
  node --version
  goto :failed
)
echo [OK] Node.js
node --version

rem ---------- Dependencies: installed only when missing ----------
call :ensure_dependencies "Backend API" "backend" "node_modules\express\package.json"
if errorlevel 1 goto :failed
call :ensure_dependencies "Frontend" "frontend" "node_modules\.bin\vite.cmd"
if errorlevel 1 goto :failed
call :ensure_dependencies "Judge worker" "backend\judge-service" "node_modules\express\package.json"
if errorlevel 1 goto :failed

rem ---------- First-run local environment ----------
echo.
echo [SETUP] Checking local configuration...
node "backend\scripts\setup-local-env.js"
if not errorlevel 1 goto :configuration_ready
echo.
echo Existing .env files are incomplete or unsuitable for this local launcher.
set /p "RESET_LOCAL=Back them up and generate fresh local development configuration? [Y/N]: "
if /I not "%RESET_LOCAL%"=="Y" goto :failed
node "backend\scripts\setup-local-env.js" --reset-local
if errorlevel 1 goto :failed

:configuration_ready
set "JUDGE_MODE="
set "DB_HOST="
set "DB_PORT="
for /f "delims=" %%V in ('node "backend\scripts\setup-local-env.js" --print-judge-mode') do set "JUDGE_MODE=%%V"
for /f "delims=" %%V in ('node "backend\scripts\setup-local-env.js" --print-db-host') do set "DB_HOST=%%V"
for /f "delims=" %%V in ('node "backend\scripts\setup-local-env.js" --print-db-port') do set "DB_PORT=%%V"

if not defined JUDGE_MODE (
  echo [ERROR] JUDGE_MODE could not be read from backend\.env.
  goto :failed
)
if not defined DB_PORT set "DB_PORT=3306"

rem ---------- Try standard XAMPP MySQL when a local DB is not running ----------
if /I "%DB_HOST%"=="127.0.0.1" call :ensure_local_mysql
if /I "%DB_HOST%"=="localhost" call :ensure_local_mysql

rem ---------- Restart project services so backend route/code updates load ----------
echo.
echo [RESTART] Closing previous SmartODL service windows...
call :stop_project_window "SmartODL Judge Worker"
call :stop_project_window "SmartODL Backend API"
call :stop_project_window "SmartODL Frontend"
rem A manually launched API may not have our window title. Stop it only when its
rem health response proves that the listener on port 5000 is SmartODL itself.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $r=Invoke-RestMethod -TimeoutSec 2 'http://127.0.0.1:5000/api/health'; if ($r.service -eq 'smartodl-api') { $ownerPid=(Get-NetTCPConnection -State Listen -LocalPort 5000 | Select-Object -First 1 -ExpandProperty OwningProcess); if ($ownerPid) { Stop-Process -Id $ownerPid -Force } }" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Milliseconds 750" >nul 2>&1

echo.
echo [START] Starting SmartODL services...

if /I "%JUDGE_MODE%"=="local" (
  echo [NOTICE] Windows judge mode is for trusted local/classroom development only.
  echo          Public code execution must use the isolated Linux worker or Judge0.
  call :is_port_open 2358
  if errorlevel 1 (
    echo [START] Judge worker on http://127.0.0.1:2358
    start "SmartODL Judge Worker" /D "%ROOT%\backend\judge-service" cmd /k "title SmartODL Judge Worker ^&^& npm start"
  ) else (
    echo [SKIP] Port 2358 is already open; judge worker was not duplicated.
  )
) else (
  echo [SKIP] Local judge worker is disabled because JUDGE_MODE=%JUDGE_MODE%.
)

call :is_port_open 5000
if errorlevel 1 (
  echo [START] Backend API on http://127.0.0.1:5000
  start "SmartODL Backend API" /D "%ROOT%\backend" cmd /k "title SmartODL Backend API ^&^& npm start"
) else (
  echo [SKIP] Port 5000 is already open; backend was not duplicated.
)

call :is_port_open 5173
if errorlevel 1 (
  echo [START] Frontend on http://localhost:5173
  start "SmartODL Frontend" /D "%ROOT%\frontend" cmd /k "title SmartODL Frontend ^&^& npm run dev"
) else (
  echo [SKIP] Port 5173 is already open; frontend was not duplicated.
)

rem ---------- Wait for health and open the site ----------
echo.
echo [WAIT] Waiting for the frontend and API...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$deadline=(Get-Date).AddSeconds(75); $web=$false; $api=$false;" ^
  "do {" ^
  "  try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:5173'; $web=($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) } catch {}" ^
  "  try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:5000/api/health'; $api=($r.StatusCode -eq 200) } catch {}" ^
  "  if (-not ($web -and $api)) { Start-Sleep -Seconds 1 }" ^
  "} while ((Get-Date) -lt $deadline -and -not ($web -and $api));" ^
  "if ($web -and $api) { exit 0 } else { exit 1 }"

if errorlevel 1 (
  echo.
  echo [WARNING] One or more services did not become healthy within 75 seconds.
  echo Check the opened service windows. The most common cause is MySQL not
  echo running or incorrect DB_* values in backend\.env.
) else (
  echo [OK] Frontend and API are healthy.
)

start "" "http://localhost:5173"
echo.
echo ============================================================
echo SmartODL has been launched.
echo Frontend:  http://localhost:5173
echo API:       http://localhost:5000/api/health
if /I "%JUDGE_MODE%"=="local" echo Judge:     http://127.0.0.1:2358/health
 echo.
echo Keep the three SmartODL service windows open while using the app.
echo Run Setup.bat again after an update; existing SmartODL services are restarted.
echo ============================================================
echo.
pause
exit /b 0

:ensure_dependencies
set "SERVICE_LABEL=%~1"
set "SERVICE_DIR=%~2"
set "SERVICE_CHECK=%~3"
if exist "%ROOT%\%SERVICE_DIR%\%SERVICE_CHECK%" (
  echo [OK] %SERVICE_LABEL% dependencies are installed.
  exit /b 0
)
echo.
echo [INSTALL] %SERVICE_LABEL% dependencies...
pushd "%ROOT%\%SERVICE_DIR%" >nul
call npm ci --no-audit --no-fund
set "INSTALL_RESULT=%ERRORLEVEL%"
popd >nul
if not "%INSTALL_RESULT%"=="0" (
  echo [ERROR] Dependency installation failed for %SERVICE_LABEL%.
  exit /b %INSTALL_RESULT%
)
echo [OK] %SERVICE_LABEL% dependencies installed.
exit /b 0

:stop_project_window
set "SERVICE_WINDOW=%~1"
for /f "delims=" %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$label='%SERVICE_WINDOW%'; foreach ($p in (Get-Process)) { if ($p.MainWindowTitle -like ('*' + $label + '*')) { Write-Output $p.Id } }"') do taskkill /PID %%P /T /F >nul 2>&1
exit /b 0

:is_port_open
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', %~1); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
exit /b %ERRORLEVEL%

:ensure_local_mysql
call :is_port_open %DB_PORT%
if not errorlevel 1 (
  echo [OK] Local database port %DB_PORT% is open.
  exit /b 0
)
set "XAMPP_DIR=%XAMPP_HOME%"
if not defined XAMPP_DIR set "XAMPP_DIR=C:\xampp"
if exist "%XAMPP_DIR%\mysql_start.bat" (
  echo [START] Local MySQL is not running; starting XAMPP MySQL...
  start "XAMPP MySQL" /D "%XAMPP_DIR%" cmd /k "title XAMPP MySQL ^&^& call mysql_start.bat"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=(Get-Date).AddSeconds(30); do { $c=New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', %DB_PORT%); $c.Close(); exit 0 } catch { Start-Sleep -Seconds 1 } } while ((Get-Date) -lt $d); exit 1" >nul 2>&1
  if errorlevel 1 (
    echo [WARNING] XAMPP MySQL did not open port %DB_PORT% within 30 seconds.
  ) else (
    echo [OK] XAMPP MySQL is running.
  )
) else (
  echo [WARNING] No database is listening on local port %DB_PORT%.
  echo Start MySQL/MariaDB manually before the API connects.
)
exit /b 0

:failed
echo.
echo ============================================================
echo Setup could not complete. Fix the error above and run Setup.bat again.
echo ============================================================
echo.
pause
exit /b 1
