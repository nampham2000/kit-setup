@echo off
setlocal EnableDelayedExpansion
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

call :ensureSharedKitDependencies "%ROOT%"
if !errorlevel! neq 0 exit /b !errorlevel!

call :install "%ROOT%" "root"

if exist "%ROOT%\extensions\" (
    for /d %%D in ("%ROOT%\extensions\*") do (
        call :install "%%D" "extensions\%%~nxD"
    )
)

echo.
echo All packages installed successfully.
if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
exit /b 0

:ensureSharedKitDependencies
if not exist "%~1\package.json" (
    echo [skip] No root package.json found.
    exit /b 0
)
if not exist "%~1\playable-shared-kit\packages\playable-sdk\package.json" (
    echo [skip] playable-sdk package source not found.
    exit /b 0
)
if not exist "%~1\playable-shared-kit\packages\playable-core\package.json" (
    echo [skip] playable-core package source not found.
    exit /b 0
)
echo.
echo ==^> Ensuring root dependencies: playable-sdk, playable-core
pushd "%~1"
call npm pkg set "dependencies.playable-sdk=file:./playable-shared-kit/packages/playable-sdk" "dependencies.playable-core=file:./playable-shared-kit/packages/playable-core"
set "SET_DEP_EXIT=!errorlevel!"
popd
if !SET_DEP_EXIT! neq 0 (
    echo [ERROR] Failed to update root package.json shared-kit dependencies.
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b !SET_DEP_EXIT!
)
echo [ok] root shared-kit dependencies
exit /b 0

:install
if not exist "%~1\package.json" (
    echo [skip] No package.json in %~2
    exit /b 0
)
echo.
echo ==^> Installing: %~2
pushd "%~1"
call npm install
popd
if !errorlevel! neq 0 (
    echo [ERROR] npm install failed in %~2
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b 1
)
echo [ok] %~2
exit /b 0
