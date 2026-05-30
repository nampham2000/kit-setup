@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem AI AGENT NOTE: bump CREATE_PLAYABLE_SHARED_KIT_PR_VERSION every time this file is updated.
set "CREATE_PLAYABLE_SHARED_KIT_PR_VERSION=2.1.0"
set "SUBMODULE_NAME=playable-shared-kit"
set "REPO_WEB_URL=https://github.com/minhdptpuzzle/playable-shared-kit"
set "REPO_API_SLUG=minhdptpuzzle/playable-shared-kit"
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT="
set "REPO_DIR="
set "PROJECT_NAME_RAW="
set "PROJECT_NAME_SLUG="
set "TIMESTAMP_UTC="
set "AUTO_BRANCH="
set "COMMIT_MESSAGE="
set "BASE_BRANCH=main"
set "CURRENT_BRANCH="
set "ORIGINAL_BRANCH="
set "NEEDS_AUTO_BRANCH="
set "AUTO_BRANCH_CREATED="
set "COMMITS_AHEAD=0"
set "COMPARE_URL="
set "DUPLICATE_REMOTE_BRANCH="
set "PR_TARGET_BRANCH="
set "OPEN_URL="
set "EXISTING_PR_URL="

if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

if exist "%SCRIPT_DIR%\playable-shared-kit\scripts\" (
    set "PROJECT_ROOT=%SCRIPT_DIR%"
    set "REPO_DIR=!PROJECT_ROOT!\%SUBMODULE_NAME%"
) else (
    for %%I in ("%SCRIPT_DIR%\..") do set "REPO_DIR=%%~fI"
    for %%I in ("!REPO_DIR!\..") do set "PROJECT_ROOT=%%~fI"
)

echo.
echo ================================================================================
echo =========== CREATE PLAYABLE SHARED KIT PR TOOL v%CREATE_PLAYABLE_SHARED_KIT_PR_VERSION% ===========
echo ================================================================================
echo [info] Project root: %PROJECT_ROOT%
echo [info] Repo dir: %REPO_DIR%
echo.

if not exist "%REPO_DIR%\.git" (
    echo [create-pr] Repo not found: "%REPO_DIR%"
    if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
    exit /b 1
)

git -C "%REPO_DIR%" rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [create-pr] Git repository is not valid: "%REPO_DIR%"
    if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
    exit /b 1
)

for /f "usebackq delims=" %%i in (`git -C "%REPO_DIR%" rev-parse --abbrev-ref HEAD 2^>nul`) do set "CURRENT_BRANCH=%%i"
if not defined CURRENT_BRANCH (
    echo [create-pr] Unable to determine the current branch.
    if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
    exit /b 1
)
set "ORIGINAL_BRANCH=%CURRENT_BRANCH%"

for %%I in ("%PROJECT_ROOT%") do set "PROJECT_NAME_RAW=%%~nxI"
for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$name = $env:PROJECT_NAME_RAW; $slug = [regex]::Replace($name.ToLowerInvariant(), '[^a-z0-9._-]+', '-').Trim('-'); if ([string]::IsNullOrWhiteSpace($slug)) { $slug = 'project' }; Write-Output $slug"`) do set "PROJECT_NAME_SLUG=%%i"
for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')"`) do set "TIMESTAMP_UTC=%%i"

if not defined PROJECT_NAME_SLUG set "PROJECT_NAME_SLUG=project"
if not defined TIMESTAMP_UTC (
    echo [create-pr] Failed to generate a UTC timestamp.
    if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
    exit /b 1
)

set "AUTO_BRANCH=auto-%PROJECT_NAME_SLUG%-%TIMESTAMP_UTC%"
set "COMMIT_MESSAGE=chore: sync %PROJECT_NAME_SLUG% %TIMESTAMP_UTC%"

git -C "%REPO_DIR%" fetch origin
if errorlevel 1 (
    echo [create-pr] Failed to fetch origin.
    if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
    exit /b 1
)

for /f "usebackq delims=" %%i in (`git -C "%REPO_DIR%" symbolic-ref refs/remotes/origin/HEAD 2^>nul`) do set "BASE_BRANCH=%%i"
if defined BASE_BRANCH set "BASE_BRANCH=!BASE_BRANCH:refs/remotes/origin/=!"
if not defined BASE_BRANCH set "BASE_BRANCH=main"

echo [info] Base branch: !BASE_BRANCH!
echo [info] Current branch: !CURRENT_BRANCH!
echo [info] Auto branch candidate: !AUTO_BRANCH!
echo [info] Auto commit message: !COMMIT_MESSAGE!

