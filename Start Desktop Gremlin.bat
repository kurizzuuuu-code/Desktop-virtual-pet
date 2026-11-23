@echo off
title Desktop Gremlin
cd /d "%~dp0"

set "EXE_DIST=build-output\Desktop Gremlin 1.80.0.exe"
set "EXE_ROOT=Desktop Gremlin.exe"

if exist "%EXE_ROOT%" (
  echo Starting Desktop Gremlin...
  start "" "%EXE_ROOT%"
  goto done
)

if exist "%EXE_DIST%" (
  echo Starting Desktop Gremlin...
  start "" "%EXE_DIST%"
  goto done
)

echo No executable found. Building now — this may take a few minutes...
call "%~dp0Build Desktop Gremlin.exe.bat"
if errorlevel 1 exit /b 1

if exist "%EXE_DIST%" (
  copy /Y "%EXE_DIST%" "%EXE_ROOT%" >nul
  start "" "%EXE_ROOT%"
) else (
  echo Build finished but exe was not found. Try running Build Desktop Gremlin.exe.bat
  pause
  exit /b 1
)

:done
echo.
echo Desktop Gremlin is running.
echo - Double-click pet = settings
echo - Hold right-click on pet = grab and drag
echo - Pink tray icon = turn ON/OFF or quit
echo.
