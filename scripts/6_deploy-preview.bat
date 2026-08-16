@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem AI AGENT NOTE: bump DEPLOY_PREVIEW_VERSION every time this file is updated.
set "DEPLOY_PREVIEW_VERSION=1.0.1"
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "PROJECT_ROOT="
set "IS_NO_PAUSE=0"

if /I "%DEPLOY_PREVIEW_NO_PAUSE%"=="1" set "IS_NO_PAUSE=1"
if /I "%CI%"=="true" set "IS_NO_PAUSE=1"

for %%A in (%*) do (
  if /I "%%~A"=="--no-pause" set "IS_NO_PAUSE=1"
)

if exist "%SCRIPT_DIR%\playable-shared-kit\tools\deploy-preview.cjs" (
  set "PROJECT_ROOT=%SCRIPT_DIR%"
) else (
  for %%I in ("%SCRIPT_DIR%\..\..") do set "PROJECT_ROOT=%%~fI"
)

if not exist "%PROJECT_ROOT%\playable-shared-kit\tools\deploy-preview.cjs" (
  echo [deploy-preview] Unable to locate playable-shared-kit\tools\deploy-preview.cjs from "%SCRIPT_DIR%"
  if /I not "!IS_NO_PAUSE!"=="1" pause
  exit /b 1
)

echo.
echo ================================================================================
echo ===================== DEPLOY LIVE PREVIEW v%DEPLOY_PREVIEW_VERSION% =====================
echo ================================================================================
echo [info] Project root: %PROJECT_ROOT%
echo.

node --version >nul 2>&1
if errorlevel 1 (
  echo [deploy-preview] ERROR: Node.js is required but not found in PATH.
  if /I not "!IS_NO_PAUSE!"=="1" pause
  exit /b 1
)

node "%PROJECT_ROOT%\playable-shared-kit\tools\deploy-preview.cjs" %*
set "DEPLOY_EXIT_CODE=%errorlevel%"

echo.
if /I not "!IS_NO_PAUSE!"=="1" (
  echo Press any key to exit...
  pause >nul
)

exit /b %DEPLOY_EXIT_CODE%
