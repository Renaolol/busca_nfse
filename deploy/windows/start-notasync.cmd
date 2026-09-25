@echo off
setlocal
cd /d "%~dp0..\.."
call npm.cmd run prisma:deploy
if errorlevel 1 exit /b %errorlevel%
node dist\main.js
