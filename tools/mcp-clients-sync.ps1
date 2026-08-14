#Requires -Version 5.1
<#
.SYNOPSIS
    Registers the project's MCP servers with every AI client installed on this machine.

.DESCRIPTION
    One catalog, many client config formats. The catalog is resolved from what is
    actually installed (binaries are probed, never assumed), then written into each
    client's own config file:

      cocos-mcp    Streamable HTTP served by the Cocos Creator editor extension.
      blender-mcp  stdio bridge to the Blender MCP addon (TCP 9876).
      gimp-mcp     stdio bridge to the GIMP MCP plug-in (TCP 9877).
      node_repl    stdio JS sandbox shipped with the Codex runtime.

    Only stdio servers are spawned by the clients themselves - a stdio server is not
    a daemon, so there is nothing to "start" for those beyond making sure the app they
    talk to (Blender / GIMP) is running. 1_open-project.bat handles that part.

    Scope rule: a server name is written to exactly one scope per client, so no client
    ever sees the same server twice. cocos-mcp stays in the workspace file for VSCode
    (it is a per-project editor endpoint); everything else lands in the user config.

.PARAMETER ProjectDir
    Cocos project root. Defaults to the current directory.

.PARAMETER CocosMcpPort
    Port the Cocos Creator MCP extension listens on. Defaults to 3000.

.PARAMETER ClaudeUserScope
    Also register all servers in Claude Code's user scope (~/.claude.json) through the
    bundled claude CLI. Off by default: the desktop app already reads
    claude_desktop_config.json, and registering both would double every tool.
    Turn this on if you drive Claude Code from a terminal.

.PARAMETER Verify
    After writing, do a real MCP `initialize` handshake against every stdio server and
    an HTTP health probe against cocos-mcp. Adds ~10s.

.PARAMETER VerifyOnly
    Run the handshake without touching any config file.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File mcp-clients-sync.ps1 -ProjectDir D:\game -Verify
