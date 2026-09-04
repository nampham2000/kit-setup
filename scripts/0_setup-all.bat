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

call :ensureDependencies "%ROOT%" "%SHARED_KIT%"
if !errorlevel! neq 0 exit /b !errorlevel!

call :warnIfCocosRunning

call :applyTemplateConfig "%ROOT%" "%SHARED_KIT%\template-config" "%SHARED_KIT%"
if !errorlevel! neq 0 exit /b !errorlevel!

call :installVscodeMcpAutostart "%SHARED_KIT%"
if !errorlevel! neq 0 exit /b !errorlevel!

call :updatePackageMetadata "%ROOT%"
if !errorlevel! neq 0 exit /b !errorlevel!

call :ensureSharedKitDependencies "%ROOT%" "%SHARED_KIT%"
if !errorlevel! neq 0 exit /b !errorlevel!

call :syncExtensions "%ROOT%" "%SHARED_KIT%"
if !errorlevel! neq 0 exit /b !errorlevel!

call :install "%ROOT%" "root"
if exist "%SHARED_KIT%\packages\playable-sdk\node_modules\" (
    rmdir /s /q "%SHARED_KIT%\packages\playable-sdk\node_modules" >nul 2>&1
)
if exist "%SHARED_KIT%\packages\playable-core\node_modules\" (
    rmdir /s /q "%SHARED_KIT%\packages\playable-core\node_modules" >nul 2>&1
)

if exist "%ROOT%\extensions\" (
    for /d %%D in ("%ROOT%\extensions\*") do (
        call :install "%%D" "extensions\%%~nxD"
    )
)

call :initWorkMemory "%ROOT%" "%SHARED_KIT%"
call :deployAiKnowledge "%ROOT%" "%SHARED_KIT%"
call :syncMcpClients "%ROOT%" "%SHARED_KIT%"

echo.
echo All packages, AI skills, and MCP configurations installed successfully.
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
call :mergeConfigTree "%~2\profiles" "%~1\profiles" "profiles"
if !errorlevel! neq 0 exit /b !errorlevel!
call :mergeConfigTree "%~2\settings" "%~1\settings" "settings"
if !errorlevel! neq 0 exit /b !errorlevel!
call :copyTree "%~2\.vscode" "%~1\.vscode" ".vscode"
if !errorlevel! neq 0 exit /b !errorlevel!
call :applyGitIgnore "%~1\.gitignore" "%~2\.gitignore"
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
if exist "%~2\.npmrc" (
    call :copyFileIfExists "%~2\.npmrc" "%~1\.npmrc" ".npmrc"
)
if !errorlevel! neq 0 exit /b !errorlevel!
echo [ok] template config applied
exit /b 0

:warnIfCocosRunning
tasklist /FI "IMAGENAME eq CocosCreator.exe" 2>nul | find /I "CocosCreator.exe" >nul
if !errorlevel! equ 0 (
    echo.
    echo [WARN] Cocos Creator is currently running.
    echo        Modifying profiles and installing packages while the editor is open
    echo        can cause file lock errors ^(e.g. scene.json^) or script compilation issues.
    echo        For best results, close Cocos Creator before running setup.
    echo.
)
exit /b 0

:installVscodeMcpAutostart
set "VSCODE_MCP_SOURCE=%~1\tools\vscode-mcp-autostart"
set "VSCODE_EXT_ROOT=%USERPROFILE%\.vscode\extensions"
set "VSCODE_MCP_TARGET=%VSCODE_EXT_ROOT%\local.cocos-game-mcp-autostart-0.0.1"
if not exist "%VSCODE_MCP_SOURCE%\package.json" (
    echo [skip] VSCode MCP autostart helper source not found.
    exit /b 0
)
echo.
echo ==^> Refreshing VSCode MCP autostart helper
if not exist "%VSCODE_EXT_ROOT%\" mkdir "%VSCODE_EXT_ROOT%"
if not exist "%VSCODE_MCP_TARGET%\" mkdir "%VSCODE_MCP_TARGET%"
robocopy "%VSCODE_MCP_SOURCE%" "%VSCODE_MCP_TARGET%" /E /NFL /NDL /NJH /NJS /NC /NS /NP >nul
set "COPY_EXIT=!errorlevel!"
if !COPY_EXIT! geq 8 (
    echo [ERROR] Failed to refresh VSCode MCP autostart helper.
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b !COPY_EXIT!
)
echo [ok] VSCode MCP autostart helper
exit /b 0