if /I "!CURRENT_BRANCH!"=="HEAD" (
    set "NEEDS_AUTO_BRANCH=1"
)

if /I "!CURRENT_BRANCH!"=="!BASE_BRANCH!" (
    set "NEEDS_AUTO_BRANCH=1"
)

if defined NEEDS_AUTO_BRANCH (
    git -C "%REPO_DIR%" rev-parse --verify --quiet "refs/heads/!AUTO_BRANCH!" >nul
    if not errorlevel 1 (
        echo [create-pr] Generated local branch already exists: !AUTO_BRANCH!
        if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
        exit /b 1
    )

    git -C "%REPO_DIR%" ls-remote --exit-code --heads origin "!AUTO_BRANCH!" >nul 2>&1
    if not errorlevel 1 (
        echo [create-pr] Generated remote branch already exists: !AUTO_BRANCH!
        if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
        exit /b 1
    )

    if /I "%CREATE_PR_DRY_RUN%"=="1" (
        echo [dry-run] Would create and checkout branch: !AUTO_BRANCH!
        set "CURRENT_BRANCH=!AUTO_BRANCH!"
        set "AUTO_BRANCH_CREATED=1"
    ) else (
        echo [create-pr] Creating branch !AUTO_BRANCH!...
        git -C "%REPO_DIR%" switch -c "!AUTO_BRANCH!"
        if errorlevel 1 (
            echo [create-pr] Failed to create branch !AUTO_BRANCH!.
            if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
            exit /b 1
        )
        set "CURRENT_BRANCH=!AUTO_BRANCH!"
        set "AUTO_BRANCH_CREATED=1"
    )
)

if /I "%CREATE_PR_DRY_RUN%"=="1" (
    echo [dry-run] Would stage changes with: git -C "%REPO_DIR%" add -A
    echo [dry-run] Would create a commit when changes exist with message: !COMMIT_MESSAGE!
) else (
    git -C "%REPO_DIR%" add -A
    if errorlevel 1 (
        echo [create-pr] Failed to stage changes.
        if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
        exit /b 1
    )
)

if /I not "%CREATE_PR_DRY_RUN%"=="1" (
    git -C "%REPO_DIR%" diff --cached --quiet --exit-code
    if errorlevel 1 (
        echo [create-pr] Creating commit...
        git -C "%REPO_DIR%" commit -m "!COMMIT_MESSAGE!"
        if errorlevel 1 (
            echo [create-pr] Failed to create commit.
            if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
            exit /b 1
        )
    ) else (
        echo [create-pr] No uncommitted local changes to commit.
    )
)

for /f "usebackq delims=" %%i in (`git -C "%REPO_DIR%" rev-list --count "origin/!BASE_BRANCH!..HEAD" 2^>nul`) do set "COMMITS_AHEAD=%%i"
if not defined COMMITS_AHEAD set "COMMITS_AHEAD=0"
echo [info] Commits ahead of origin/!BASE_BRANCH!: !COMMITS_AHEAD!

if "!COMMITS_AHEAD!"=="0" (
    echo [create-pr] No commits ahead of origin/!BASE_BRANCH! to publish as a PR.
    if defined AUTO_BRANCH_CREATED if /I not "%CREATE_PR_DRY_RUN%"=="1" (
        echo [create-pr] Cleaning up empty auto branch !CURRENT_BRANCH!...
        git -C "%REPO_DIR%" switch "!BASE_BRANCH!" >nul 2>&1
        git -C "%REPO_DIR%" branch -D "!CURRENT_BRANCH!" >nul 2>&1
    )
    if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
    exit /b 1
)

