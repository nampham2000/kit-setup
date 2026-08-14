@powershell -NoProfile -ExecutionPolicy Bypass -Command "$ScriptDirFromBat='%~dp0'.TrimEnd('\');$f='%~f0';((Get-Content -LiteralPath $f -Raw)-split '#---PS---\r?\n',2)[1]|Invoke-Expression" & exit
#---PS---
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = $ScriptDirFromBat
$ProjectDir = $ScriptDir
$SharedKitDir = Join-Path $ProjectDir 'playable-shared-kit'
if (-not (Test-Path (Join-Path $SharedKitDir 'scripts\1_open-project.bat'))) {
    $MaybeSharedKitDir = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir '..'))
    if (Test-Path (Join-Path $MaybeSharedKitDir 'scripts\1_open-project.bat')) {
        $SharedKitDir = $MaybeSharedKitDir
        $ProjectDir = [System.IO.Path]::GetFullPath((Join-Path $SharedKitDir '..'))
    }
}
$ProjectDir = [System.IO.Path]::GetFullPath($ProjectDir).TrimEnd('\')
$SharedKitDir = [System.IO.Path]::GetFullPath($SharedKitDir).TrimEnd('\')

if (-not (Test-Path (Join-Path $ProjectDir 'package.json'))) {
    Write-Host "[ERROR] Could not locate game project root from: $ScriptDir" -ForegroundColor Red
    exit 1
}

$CocosMcpPort = 3000
$CocosMcpExtensionName = 'cocos-mcp'
$CocosMcpUrl = "http://127.0.0.1:$CocosMcpPort/mcp"

# blender-mcp and gimp-mcp are stdio bridges: each AI client spawns its own copy on
# demand, so there is no server of ours to start. What has to be running is the app
# behind them, which listens on these ports.
$BlenderMcpPort = 9876
$GimpMcpPort = 9877

function Set-JsonProperty($Object, $Name, $Value) {
    if ($Object.PSObject.Properties[$Name]) {
        $Object.$Name = $Value
    } else {
        Add-Member -InputObject $Object -MemberType NoteProperty -Name $Name -Value $Value
    }
}

function Read-JsonObject($Path) {
    if (-not (Test-Path $Path)) { return [pscustomobject]@{} }
    try {
        $Parsed = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        if ($null -eq $Parsed -or $Parsed -is [array]) { return [pscustomobject]@{} }
        return $Parsed
    } catch {
        Write-Host "  [warn] Invalid JSON, recreating: $Path" -ForegroundColor Yellow
        return [pscustomobject]@{}
    }
}

function Write-JsonObject($Path, $Object) {
    $Dir = Split-Path $Path -Parent
    if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
    $Json = ($Object | ConvertTo-Json -Depth 20) + [Environment]::NewLine
    [System.IO.File]::WriteAllText($Path, $Json, (New-Object System.Text.UTF8Encoding($false)))
}

function Ensure-VSCodeMcpConfig {
    $ConfigPath = Join-Path $ProjectDir '.vscode\mcp.json'
    $Config = Read-JsonObject $ConfigPath
    if (-not $Config.PSObject.Properties['servers'] -or $null -eq $Config.servers -or $Config.servers -is [array]) {
        Set-JsonProperty $Config 'servers' ([pscustomobject]@{})
    }

    $Server = [ordered]@{
        type = 'http'
        url = $CocosMcpUrl
    }
    Set-JsonProperty $Config.servers $CocosMcpExtensionName $Server
    Write-JsonObject $ConfigPath $Config
    Write-Host "  [mcp] VSCode server ready: $CocosMcpExtensionName -> $CocosMcpUrl" -ForegroundColor DarkGray
}

function Ensure-CocosMcpSettings {
    $SettingsPath = Join-Path $ProjectDir 'settings\mcp-server.json'
    $Settings = Read-JsonObject $SettingsPath
    Set-JsonProperty $Settings 'port' $CocosMcpPort
    Set-JsonProperty $Settings 'autoStart' $true
    if (-not $Settings.PSObject.Properties['enableDebugLog']) { Set-JsonProperty $Settings 'enableDebugLog' $false }
    if (-not $Settings.PSObject.Properties['allowedOrigins']) { Set-JsonProperty $Settings 'allowedOrigins' @('*') }
    if (-not $Settings.PSObject.Properties['maxConnections']) { Set-JsonProperty $Settings 'maxConnections' 10 }
    Write-JsonObject $SettingsPath $Settings
    Write-Host "  [mcp] Cocos editor autoStart enabled on port $CocosMcpPort" -ForegroundColor DarkGray
}

function Sync-CocosMcpExtension {
    $Source = Join-Path $SharedKitDir 'packages\extensions\cocos-mcp'
    $Destination = Join-Path $ProjectDir "extensions\$CocosMcpExtensionName"
    if (-not (Test-Path (Join-Path $Source 'package.json'))) {
        Write-Host "  [warn] Cocos MCP extension source not found: $Source" -ForegroundColor Yellow
        return
    }

    $ExtensionsDir = Split-Path $Destination -Parent
    if (-not (Test-Path $ExtensionsDir)) { New-Item -ItemType Directory -Path $ExtensionsDir -Force | Out-Null }

    Write-Host "  [mcp] Syncing Cocos MCP extension..." -ForegroundColor DarkGray
    robocopy $Source $Destination /E /XD node_modules .git /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    $CopyExit = $LASTEXITCODE
    if ($CopyExit -ge 8) { throw "Failed to sync Cocos MCP extension (robocopy exit $CopyExit)." }

    $RuntimeDeps = @('fs-extra', 'uuid', 'vue')
    $MissingDeps = @($RuntimeDeps | Where-Object { -not (Test-Path (Join-Path $Destination "node_modules\$_")) })
    if ($MissingDeps.Count -gt 0) {
        $NpmCmd = Get-Command npm -ErrorAction SilentlyContinue
        if (-not $NpmCmd) { throw "npm is required to install Cocos MCP runtime dependencies: $($MissingDeps -join ', ')." }
        Write-Host "  [mcp] Installing Cocos MCP runtime deps..." -ForegroundColor DarkGray
        Push-Location $Destination
        try {
            cmd /c "npm install --omit=dev"
            if ($LASTEXITCODE -ne 0) { throw "npm install failed in $Destination." }
        } finally {
            Pop-Location
        }
    }
}

function Sync-McpClients {
    $SyncScript = Join-Path $SharedKitDir 'tools\mcp-clients-sync.ps1'
    if (-not (Test-Path $SyncScript)) {
        Write-Host "  [warn] MCP client sync script not found: $SyncScript" -ForegroundColor Yellow
        Ensure-VSCodeMcpConfig
        return
    }

    try {
        & $SyncScript -ProjectDir $ProjectDir -CocosMcpPort $CocosMcpPort
    } catch {
        Write-Host "  [warn] MCP client sync failed: $($_.Exception.Message)" -ForegroundColor Yellow
        Ensure-VSCodeMcpConfig
    }
}

function Sync-VSCodeMcpAutostart {
    $Source = Join-Path $SharedKitDir 'tools\vscode-mcp-autostart'
    if (-not (Test-Path (Join-Path $Source 'package.json'))) {
        Write-Host "  [warn] VSCode MCP autostart helper source not found: $Source" -ForegroundColor Yellow
        return
    }

    $Target = Join-Path $env:USERPROFILE '.vscode\extensions\local.cocos-game-mcp-autostart-0.0.1'
    $TargetParent = Split-Path $Target -Parent
    if (-not (Test-Path $TargetParent)) { New-Item -ItemType Directory -Path $TargetParent -Force | Out-Null }
    if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Path $Target -Force | Out-Null }

    Write-Host "  [mcp] Refreshing VSCode MCP autostart helper..." -ForegroundColor DarkGray
    robocopy $Source $Target /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    $CopyExit = $LASTEXITCODE
    if ($CopyExit -ge 8) { throw "Failed to refresh VSCode MCP autostart helper (robocopy exit $CopyExit)." }
}

function Test-Port($HostName, $Port) {
    $Client = New-Object System.Net.Sockets.TcpClient
    try {
        $Async = $Client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $Async.AsyncWaitHandle.WaitOne(500, $false)) { return $false }
        $Client.EndConnect($Async)
        return $true
    } catch {
        return $false
    } finally {
        $Client.Close()
    }
}

