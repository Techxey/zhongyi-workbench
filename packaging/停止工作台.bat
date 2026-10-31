@echo off
chcp 65001 >nul
cd /d "%~dp0"
"%~dp0node.exe" "%~dp0stop.mjs"
timeout /t 2 >nul
