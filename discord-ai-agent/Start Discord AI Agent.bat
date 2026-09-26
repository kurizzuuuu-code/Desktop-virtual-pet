@echo off
cd /d "%~dp0"
:: Dynamically look for any .exe in the dist folder
for %%f in (dist\*.exe) do (
    start "" "%%f"
    exit /b 0
)
:: Fallback to running live code if no executable is built
call npm start