function Wait-Port($HostName, $Port, $TimeoutSeconds) {
    $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $Deadline) {
        if (Test-Port $HostName $Port) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Find-NewestExe($Patterns) {
    $Found = @()
    foreach ($Pattern in $Patterns) {
        try { $Found += @(Get-ChildItem -Path $Pattern -File -ErrorAction SilentlyContinue) } catch { }
    }
    if ($Found.Count -eq 0) { return $null }
    return ($Found | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}

function Start-BlenderMcpBackend {
    if (Test-Port '127.0.0.1' $BlenderMcpPort) {
        Write-Host "  [mcp] blender-mcp backend already up on $BlenderMcpPort" -ForegroundColor DarkGray
        return $false
    }

    $BlenderExe = Find-NewestExe @(
        'C:\Program Files\Blender Foundation\Blender*\blender.exe',
        (Join-Path $env:LOCALAPPDATA 'Programs\Blender Foundation\Blender*\blender.exe'),
        'D:\Tools\Blender*\blender.exe'
    )
    if (-not $BlenderExe) {
        Write-Host "  [warn] Blender not found - blender-mcp will have no backend." -ForegroundColor Yellow
        return $false
    }

    # The MCP addon binds the port itself a second after Blender registers it.
    Write-Host "  [mcp] Launching Blender for blender-mcp..." -ForegroundColor DarkGray
    Start-Detached $BlenderExe ''
    return $true
}

function Start-GimpMcpBackend {
    if (Test-Port '127.0.0.1' $GimpMcpPort) {
        Write-Host "  [mcp] gimp-mcp backend already up on $GimpMcpPort" -ForegroundColor DarkGray
        return $false
    }

    $GimpExe = Find-NewestExe @(
        'C:\Program Files\GIMP 3\bin\gimp-3*.exe',
        'C:\Program Files\GIMP 2\bin\gimp-2*.exe'
    )
    if (-not $GimpExe) {
        Write-Host "  [warn] GIMP not found - gimp-mcp will have no backend." -ForegroundColor Yellow
        return $false
    }

    # The plug-in only binds its socket while the procedure runs, so ask for it up front
    # instead of leaving the user to click Tools > MCP > Start MCP Server.
    Write-Host "  [mcp] Launching GIMP for gimp-mcp..." -ForegroundColor DarkGray
    Start-Detached $GimpExe '--batch-interpreter=plug-in-script-fu-eval -b "(plug-in-mcp-server RUN-NONINTERACTIVE)"'
    return $true
}

function Wait-McpBackend($Name, $Port, $TimeoutSeconds, $Hint) {
    if (Wait-Port '127.0.0.1' $Port $TimeoutSeconds) {
        Write-Host "  [mcp] $Name backend ready on port $Port" -ForegroundColor DarkGray
        return $true
    }
    Write-Host "  [warn] $Name backend did not come up on port $Port. $Hint" -ForegroundColor Yellow
    return $false
}

function Test-McpServers {
    $SyncScript = Join-Path $SharedKitDir 'tools\mcp-clients-sync.ps1'
    if (-not (Test-Path $SyncScript)) { return }
    try {
        & $SyncScript -ProjectDir $ProjectDir -CocosMcpPort $CocosMcpPort -VerifyOnly
    } catch {
        Write-Host "  [warn] MCP verification failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Get-CocosProcessProject($CommandLine) {
    if (-not $CommandLine) { return '' }
    $Match = [regex]::Match($CommandLine, '(?i)--project(?:\s+|=)"([^"]+)"|--project(?:\s+|=)(\S+)')
    if (-not $Match.Success) { return '' }
    $OpenedProject = if ($Match.Groups[1].Success) { $Match.Groups[1].Value } else { $Match.Groups[2].Value }
    try { return [System.IO.Path]::GetFullPath($OpenedProject).TrimEnd('\') } catch { return '' }
}

function Get-CocosMcpPortOwnerProcesses {
    try {
        $Connections = @(Get-NetTCPConnection -LocalPort $CocosMcpPort -State Listen -ErrorAction SilentlyContinue)
        $ProcessIds = @($Connections | Select-Object -ExpandProperty OwningProcess -Unique)
        return @($ProcessIds | ForEach-Object {
            Get-CimInstance Win32_Process -Filter "ProcessId = $_" -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -ieq 'CocosCreator.exe' }
        })
    } catch {
        return @()
    }
}

function Stop-CocosProcesses($Processes) {
    $UniqueProcesses = @($Processes | Where-Object { $_ } | Sort-Object ProcessId -Unique)
    if ($UniqueProcesses.Count -eq 0) { return }

    Write-Host "==> Restarting Cocos Creator..." -ForegroundColor Cyan
    foreach ($CimProcess in $UniqueProcesses) {
        try {
            $Process = [System.Diagnostics.Process]::GetProcessById([int]$CimProcess.ProcessId)
            if ($Process.MainWindowHandle -ne [IntPtr]::Zero) {
                $Process.CloseMainWindow() | Out-Null
            }
        } catch {}
    }

    $Deadline = (Get-Date).AddSeconds(15)
    do {
        $StillRunning = @($UniqueProcesses | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
        if ($StillRunning.Count -eq 0) { return }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $Deadline)

    foreach ($CimProcess in $StillRunning) {
        Stop-Process -Id $CimProcess.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Start-Detached($FilePath, $Arguments) {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c set ELECTRON_RUN_AS_NODE=& set ELECTRON_NO_ATTACH_CONSOLE=& start `"`" `"$FilePath`" $Arguments" -WindowStyle Hidden
}

# --- Cocos Creator 3.8.8 path ---
# Adjust this path if your installation is elsewhere.
$CocosCreatorExe = "C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe"

if (-not (Test-Path $CocosCreatorExe)) {
    $Candidates = @(
        "D:\Tools\CC\3.8.8\CocosCreator.exe",
        "C:\Program Files\Cocos\Creator\3.8.8\CocosCreator.exe",
        "D:\CocosCreator\3.8.8\CocosCreator.exe"
    )
    foreach ($c in $Candidates) {
        if (Test-Path $c) { $CocosCreatorExe = $c; break }
    }
}

# --- Restore Cocos login token (bypass repeated login prompt) ---
$CocosProfileDir = Join-Path $env:USERPROFILE ".CocosCreator"
$TokenBackup = Join-Path $CocosProfileDir ".token-backup.json"
$TokenFiles = @(
    (Join-Path $CocosProfileDir "user_token.json"),
    (Join-Path $CocosProfileDir "profiles\user_token.json"),
    (Join-Path $CocosProfileDir "profiles\v2\editor\user.json")
)

if (-not (Test-Path $TokenBackup)) {
    foreach ($tf in $TokenFiles) {
        if ((Test-Path $tf) -and ((Get-Item $tf).Length -gt 10)) {
            Copy-Item $tf $TokenBackup
            Write-Host "  [token] Backup saved from $tf" -ForegroundColor DarkGray
            break
        }
    }
}

if (Test-Path $TokenBackup) {
    foreach ($tf in $TokenFiles) {
        $needRestore = (-not (Test-Path $tf)) -or ((Get-Item $tf).Length -le 10)
        if ($needRestore) {
            $dir = Split-Path $tf -Parent
            if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            Copy-Item $TokenBackup $tf
            Write-Host "  [token] Restored: $tf" -ForegroundColor DarkGray
        }
    }
    Write-Host "  [token] Login token OK." -ForegroundColor DarkGray
} else {
    Write-Host "  [token] No backup found - login once to create it." -ForegroundColor Yellow
}

if (Test-Path $CocosCreatorExe) {
    Write-Host "==> Preparing MCP..." -ForegroundColor Cyan
    Sync-VSCodeMcpAutostart
    Sync-CocosMcpExtension
    Ensure-CocosMcpSettings
    Sync-McpClients

    $ResolvedProjectDir = [System.IO.Path]::GetFullPath($ProjectDir).TrimEnd('\')
    $AllCocosProcesses = @(Get-CimInstance Win32_Process -Filter "name = 'CocosCreator.exe'" -ErrorAction SilentlyContinue)
    $ProjectCocosProcesses = @($AllCocosProcesses | Where-Object {
        (Get-CocosProcessProject $_.CommandLine) -ieq $ResolvedProjectDir
    })
    $PortOwnerProcesses = @(Get-CocosMcpPortOwnerProcesses)
    $ProcessesToRestart = @($ProjectCocosProcesses + $PortOwnerProcesses | Sort-Object ProcessId -Unique)
    if ($ProcessesToRestart.Count -eq 0 -and $AllCocosProcesses.Count -eq 1) {
        $ProcessesToRestart = $AllCocosProcesses
    }
    Stop-CocosProcesses $ProcessesToRestart

    Write-Host "==> Launching Cocos Creator 3.8.8..." -ForegroundColor Cyan
    Start-Detached $CocosCreatorExe "--project `"$ProjectDir`""

    # Kick the other two backends off now so they boot while Cocos is still starting.
    $StartedBlender = $false
    $StartedGimp = $false
    if ($env:PLAYABLE_SKIP_MCP_BACKENDS -eq '1') {
        Write-Host "==> Skipping Blender/GIMP backends (PLAYABLE_SKIP_MCP_BACKENDS=1)." -ForegroundColor DarkGray
    } else {
        Write-Host "==> Starting MCP backends..." -ForegroundColor Cyan
        $StartedBlender = Start-BlenderMcpBackend
        $StartedGimp = Start-GimpMcpBackend
    }

    Write-Host "==> Waiting for Cocos MCP server..." -ForegroundColor Cyan
    if (Wait-Port '127.0.0.1' $CocosMcpPort 90) {
        Write-Host "  [mcp] Cocos MCP server ready: $CocosMcpUrl" -ForegroundColor DarkGray
    } else {
        Write-Host "  [warn] Cocos launched but MCP port $CocosMcpPort is not ready yet." -ForegroundColor Yellow
    }

    if ($StartedBlender) {
        Wait-McpBackend 'blender-mcp' $BlenderMcpPort 90 'Open Blender > Edit > Preferences > Add-ons > MCP and start it.' | Out-Null
    }
    if ($StartedGimp) {
        Wait-McpBackend 'gimp-mcp' $GimpMcpPort 120 'Open GIMP > Tools > MCP > Start MCP Server.' | Out-Null
    }

    Write-Host "==> Opening VSCode..." -ForegroundColor Cyan
    $CodeCmd = Get-Command code -ErrorAction SilentlyContinue
    if ($CodeCmd) {
        $CodeExe = Join-Path (Split-Path (Split-Path $CodeCmd.Source -Parent) -Parent) "Code.exe"
        if (Test-Path $CodeExe) {
            Start-Detached $CodeExe "`"$ProjectDir`""
        } else {
            Start-Detached $CodeCmd.Source "`"$ProjectDir`""
        }
    } else {
        Write-Host "  [warn] VSCode command 'code' not found." -ForegroundColor Yellow
    }

    # Last, so the editors are already coming up while the handshakes run.
    if ($env:PLAYABLE_SKIP_MCP_VERIFY -eq '1') {
        Write-Host "==> Skipping MCP verification (PLAYABLE_SKIP_MCP_VERIFY=1)." -ForegroundColor DarkGray
    } else {
        Test-McpServers
    }

    if (-not ([System.Management.Automation.PSTypeName]'Win32Console').Type) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32Console {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("kernel32.dll")] public static extern bool FreeConsole();
    [DllImport("user32.dll")]   public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    public const uint WM_CLOSE = 0x0010;
}
"@
    }

    $consoleHwnd = [Win32Console]::GetConsoleWindow()

    Write-Host ""
    Write-Host "Done. Closing in 5 seconds..." -ForegroundColor DarkGray
    Start-Sleep -Seconds 5

    [Win32Console]::FreeConsole() | Out-Null
    if ($consoleHwnd -ne [IntPtr]::Zero) {
        [Win32Console]::PostMessage($consoleHwnd, [Win32Console]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    }
    Stop-Process -Id $PID -Force
    [Environment]::Exit(0)
} else {
    Write-Host ""
    Write-Host "[ERROR] CocosCreator.exe not found at: $CocosCreatorExe" -ForegroundColor Red
    Write-Host "        Please update the CocosCreatorExe path in this script." -ForegroundColor Yellow
    exit 1
}
