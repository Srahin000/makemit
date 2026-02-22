@echo off
REM Process a single audio file with Rhubarb Lip Sync (Windows)
REM 
REM Usage:
REM   scripts\process-audio.bat <audio-file>
REM 
REM Example:
REM   scripts\process-audio.bat public\audio\audio.wav

if "%~1"=="" (
    echo Error: No audio file specified
    echo Usage: scripts\process-audio.bat ^<audio-file^>
    echo Example: scripts\process-audio.bat public\audio\audio.wav
    exit /b 1
)

set AUDIO_FILE=%~1

if not exist "%AUDIO_FILE%" (
    echo Error: Audio file not found: %AUDIO_FILE%
    exit /b 1
)

REM Get directory and base name
for %%F in ("%AUDIO_FILE%") do (
    set AUDIO_DIR=%%~dpF
    set AUDIO_NAME=%%~nF
)

set JSON_FILE=%AUDIO_DIR%%AUDIO_NAME%.json

echo Processing: %AUDIO_FILE%
echo Output: %JSON_FILE%

REM Check if Rhubarb is available
where rhubarb >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Error: Rhubarb CLI not found
    echo Please install Rhubarb Lip Sync:
    echo   Download from https://github.com/DanielSWolf/rhubarb-lip-sync/releases
    echo   Add rhubarb.exe to your PATH, or use the full path
    exit /b 1
)

REM Run Rhubarb
rhubarb -f json -o "%JSON_FILE%" "%AUDIO_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✅ Success! Rhubarb JSON created: %JSON_FILE%
    echo The web app will automatically use this file for accurate lip-sync.
) else (
    echo.
    echo ❌ Error processing audio file
    exit /b 1
)

