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

call :syncRootScript "%SHARED_KIT%" "%ROOT%"
if !errorlevel! neq 0 exit /b !errorlevel!

call :applyTemplateConfig "%ROOT%" "%SHARED_KIT%\template-config" "%SHARED_KIT%"
if !errorlevel! neq 0 exit /b !errorlevel!

call :updatePackageMetadata "%ROOT%"
if !errorlevel! neq 0 exit /b !errorlevel!

call :ensureSharedKitDependencies "%ROOT%" "%SHARED_KIT%"
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

:syncRootScript
if /I "%~f0"=="%~2\0_setup-all.bat" exit /b 0
if not exist "%~1\scripts\0_setup-all.bat" exit /b 0
copy /Y "%~1\scripts\0_setup-all.bat" "%~2\0_setup-all.bat" >nul
if errorlevel 1 (
    echo [ERROR] Failed to sync root 0_setup-all.bat.
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b 1
)
echo [ok] root 0_setup-all.bat
exit /b 0

:applyTemplateConfig
if not exist "%~2\" (
    echo [skip] No template config folder found.
    exit /b 0
)
echo.
echo ==^> Applying shared template config
call :copyTree "%~2\profiles\v2\packages" "%~1\profiles\v2\packages" "profiles\v2\packages"
if !errorlevel! neq 0 exit /b !errorlevel!
call :copyTree "%~2\settings\v2\packages" "%~1\settings\v2\packages" "settings\v2\packages"
if !errorlevel! neq 0 exit /b !errorlevel!
call :copyTree "%~2\.vscode" "%~1\.vscode" ".vscode"
if !errorlevel! neq 0 exit /b !errorlevel!
call :copyFileIfExists "%~2\.gitignore" "%~1\.gitignore" ".gitignore"
if !errorlevel! neq 0 exit /b !errorlevel!
if exist "%~2\tsconfig_TEMPLATE.json" (
    call :copyFile "%~2\tsconfig_TEMPLATE.json" "%~1\tsconfig.json" "tsconfig.json"
) else (
    call :copyFileIfExists "%~2\tsconfig.json" "%~1\tsconfig.json" "tsconfig.json"
)
if !errorlevel! neq 0 exit /b !errorlevel!
if exist "%~2\playable-cli.config_TEMPLATE.cjs" (
    call :copyFile "%~2\playable-cli.config_TEMPLATE.cjs" "%~3\tools\playable-build\playable-cli.config.cjs" "playable-cli.config.cjs"
) else (
    call :copyFileIfExists "%~2\playable-cli.config.cjs" "%~3\tools\playable-build\playable-cli.config.cjs" "playable-cli.config.cjs"
)
if !errorlevel! neq 0 exit /b !errorlevel!
echo [ok] template config applied
exit /b 0

:copyTree
if not exist "%~1\" (
    echo [skip] Missing template folder: %~3
    exit /b 0
)
if not exist "%~2\" mkdir "%~2"
robocopy "%~1" "%~2" /E /NFL /NDL /NJH /NJS /NC /NS /NP >nul
set "COPY_EXIT=!errorlevel!"
if !COPY_EXIT! geq 8 (
    echo [ERROR] Failed to copy %~3.
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b !COPY_EXIT!
)
echo [ok] %~3
exit /b 0

:copyFileIfExists
if not exist "%~1" (
    echo [skip] Missing template file: %~3
    exit /b 0
)
call :copyFile "%~1" "%~2" "%~3"
exit /b !errorlevel!

:copyFile
if not exist "%~dp2" mkdir "%~dp2"
copy /Y "%~1" "%~2" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy %~3.
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b 1
)
echo [ok] %~3
exit /b 0

:updatePackageMetadata
if not exist "%~1\package.json" (
    echo [skip] No root package.json found.
    exit /b 0
)
echo.
echo ==^> Updating root package metadata
call node -e "const fs=require('fs'),path=require('path');const root=process.argv[1];const file=path.join(root,'package.json');const raw=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');const pkg=JSON.parse(raw);pkg.name=path.basename(root);pkg.description='Playable Ads';fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');" "%~1"
if errorlevel 1 (
    echo [ERROR] Failed to update root package metadata.
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b 1
)
echo [ok] root package metadata
exit /b 0

:ensureSharedKitDependencies
if not exist "%~1\package.json" (
    echo [skip] No root package.json found.
    exit /b 0
)
if not exist "%~2\packages\playable-sdk\package.json" (
    echo [skip] playable-sdk package source not found.
    exit /b 0
)
if not exist "%~2\packages\playable-core\package.json" (
    echo [skip] playable-core package source not found.
    exit /b 0
)
echo.
echo ==^> Ensuring root dependencies: playable-sdk, playable-core
call node -e "const fs=require('fs'),path=require('path');const file=path.join(process.argv[1],'package.json');const raw=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');const pkg=JSON.parse(raw);pkg.dependencies={...(pkg.dependencies||{}),'playable-sdk':'file:./playable-shared-kit/packages/playable-sdk','playable-core':'file:./playable-shared-kit/packages/playable-core'};fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');" "%~1"
if errorlevel 1 (
    echo [ERROR] Failed to update root package.json shared-kit dependencies.
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b 1
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
set "INSTALL_EXIT=!errorlevel!"
popd
if !INSTALL_EXIT! neq 0 (
    echo [ERROR] npm install failed in %~2
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b !INSTALL_EXIT!
)
echo [ok] %~2
exit /b 0
