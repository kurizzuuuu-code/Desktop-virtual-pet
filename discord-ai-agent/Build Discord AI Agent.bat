@echo off
cd /d "%~dp0"
call npm install
call npm run build
echo.
echo Built exe is in the dist folder.
pause
