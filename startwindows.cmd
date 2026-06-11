@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0startwindows.ps1" %*
exit /b %ERRORLEVEL%
