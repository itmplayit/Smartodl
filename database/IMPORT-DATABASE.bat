@echo off
setlocal EnableExtensions
title SmartODL Database Import
cd /d "%~dp0"

echo ============================================================
echo   SmartODL - Database Import / Reset
echo ============================================================
echo.
echo   WARNING: This deletes ALL DATA in the education_platform database
echo   and imports a fresh schema. If data already exists,
echo   take a backup first. Use this only for first setup or a RESET.
echo.
set /p "GO=Type Y and press Enter to continue: "
if /I not "%GO%"=="Y" (echo Cancelled. & pause & exit /b 0)
echo.

set "MYSQL="
if exist "C:\xampp\mysql\bin\mysql.exe" set "MYSQL=C:\xampp\mysql\bin\mysql.exe"
if not defined MYSQL (
  for /d %%D in ("C:\Program Files\MariaDB*") do (
    if not defined MYSQL if exist "%%D\bin\mysql.exe" set "MYSQL=%%D\bin\mysql.exe"
  )
)
if not defined MYSQL (
  for /f "delims=" %%M in ('where mysql 2^>nul') do if not defined MYSQL set "MYSQL=%%M"
)
if not defined MYSQL (
  echo [ERROR] mysql.exe was not found.
  echo.
  echo Easy alternative: open http://localhost/phpmyadmin, go to the Import tab,
  echo choose this file: %~dp0education_platform.sql
  echo and click Go. (Apache must be running in XAMPP for this.)
  echo.
  pause
  exit /b 1
)
echo [OK] mysql found: %MYSQL%

set "SQLFILE=%~dp0education_platform.sql"
if not exist "%SQLFILE%" (
  echo [ERROR] Schema file was not found: %SQLFILE%
  pause
  exit /b 1
)

rem Do not read the password through a visible `set /p` prompt and do not pass it
rem through `--password=...` on the command line (it appears in the process list).
rem PowerShell provides a masked prompt; the value reaches the mysql child process
rem only through this process's MYSQL_PWD environment variable.
set "MYSQL_PWD="
set "DBPASS="
for /f "delims=" %%P in ('powershell -NoProfile -Command "$s=Read-Host 'MySQL root password (press Enter if blank)' -AsSecureString; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Runtime.InteropServices.Marshal]::PtrToStringAuto($p)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}"') do set "DBPASS=%%P"
if defined DBPASS set "MYSQL_PWD=%DBPASS%"
set "DBPASS="
echo.
echo Importing %SQLFILE% ...
"%MYSQL%" --host=127.0.0.1 --user=root --default-character-set=utf8mb4 ^< "%SQLFILE%"
set "IMPORT_STATUS=%ERRORLEVEL%"
set "MYSQL_PWD="
if not "%IMPORT_STATUS%"=="0" (
  rem The shared error block below uses this status
  cmd /c exit /b %IMPORT_STATUS%
)
if errorlevel 1 (
  echo.
  echo [FAILED] The import could not be completed.
  echo Is MySQL running? Is the password correct?
  echo If you use XAMPP, start MySQL from its Control Panel,
  echo or import the file through phpMyAdmin.
) else (
  echo.
  echo [OK] Database imported successfully (45 tables).
  echo Now run Setup.bat or restart the Backend API.
)
echo.
pause
