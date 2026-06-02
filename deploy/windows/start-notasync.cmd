@echo off
setlocal
cd /d "%~dp0..\.."
npm run prisma:deploy
node dist\main.js