:mergeConfigTree
if not exist "%~1\" (
    echo [skip] Missing template folder: %~3
    exit /b 0
)
if not exist "%~2\" mkdir "%~2"
call node -e "const fs=require('fs'),path=require('path');const source=process.argv[1],target=process.argv[2],label=process.argv[3];const isObj=v=>Boolean(v)&&typeof v==='object'&&Array.isArray(v)===false;const merge=(tmpl,proj)=>{if(isObj(tmpl)===false||isObj(proj)===false)return proj;const out={...tmpl};for(const [k,v] of Object.entries(proj))out[k]=Object.prototype.hasOwnProperty.call(tmpl,k)?merge(tmpl[k],v):v;return out};let copied=0,merged=0,skipped=0;function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const src=path.join(dir,ent.name);const rel=path.relative(source,src);const dst=path.join(target,rel);if(ent.isDirectory()){fs.mkdirSync(dst,{recursive:true});walk(src);continue}fs.mkdirSync(path.dirname(dst),{recursive:true});if(fs.existsSync(dst)===false){fs.copyFileSync(src,dst);copied++;continue}if(path.extname(ent.name).toLowerCase()==='.json'){try{const tmpl=JSON.parse(fs.readFileSync(src,'utf8').replace(/^\uFEFF/,''));const projRaw=fs.readFileSync(dst,'utf8').replace(/^\uFEFF/,'');const proj=JSON.parse(projRaw);const next=JSON.stringify(merge(tmpl,proj),null,2)+'\n';if(next.trim()===projRaw.trim()){skipped++;continue}fs.writeFileSync(dst,next);merged++;}catch(e){skipped++;}continue}skipped++}}walk(source);console.log('[ok] '+label+' merged project-wins (copied='+copied+' merged='+merged+' skipped='+skipped+')');" "%~1" "%~2" "%~3"
if errorlevel 1 (
    echo [ERROR] Failed to merge %~3.
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b 1
)
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

:applyGitIgnore
if not exist "%~2" (
    echo [skip] Template .gitignore not found.
    exit /b 0
)
call node -e "const fs=require('fs'),path=require('path');const targetPath=process.argv[1],tmplPath=process.argv[2];if(fs.existsSync(targetPath)===false){fs.copyFileSync(tmplPath,targetPath);console.log('[ok] .gitignore created from template');process.exit(0);}const parseLines=c=>c.split(/\r?\n/).map(l=>l.trim()).filter(l=>Boolean(l)&&l.startsWith('#')===false);const targetRaw=fs.readFileSync(targetPath,'utf8');const targetLines=new Set(parseLines(targetRaw));const tmplRaw=fs.readFileSync(tmplPath,'utf8');const missingRules=[];for(const line of tmplRaw.split(/\r?\n/)){const trimmed=line.trim();if(Boolean(trimmed)&&trimmed.startsWith('#')===false&&targetLines.has(trimmed)===false){missingRules.push(trimmed);}}if(missingRules.length>0){const sep=targetRaw.endsWith('\n')?'\n':'\n\n';fs.appendFileSync(targetPath,sep+'# Added by playable-shared-kit setup\n'+missingRules.join('\n')+'\n');console.log('[ok] .gitignore updated ('+missingRules.length+' missing rules added)');}else{console.log('[ok] .gitignore is up to date');}" "%~1" "%~2"
if errorlevel 1 (
    echo [ERROR] Failed to apply .gitignore.
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b 1
)
exit /b 0

:updatePackageMetadata
if not exist "%~1\package.json" (
    echo [skip] No root package.json found.
    exit /b 0
)
echo.
echo.
echo ==^> Updating root package metadata
call node -e "const fs=require('fs'),path=require('path');const root=process.argv[1];const file=path.join(root,'package.json');const raw=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');const pkg=JSON.parse(raw);const base=path.basename(root);const normalized=base.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'')||'playable-ads';pkg.name=normalized;pkg.description='Playable Ads';fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');" "%~1"
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
if exist "%~2\packages\playable-sdk\node_modules\" (
    rmdir /s /q "%~2\packages\playable-sdk\node_modules" >nul 2>&1
)
if exist "%~2\packages\playable-core\node_modules\" (
    rmdir /s /q "%~2\packages\playable-core\node_modules" >nul 2>&1
)
echo.
echo ==^> Ensuring root dependencies and scripts
call :detectLinkSupport "%~1"
if "!LINK_SUPPORTED!"=="0" (
    echo [warn] This project is on a filesystem without symlink/junction support ^(exFAT/FAT32/network share^).
    echo        npm cannot install folder-based file: dependencies there, so shared-kit
    echo        packages are packed into .local-tarballs and installed from tarballs instead.
    call :packSharedKitDependencies "%~1" "%~2"
    exit /b !errorlevel!
)
call node -e "const fs=require('fs'),path=require('path');const root=process.argv[1],shared=process.argv[2];const file=path.join(root,'package.json');const raw=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');const pkg=JSON.parse(raw);pkg.dependencies={...(pkg.dependencies||{}),'playable-sdk':'file:./playable-shared-kit/packages/playable-sdk','playable-core':'file:./playable-shared-kit/packages/playable-core','@modelcontextprotocol/sdk':pkg.dependencies?.['@modelcontextprotocol/sdk']||'^1.29.0'};const tmplFile=path.join(shared,'template-config','package.scripts_TEMPLATE.json');if(fs.existsSync(tmplFile)){const tmpl=JSON.parse(fs.readFileSync(tmplFile,'utf8').replace(/^\uFEFF/,''));if(tmpl.scripts)pkg.scripts={...(tmpl.scripts||{}),...(pkg.scripts||{})};if(tmpl.devDependencies)pkg.devDependencies={...(tmpl.devDependencies||{}),...(pkg.devDependencies||{})};}fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');" "%~1" "%~2"
if errorlevel 1 (
    echo [ERROR] Failed to update root package.json shared-kit dependencies and scripts.
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b 1
)
echo [ok] root shared-kit dependencies and scripts
exit /b 0

