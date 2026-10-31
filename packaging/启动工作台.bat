@echo off
chcp 65001 >nul
cd /d "%~dp0"
"%~dp0node.exe" "%~dp0start.mjs"
if errorlevel 1 pause
