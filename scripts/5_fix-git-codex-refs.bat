@echo off
setlocal EnableExtensions

rem AI AGENT NOTE: bump FIX_GIT_CODEX_REFS_VERSION every time this file is updated.
set "FIX_GIT_CODEX_REFS_VERSION=1.0.0"
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "PROJECT_ROOT="

if exist "%SCRIPT_DIR%\playable-shared-kit\scripts\" (
  set "PROJECT_ROOT=%SCRIPT_DIR%"
) else (
  for %%I in ("%SCRIPT_DIR%\..\..") do set "PROJECT_ROOT=%%~fI"
)

echo.
echo ================================================================================
echo ================= FIX GIT CODEX REFS v%FIX_GIT_CODEX_REFS_VERSION% =================
echo ================================================================================
echo [info] Repository: %PROJECT_ROOT%
echo [info] Scope: refs/codex/turn-diffs/*
echo.

git -C "%PROJECT_ROOT%" rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [fix-git-codex-refs] Git repository not found for "%PROJECT_ROOT%".
  if /I not "%FIX_GIT_CODEX_REFS_NO_PAUSE%"=="1" pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$repo = $env:PROJECT_ROOT;" ^
  "$prefix = 'refs/codex/turn-diffs/';" ^
  "$refs = @(git -C $repo for-each-ref --format='%%(refname)' $prefix 2>&1);" ^
  "if ($LASTEXITCODE -ne 0) { throw ($refs -join [Environment]::NewLine) }" ^
  "$refs = @($refs | Where-Object { $_ -like ($prefix + '*') });" ^
  "if ($refs.Count -eq 0) { Write-Host '[fix-git-codex-refs] No stale Codex refs found.'; exit 0 }" ^
  "Write-Host ('[fix-git-codex-refs] Removing ' + $refs.Count + ' local ref(s)...');" ^
  "foreach ($ref in $refs) {" ^
  "  $result = @(git -C $repo update-ref -d $ref 2>&1);" ^
  "  if ($LASTEXITCODE -ne 0) { throw ($result -join [Environment]::NewLine) }" ^
  "}" ^
  "$remaining = @(git -C $repo for-each-ref --format='%%(refname)' $prefix 2>&1);" ^
  "if ($LASTEXITCODE -ne 0) { throw ($remaining -join [Environment]::NewLine) }" ^
  "if (@($remaining | Where-Object { $_ -like ($prefix + '*') }).Count -ne 0) { throw 'Some Codex refs remain after cleanup.' }" ^
  "Write-Host '[fix-git-codex-refs] Local Codex refs removed successfully.'"
if errorlevel 1 (
  echo [fix-git-codex-refs] Cleanup failed.
  if /I not "%FIX_GIT_CODEX_REFS_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo [fix-git-codex-refs] Verifying with git fetch origin --prune...
git -C "%PROJECT_ROOT%" fetch origin --prune
if errorlevel 1 (
  echo [fix-git-codex-refs] Refs were removed, but fetch still failed. Check network or authentication.
  if /I not "%FIX_GIT_CODEX_REFS_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo.
echo [done] Git fetch completed successfully.
if /I not "%FIX_GIT_CODEX_REFS_NO_PAUSE%"=="1" pause
exit /b 0