:detectLinkSupport
set "LINK_SUPPORTED=1"
call node -e "const fs=require('fs'),path=require('path');const dir=path.join(process.argv[1],'node_modules');const target=path.join(dir,'.link-probe-target');const link=path.join(dir,'.link-probe-link');const clean=()=>{try{fs.rmSync(link,{recursive:true,force:true})}catch(e){}try{fs.rmSync(target,{recursive:true,force:true})}catch(e){}};try{fs.mkdirSync(target,{recursive:true});fs.rmSync(link,{recursive:true,force:true});fs.symlinkSync(target,link,'junction')}catch(e){clean();process.exit(1)}clean();" "%~1"
if errorlevel 1 set "LINK_SUPPORTED=0"
exit /b 0

:packSharedKitDependencies
if not exist "%~2\scripts\pack-shared-kit-deps.js" (
    echo [ERROR] Missing helper: %~2\scripts\pack-shared-kit-deps.js
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b 1
)
call node "%~2\scripts\pack-shared-kit-deps.js" "%~1" "%~2"
if errorlevel 1 (
    echo [ERROR] Failed to pack shared-kit tarball dependencies.
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b 1
)
echo [ok] root shared-kit dependencies (tarball mode)
exit /b 0

:install
if not exist "%~1\package.json" (
    echo [skip] No package.json in %~2
    exit /b 0
)
echo.
echo ==^> Installing: %~2
pushd "%~1"
call npm install --no-audit --no-fund --prefer-offline
set "INSTALL_EXIT=!errorlevel!"
popd
if !INSTALL_EXIT! neq 0 (
    echo [ERROR] npm install failed in %~2
    if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
    exit /b !INSTALL_EXIT!
)
echo [ok] %~2
exit /b 0

:ensureDependencies
if not exist "%~2\tools\ensure-dependencies.cjs" (
    echo [skip] ensure-dependencies.cjs not found.
    exit /b 0
)
echo.
call node "%~2\tools\ensure-dependencies.cjs"
if errorlevel 1 (
    echo [warn] Dependency scanner completed with warnings.
) else (
    echo [ok] System runtimes and dependencies verified.
)
exit /b 0

:initWorkMemory
if not exist "%~2\tools\work-memory.cjs" (
    echo [skip] work-memory.cjs not found.
    exit /b 0
)
echo.
echo ==^> Synchronizing Work-Memory knowledge database from Git
call node "%~2\tools\work-memory.cjs" init --repo-root "%~1"
call node "%~2\tools\work-memory.cjs" import-sources --repo-root "%~1"
if errorlevel 1 (
    echo [warn] Work memory sync completed with warnings.
    exit /b 0
)
echo [ok] work-memory synchronized
exit /b 0

:deployAiKnowledge
if not exist "%~2\tools\ai-knowledge-sync.cjs" (
    echo [skip] ai-knowledge-sync.cjs not found.
    exit /b 0
)
echo.
call node "%~2\tools\ai-knowledge-sync.cjs"
if errorlevel 1 (
    echo [warn] AI knowledge deployment completed with warnings.
) else (
    echo [ok] AI knowledge and skills deployed.
)
exit /b 0

:syncMcpClients
if not exist "%~2\tools\mcp-clients-sync.ps1" (
    echo [skip] mcp-clients-sync.ps1 not found.
    exit /b 0
)
echo.
echo ==^> Syncing MCP servers to AI clients (Claude, Antigravity, Copilot, Codex)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~2\tools\mcp-clients-sync.ps1" -ProjectDir "%~1"
if errorlevel 1 (
    echo [warn] MCP sync completed with some warnings.
) else (
    echo [ok] MCP clients registered.
)
exit /b 0

:syncExtensions
if not exist "%~2\packages\extensions\" (
    echo [skip] No packages/extensions folder in shared-kit.
    exit /b 0
)
echo.
echo ==^> Syncing editor extensions from shared kit
if not exist "%~1\extensions\" mkdir "%~1\extensions"
for /d %%E in ("%~2\packages\extensions\*") do (
    set "EXT_NAME=%%~nxE"
    if not exist "%~1\extensions\!EXT_NAME!\" mkdir "%~1\extensions\!EXT_NAME!"
    robocopy "%%E" "%~1\extensions\!EXT_NAME!" /E /NFL /NDL /NJH /NJS /NC /NS /NP >nul
    set "ROBO_EXIT=!errorlevel!"
    if !ROBO_EXIT! geq 8 (
        echo [ERROR] Failed to sync extension !EXT_NAME!.
        if /I not "%SETUP_ALL_NO_PAUSE%"=="1" pause
        exit /b !ROBO_EXIT!
    )
    echo [ok] extension: !EXT_NAME!
)
exit /b 0

