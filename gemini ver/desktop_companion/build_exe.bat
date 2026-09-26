@echo off
title Build Desktop Pet Companion EXE
echo ========================================================
echo   Desktop Pet Companion - Build Standalone EXE
echo ========================================================
echo.

python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python is not found in your PATH.
    echo Please install Python 3.9+ from https://www.python.org/
    pause
    exit /b 1
)

echo [1/3] Installing dependencies and PyInstaller...
pip install -r requirements.txt
pip install pyinstaller

echo.
echo [2/3] Compiling into standalone Windows application (.exe)...
pyinstaller --noconfirm --onedir --windowed ^
    --name "DesktopCompanion" ^
    --add-data "config.json;." ^
    --add-data "assets;assets" ^
    main.py

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo   BUILD SUCCESSFUL!
    echo   Your standalone application is ready at:
    echo   dist\DesktopCompanion\DesktopCompanion.exe
    echo ========================================================
) else (
    echo.
    echo [ERROR] Build failed. Review error output above.
)
pause
