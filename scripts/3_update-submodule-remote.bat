@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem AI AGENT NOTE: bump UPDATE_SUBMODULE_REMOTE_VERSION every time this file is updated.
set "UPDATE_SUBMODULE_REMOTE_VERSION=1.0.0"
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "SUBMODULE_NAME=playable-shared-kit"
set "PROJECT_ROOT="

if exist "%SCRIPT_DIR%\playable-shared-kit\scripts\" (
  set "PROJECT_ROOT=%SCRIPT_DIR%"
) else (
  for %%I in ("%SCRIPT_DIR%\..\..") do set "PROJECT_ROOT=%%~fI"
)

if not exist "%PROJECT_ROOT%\playable-shared-kit\scripts\" (
  echo [update-submodule-remote] Unable to resolve the game project root from "%SCRIPT_DIR%"
  if /I not "%UPDATE_SUBMODULE_REMOTE_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo.
echo ================================================================================
echo ============== UPDATE SUBMODULE REMOTE TOOL v%UPDATE_SUBMODULE_REMOTE_VERSION% ==============
echo ================================================================================
echo [info] Project root: %PROJECT_ROOT%
echo [info] Target submodule: %SUBMODULE_NAME%
echo.

git -C "%PROJECT_ROOT%" rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [update-submodule-remote] Git repository not found for "%PROJECT_ROOT%"
  if /I not "%UPDATE_SUBMODULE_REMOTE_NO_PAUSE%"=="1" pause
  exit /b 1
)

git -C "%PROJECT_ROOT%" submodule status -- "%SUBMODULE_NAME%" >nul 2>&1
if errorlevel 1 (
  echo [update-submodule-remote] Submodule "%SUBMODULE_NAME%" is not registered in this project.
  if /I not "%UPDATE_SUBMODULE_REMOTE_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo [update-submodule-remote] Running git submodule update --init --remote --recursive -- %SUBMODULE_NAME%
git -C "%PROJECT_ROOT%" submodule update --init --remote --recursive -- "%SUBMODULE_NAME%"
if errorlevel 1 (
  echo [update-submodule-remote] Failed to update "%SUBMODULE_NAME%" from remote.
  if /I not "%UPDATE_SUBMODULE_REMOTE_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo.
echo [done] Current submodule status:
git -C "%PROJECT_ROOT%" submodule status -- "%SUBMODULE_NAME%"

if /I not "%UPDATE_SUBMODULE_REMOTE_NO_PAUSE%"=="1" pause
exit /b 0