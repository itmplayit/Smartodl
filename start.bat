@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title SmartODL Launcher

echo Starting the supported SmartODL Windows setup/launcher...
echo This script delegates to Setup.bat and does not stop unrelated Node.js processes.
echo.
call "%~dp0Setup.bat"
exit /b %ERRORLEVEL%
