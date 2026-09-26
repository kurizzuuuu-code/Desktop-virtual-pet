@echo off
title Virtual Pet
cd /d "%~dp0"

set "EXE_DIST=build-output\Virtual Pet 1.60.0.exe"
set "EXE_ROOT=Virtual Pet.exe"

if exist "%EXE_ROOT%" (
  echo Starting Virtual Pet...
  start "" "%EXE_ROOT%"
  goto done
)

if exist "%EXE_DIST%" (
  echo Starting Virtual Pet...
  start "" "%EXE_DIST%"
  goto done
)

echo No executable found. Building now — this may take a few minutes...
call "%~dp0Build Virtual Pet.exe.bat"
if errorlevel 1 exit /b 1

if exist "%EXE_DIST%" (
  copy /Y "%EXE_DIST%" "%EXE_ROOT%" >nul
  start "" "%EXE_ROOT%"
) else (
  echo Build finished but exe was not found. Try running Build Virtual Pet.exe.bat
  pause
  exit /b 1
)

:done
echo.
echo Virtual Pet is running.
echo - Double-click pet = settings
echo - Hold right-click on pet = grab and drag
echo - Pink tray icon = turn ON/OFF or quit
echo.
