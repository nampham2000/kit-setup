@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "ROOT=%SCRIPT_DIR%"
set "SHARED_KIT=%ROOT%\playable-shared-kit"
if not exist "%SHARED_KIT%\scripts\0_setup-all.bat" (
    for %%I in ("%SCRIPT_DIR%\..") do set "SHARED_KIT=%%~fI"
    if exist "!SHARED_KIT!\scripts\0_setup-all.bat" (
        for %%J in ("!SHARED_KIT!\..") do set "ROOT=%%~fJ"
    )
)

if not exist "%ROOT%\package.json" (
    echo [ERROR] Could not locate game project root from "%SCRIPT_DIR%".
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b 1
)
if not exist "%SHARED_KIT%\" (
    echo [ERROR] playable-shared-kit folder not found under "%ROOT%".
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b 1
)

node "%SHARED_KIT%\tools\setup-project.cjs" "%ROOT%"
set "SETUP_RESULT=%ERRORLEVEL%"
if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
exit /b %SETUP_RESULT%
