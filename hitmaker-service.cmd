@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0hitmaker-service.ps1" %*
exit /b %ERRORLEVEL%