for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $repo = $env:REPO_DIR; $baseBranch = $env:BASE_BRANCH; $currentBranch = $env:CURRENT_BRANCH; function Get-Signature([string]$repoPath, [string]$spec) { $diff = (git -C $repoPath diff --no-ext-diff --no-color $spec | Out-String); if ([string]::IsNullOrWhiteSpace($diff)) { return $null }; $sha = [System.Security.Cryptography.SHA256]::Create(); return [System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($diff))).Replace('-', '').ToLowerInvariant() }; $baseSpec = 'origin/' + $baseBranch; $currentSignature = Get-Signature $repo ($baseSpec + '...' + $currentBranch); if ([string]::IsNullOrWhiteSpace($currentSignature)) { exit 0 }; $remoteRefs = @(git -C $repo for-each-ref --format='%(refname:short)' refs/remotes/origin/*); foreach ($ref in $remoteRefs) { if ($ref -eq 'origin' -or -not $ref.StartsWith('origin/')) { continue }; if ($ref -eq 'origin/HEAD' -or $ref -eq ('origin/' + $baseBranch) -or $ref -eq ('origin/' + $currentBranch)) { continue }; $branchName = $ref.Substring(7); if ([string]::IsNullOrWhiteSpace($branchName)) { continue }; $candidateSignature = Get-Signature $repo ($baseSpec + '...' + $branchName); if (-not [string]::IsNullOrWhiteSpace($candidateSignature) -and $candidateSignature -eq $currentSignature) { Write-Output $branchName; break } }"`) do set "DUPLICATE_REMOTE_BRANCH=%%i"

if defined DUPLICATE_REMOTE_BRANCH (
    echo [create-pr] Found existing remote branch with identical changes: !DUPLICATE_REMOTE_BRANCH!
    set "PR_TARGET_BRANCH=!DUPLICATE_REMOTE_BRANCH!"
    set "COMPARE_URL=%REPO_WEB_URL%/compare/!BASE_BRANCH!...!PR_TARGET_BRANCH!?expand=1"
    for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'SilentlyContinue'; $uri = 'https://api.github.com/repos/' + $env:REPO_API_SLUG + '/pulls?state=open&base=' + [Uri]::EscapeDataString($env:BASE_BRANCH) + '&head=' + [Uri]::EscapeDataString('minhdptpuzzle:' + $env:PR_TARGET_BRANCH); try { $response = Invoke-RestMethod -Headers @{ 'User-Agent' = 'playable-shared-kit-pr-tool' } -Uri $uri -Method Get; if ($response -and $response.Count -gt 0) { Write-Output $response[0].html_url } } catch { }"`) do set "EXISTING_PR_URL=%%i"
    if defined EXISTING_PR_URL (
        set "OPEN_URL=!EXISTING_PR_URL!"
    ) else (
        set "OPEN_URL=!COMPARE_URL!"
    )

    if /I "%CREATE_PR_DRY_RUN%"=="1" (
        echo [dry-run] Duplicate remote branch detected. Would open: !OPEN_URL!
        if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
        exit /b 0
    )

    echo [create-pr] Skipping new PR creation because the remote already has identical changes.
    echo [create-pr] Opening existing PR or compare target:
    echo !OPEN_URL!
    start "" "!OPEN_URL!"
    if errorlevel 1 (
        echo [create-pr] Failed to open the browser automatically.
        echo [create-pr] Open this URL manually:
        echo !OPEN_URL!
        if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
        exit /b 1
    )

    echo [done] Existing matching branch handled without creating a duplicate PR.
    if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
    exit /b 0
)

set "PR_TARGET_BRANCH=!CURRENT_BRANCH!"
set "COMPARE_URL=%REPO_WEB_URL%/compare/!BASE_BRANCH!...!PR_TARGET_BRANCH!?expand=1"
for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'SilentlyContinue'; $uri = 'https://api.github.com/repos/' + $env:REPO_API_SLUG + '/pulls?state=open&base=' + [Uri]::EscapeDataString($env:BASE_BRANCH) + '&head=' + [Uri]::EscapeDataString('minhdptpuzzle:' + $env:PR_TARGET_BRANCH); try { $response = Invoke-RestMethod -Headers @{ 'User-Agent' = 'playable-shared-kit-pr-tool' } -Uri $uri -Method Get; if ($response -and $response.Count -gt 0) { Write-Output $response[0].html_url } } catch { }"`) do set "EXISTING_PR_URL=%%i"
if defined EXISTING_PR_URL (
    set "OPEN_URL=!EXISTING_PR_URL!"
) else (
    set "OPEN_URL=!COMPARE_URL!"
)

if /I "%CREATE_PR_DRY_RUN%"=="1" (
    echo [dry-run] Would push with: git -C "%REPO_DIR%" push -u origin !CURRENT_BRANCH!
    echo [dry-run] Would open browser target: !OPEN_URL!
    if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
    exit /b 0
)

echo [create-pr] Pushing branch !CURRENT_BRANCH! to origin...
git -C "%REPO_DIR%" push -u origin "!CURRENT_BRANCH!"
if errorlevel 1 (
    echo [create-pr] Failed to push branch !CURRENT_BRANCH! to origin.
    if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
    exit /b 1
)

echo.
echo [create-pr] Opening the browser target:
echo !OPEN_URL!
start "" "!OPEN_URL!"
if errorlevel 1 (
    echo [create-pr] Failed to open the browser automatically.
    echo [create-pr] Open this URL manually:
    echo !OPEN_URL!
    if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
    exit /b 1
)

echo [done] Branch !CURRENT_BRANCH! is pushed and the PR page is open.
if /I not "%CREATE_PR_NO_PAUSE%"=="1" pause
exit /b 0