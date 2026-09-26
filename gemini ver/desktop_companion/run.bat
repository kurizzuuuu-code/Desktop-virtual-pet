@echo off
title Desktop Pet Companion
echo Starting Desktop Pet Companion...
python main.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo An error occurred. Please ensure dependencies are installed:
    echo pip install -r requirements.txt
    pause
)