#>
[CmdletBinding()]
param(
    [string] $ProjectDir = (Get-Location).Path,
    [int]    $CocosMcpPort = 3000,
    [switch] $ClaudeUserScope,
    [switch] $Verify,
    [switch] $VerifyOnly,
    [switch] $Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectDir = [System.IO.Path]::GetFullPath($ProjectDir).TrimEnd('\')
$CocosMcpUrl = "http://127.0.0.1:$CocosMcpPort/mcp"

function Write-Step($Message, $Color = 'Cyan') {
    if (-not $Quiet) { Write-Host $Message -ForegroundColor $Color }
}

function Write-Detail($Message, $Color = 'DarkGray') {
    if (-not $Quiet) { Write-Host "  $Message" -ForegroundColor $Color }
}

# ---------------------------------------------------------------- JSON helpers

function Set-JsonProperty($Object, $Name, $Value) {
    if ($Object.PSObject.Properties[$Name]) {
        $Object.$Name = $Value
    } else {
        Add-Member -InputObject $Object -MemberType NoteProperty -Name $Name -Value $Value
    }
}

function Read-JsonObject($Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return [pscustomobject]@{} }
    try {
        $Raw = Get-Content -LiteralPath $Path -Raw
        if ([string]::IsNullOrWhiteSpace($Raw)) { return [pscustomobject]@{} }
        # Some clients ship their config with // comments; ConvertFrom-Json rejects those.
        $Raw = [regex]::Replace($Raw, '(?m)^\s*//.*$', '')
        $Parsed = $Raw | ConvertFrom-Json
        if ($null -eq $Parsed -or $Parsed -is [array]) { return [pscustomobject]@{} }
        return $Parsed
    } catch {
        Write-Detail "[warn] Unreadable JSON, rewriting from scratch: $Path" 'Yellow'
        return [pscustomobject]@{}
    }
}

function Write-JsonObject($Path, $Object) {
    $Dir = Split-Path $Path -Parent
    if (-not (Test-Path -LiteralPath $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
    $Json = ($Object | ConvertTo-Json -Depth 30) + [Environment]::NewLine
    [System.IO.File]::WriteAllText($Path, $Json, (New-Object System.Text.UTF8Encoding($false)))
}

function Backup-Once($Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $Backup = "$Path.mcp-sync-backup"
    if (Test-Path -LiteralPath $Backup) { return }
    Copy-Item -LiteralPath $Path -Destination $Backup -Force
    Write-Detail "backup -> $(Split-Path $Backup -Leaf)"
}

# ------------------------------------------------------------------ discovery

function Get-NewestFile($Patterns) {
    $Found = @()
    foreach ($Pattern in $Patterns) {
        try {
            $Found += @(Get-ChildItem -Path $Pattern -File -ErrorAction SilentlyContinue)
        } catch { }
    }
    if ($Found.Count -eq 0) { return $null }
    return ($Found | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}

function Resolve-UvExe {
    $Candidates = @(
        (Join-Path $env:APPDATA 'Python\Python*\Scripts\uv.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python*\Scripts\uv.exe'),
        (Join-Path $env:USERPROFILE '.local\bin\uv.exe')
    )
    $Uv = Get-NewestFile $Candidates
    if ($Uv) { return $Uv }
    $OnPath = Get-Command uv -ErrorAction SilentlyContinue
    if ($OnPath) { return $OnPath.Source }
    return $null
}

function Resolve-NodeReplBin {
    # The runtime directory is content-hashed, so it changes whenever Codex updates.
    $Pattern = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\runtimes\cua_node\*\bin\node_repl.exe'
    return Get-NewestFile @($Pattern)
}

function New-McpServer($Name, $Kind, $Url, $Command, $Arguments, $EnvVars) {
    return [pscustomobject]@{
        Name    = $Name
        Kind    = $Kind
        Url     = $Url
        Command = $Command
        Args    = @($Arguments)
        Env     = $EnvVars
    }
}

function Resolve-McpCatalog {
    $Catalog = New-Object System.Collections.ArrayList
    $Skipped = New-Object System.Collections.ArrayList

    # --- cocos-mcp: HTTP, served by the editor extension in this project.
    [void] $Catalog.Add((New-McpServer 'cocos-mcp' 'http' $CocosMcpUrl $null @() ([ordered]@{})))

    # --- blender-mcp: stdio bridge, talks to the Blender addon over TCP 9876.
    $BlenderPython = Join-Path $env:USERPROFILE '.codex\mcp\blender-1.0.0-official\.runtime-venv\Scripts\python.exe'
    if (Test-Path -LiteralPath $BlenderPython) {
        [void] $Catalog.Add((New-McpServer 'blender-mcp' 'stdio' $null $BlenderPython @('-m', 'blmcp') ([ordered]@{
            BLENDER_HOST = 'localhost'
            BLENDER_PORT = '9876'
        })))
    } else {
        [void] $Skipped.Add("blender-mcp (missing runtime venv: $BlenderPython)")
    }

    # --- gimp-mcp: stdio bridge, talks to the GIMP plug-in over TCP 9877.
    $GimpDir = Join-Path $env:USERPROFILE '.codex\mcp\gimp-mcp'
    $GimpEntry = Join-Path $GimpDir 'gimp_mcp_server.py'
    $UvExe = Resolve-UvExe
    if ((Test-Path -LiteralPath $GimpEntry) -and $UvExe) {
        [void] $Catalog.Add((New-McpServer 'gimp-mcp' 'stdio' $null $UvExe @('run', '--directory', $GimpDir, 'gimp_mcp_server.py') ([ordered]@{})))
    } elseif (-not $UvExe) {
        [void] $Skipped.Add('gimp-mcp (uv.exe not found)')
    } else {
        [void] $Skipped.Add("gimp-mcp (missing entry point: $GimpEntry)")
    }

    # --- node_repl: stdio JS sandbox from the Codex runtime.
    $NodeRepl = Resolve-NodeReplBin
    if ($NodeRepl) {
        $ReplBinDir = Split-Path $NodeRepl -Parent
        $CodexHome = Join-Path $env:USERPROFILE '.codex'
        # Codex also injects SKY_CUA_* browser-pipe variables tied to one live desktop
        # session; those cannot be reproduced here, so the browser tools stay Codex-only.
        # The JS sandbox tools (js / js_reset / js_add_node_module_dir) need only these.
        [void] $Catalog.Add((New-McpServer 'node_repl' 'stdio' $null $NodeRepl @() ([ordered]@{
            NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS = '1000'
            NODE_REPL_NODE_MODULE_DIRS               = (Join-Path $ReplBinDir 'node_modules')
            NODE_REPL_NODE_PATH                      = (Join-Path $ReplBinDir 'node.exe')
            NODE_REPL_TRUSTED_CODE_PATHS             = "$CodexHome;$(Join-Path $ReplBinDir 'node_modules')"
            CODEX_HOME                               = $CodexHome
        })))
    } else {
        [void] $Skipped.Add('node_repl (Codex cua_node runtime not found)')
    }

    return [pscustomobject]@{ Servers = @($Catalog); Skipped = @($Skipped) }
}

# -------------------------------------------------------------- serialization

function ConvertTo-EnvObject($EnvVars) {
    $Object = [pscustomobject]@{}
    foreach ($Key in $EnvVars.Keys) { Set-JsonProperty $Object $Key ([string] $EnvVars[$Key]) }
    return $Object
}

# Claude (claude_desktop_config.json, .mcp.json) and Copilot/VSCode share this shape.
function ConvertTo-TypedEntry($Server) {
    if ($Server.Kind -eq 'http') {
        return [pscustomobject][ordered]@{ type = 'http'; url = $Server.Url }
    }
    $Entry = [ordered]@{ type = 'stdio'; command = $Server.Command; args = @($Server.Args) }
    if ($Server.Env.Count -gt 0) { $Entry['env'] = ConvertTo-EnvObject $Server.Env }
    return [pscustomobject] $Entry
}

# Antigravity: stdio uses command/args/env, remote uses serverUrl. No "type" key.
function ConvertTo-AntigravityEntry($Server) {
    if ($Server.Kind -eq 'http') {
        return [pscustomobject][ordered]@{ serverUrl = $Server.Url }
    }
    $Entry = [ordered]@{ command = $Server.Command; args = @($Server.Args) }
    if ($Server.Env.Count -gt 0) { $Entry['env'] = ConvertTo-EnvObject $Server.Env }
    return [pscustomobject] $Entry
}

function Sync-ClientConfig {
    param(
        [string]   $Label,
        [string]   $Path,
        [string]   $RootKey,      # 'mcpServers' or 'servers'
        [object[]] $Servers,
        [string]   $Format,       # 'typed' or 'antigravity'
        [switch]   $MustExist     # only write when the client is actually installed
    )

    if ($MustExist -and -not (Test-Path -LiteralPath (Split-Path $Path -Parent))) {
        Write-Detail "[skip] $Label - not installed"
        return $false
    }
    if ($Servers.Count -eq 0) {
        Write-Detail "[skip] $Label - nothing to write"
        return $false
    }

    Backup-Once $Path
    $Config = Read-JsonObject $Path
    if (-not $Config.PSObject.Properties[$RootKey] -or $null -eq $Config.$RootKey -or $Config.$RootKey -is [array]) {
        Set-JsonProperty $Config $RootKey ([pscustomobject]@{})
    }

    foreach ($Server in $Servers) {
        if ($Format -eq 'antigravity') {
            $Entry = ConvertTo-AntigravityEntry $Server
        } else {
            $Entry = ConvertTo-TypedEntry $Server
        }
        Set-JsonProperty $Config.$RootKey $Server.Name $Entry
    }

    Write-JsonObject $Path $Config
    Write-Detail "[ok] $Label -> $(($Servers | ForEach-Object { $_.Name }) -join ', ')" 'Gray'
    return $true
}

function Sync-ClaudeUserScope($Servers) {
    $ClaudeExe = Get-NewestFile @((Join-Path $env:APPDATA 'Claude\claude-code\*\claude.exe'))
    if (-not $ClaudeExe) {
        $OnPath = Get-Command claude -ErrorAction SilentlyContinue
        if ($OnPath) { $ClaudeExe = $OnPath.Source }
    }
    if (-not $ClaudeExe) {
        Write-Detail '[skip] Claude Code user scope - claude CLI not found' 'Yellow'
        return
    }

    foreach ($Server in $Servers) {
        $Entry = ConvertTo-TypedEntry $Server
        $Json = $Entry | ConvertTo-Json -Depth 30 -Compress
        # add-json refuses to overwrite, so drop any previous registration first.
        & $ClaudeExe mcp remove $Server.Name --scope user 2>&1 | Out-Null
        $Output = & $ClaudeExe mcp add-json $Server.Name $Json --scope user 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Detail "[ok] Claude Code user scope -> $($Server.Name)" 'Gray'
        } else {
            Write-Detail "[warn] Claude Code user scope failed for $($Server.Name): $Output" 'Yellow'
        }
    }
}

function Test-CodexConfig($Servers) {
    $ConfigPath = Join-Path $env:USERPROFILE '.codex\config.toml'
    if (-not (Test-Path -LiteralPath $ConfigPath)) {
        Write-Detail '[skip] Codex / ChatGPT desktop - config.toml not found'
        return
    }
    $Raw = Get-Content -LiteralPath $ConfigPath -Raw
    $Missing = @($Servers | Where-Object { $Raw -notmatch [regex]::Escape("[mcp_servers.$($_.Name)]") } | ForEach-Object { $_.Name })
    if ($Missing.Count -eq 0) {
        Write-Detail '[ok] Codex / ChatGPT desktop already has every server' 'Gray'
    } else {
        Write-Detail "[warn] Codex / ChatGPT desktop is missing: $($Missing -join ', ') (add via its MCP settings)" 'Yellow'
    }
}

# ----------------------------------------------------------------- verification

# The handshake runs through Node, not PowerShell: a redirected StandardInput in
# Windows PowerShell writes an encoding preamble ahead of the first line, which every
# MCP server rejects as malformed JSON.
function Invoke-McpVerification($Servers) {
    Write-Step '==> Verifying MCP servers...'

    $Probe = Join-Path $PSScriptRoot 'mcp-probe.cjs'
    if (-not (Test-Path -LiteralPath $Probe)) {
        Write-Detail "[warn] Probe script not found: $Probe" 'Yellow'
        return $false
    }
    $Node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $Node) {
        Write-Detail '[warn] node not found on PATH, skipping verification' 'Yellow'
        return $false
    }

    $Spec = [pscustomobject]@{
        servers = @($Servers | ForEach-Object {
            [pscustomobject][ordered]@{
                name    = $_.Name
                kind    = $_.Kind
                url     = $_.Url
                command = $_.Command
                args    = @($_.Args)
                env     = (ConvertTo-EnvObject $_.Env)
            }
        })
    }

    $SpecPath = Join-Path ([System.IO.Path]::GetTempPath()) ("mcp-probe-$PID.json")
    try {
        Write-JsonObject $SpecPath $Spec
        $Lines = & $Node.Source $Probe $SpecPath 2>&1
        $AllOk = $true
        foreach ($Line in $Lines) {
            $Fields = ([string] $Line) -split "`t"
            if ($Fields.Count -lt 2) {
                Write-Detail $Line 'Yellow'
                continue
            }
            if ($Fields[1] -eq 'ok') {
                Write-Detail "[ok] $($Fields[0]) - $($Fields[2])" 'Green'
            } else {
                $AllOk = $false
                Write-Detail "[FAIL] $($Fields[0]) - $($Fields[2])" 'Red'
            }
        }
        return $AllOk
    } finally {
        if (Test-Path -LiteralPath $SpecPath) { Remove-Item -LiteralPath $SpecPath -Force }
    }
}

# ------------------------------------------------------------------------ main

$Resolved = Resolve-McpCatalog
$AllServers = $Resolved.Servers

if ($VerifyOnly) {
    foreach ($Note in $Resolved.Skipped) { Write-Host "  [skip] $Note" -ForegroundColor Yellow }
    Invoke-McpVerification $AllServers | Out-Null
    return
}

Write-Step '==> Syncing MCP clients...'
foreach ($Note in $Resolved.Skipped) { Write-Detail "[skip] $Note" 'Yellow' }

$WorkspaceOnly = @($AllServers | Where-Object { $_.Name -eq 'cocos-mcp' })
$UserOnly = @($AllServers | Where-Object { $_.Name -ne 'cocos-mcp' })

# Claude Code desktop + Claude Desktop read this one file; keep all four here so the
# clients see each server exactly once.
Sync-ClientConfig -Label 'Claude (desktop + Claude Code)' `
    -Path (Join-Path $env:APPDATA 'Claude\claude_desktop_config.json') `
    -RootKey 'mcpServers' -Servers $AllServers -Format 'typed' | Out-Null

# Antigravity: single global config, no workspace-level equivalent.
Sync-ClientConfig -Label 'Antigravity' `
    -Path (Join-Path $env:USERPROFILE '.gemini\config\mcp_config.json') `
    -RootKey 'mcpServers' -Servers $AllServers -Format 'antigravity' | Out-Null

# Copilot in VSCode: cocos-mcp belongs to the workspace (it is this project's editor),
# the machine-wide tools go to user scope so every folder gets them.
Sync-ClientConfig -Label 'Copilot / VSCode (workspace)' `
    -Path (Join-Path $ProjectDir '.vscode\mcp.json') `
    -RootKey 'servers' -Servers $WorkspaceOnly -Format 'typed' | Out-Null

Sync-ClientConfig -Label 'Copilot / VSCode (user)' `
    -Path (Join-Path $env:APPDATA 'Code\User\mcp.json') `
    -RootKey 'servers' -Servers $UserOnly -Format 'typed' -MustExist | Out-Null

Sync-ClientConfig -Label 'Copilot / VSCode Insiders (user)' `
    -Path (Join-Path $env:APPDATA 'Code - Insiders\User\mcp.json') `
    -RootKey 'servers' -Servers $UserOnly -Format 'typed' -MustExist | Out-Null

# Copilot in JetBrains has no workspace config, so it takes the full set.
Sync-ClientConfig -Label 'Copilot / JetBrains' `
    -Path (Join-Path $env:LOCALAPPDATA 'github-copilot\intellij\mcp.json') `
    -RootKey 'servers' -Servers $AllServers -Format 'typed' -MustExist | Out-Null

if ($ClaudeUserScope) { Sync-ClaudeUserScope $AllServers }

Test-CodexConfig $AllServers

if ($Verify) { Invoke-McpVerification $AllServers | Out-Null }
