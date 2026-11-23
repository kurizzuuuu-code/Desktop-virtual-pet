@echo off
title Build Desktop Gremlin.exe
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js from https://nodejs.org/
  pause
  exit /b 1
)

echo Installing dependencies...
call npm install
if errorlevel 1 goto fail

echo Building Desktop Gremlin Portable Exe...
call npm run build:portable
if errorlevel 1 goto fail

for %%f in ("build-output\Desktop Gremlin *Portable.exe") do set "EXE_DIST=%%f"
if not defined EXE_DIST set "EXE_DIST=build-output\Desktop Gremlin 1.81.9 Portable.exe"
set "EXE_ROOT=Desktop Gremlin.exe"

if exist "%EXE_DIST%" (
  copy /Y "%EXE_DIST%" "%EXE_ROOT%" >nul
)
echo.
echo Done!
echo   %EXE_ROOT%  ^(main launcher — double-click this^)
echo   %EXE_DIST%
echo.
explorer "build-output"
goto end

:fail
echo Build failed.
pause
exit /b 1

:end
pause
