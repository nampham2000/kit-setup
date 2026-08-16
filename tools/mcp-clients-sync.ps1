#Requires -Version 5.1
<#
.SYNOPSIS
    Registers the project's MCP servers with every AI client installed on this machine (Windows & macOS).

.DESCRIPTION
    One catalog, many client config formats. The catalog is resolved from what is
    actually installed (binaries are probed, never assumed), then written into each
    client's own config file:

      cocos-mcp    Streamable HTTP served by the Cocos Creator editor extension (Port 3000).
      blender-mcp  stdio bridge to the Blender MCP addon (TCP 9876).
      gimp-mcp     stdio bridge to the GIMP MCP plug-in (TCP 9877).
      work-memory  stdio SQLite + semantic memory store in playable-shared-kit.
      node_repl    stdio JS sandbox shipped with the Codex runtime (Codex only).

    Only stdio servers are spawned by the clients themselves - a stdio server is not
    a daemon, so there is nothing to "start" for those beyond making sure the app they
    talk to (Blender / GIMP) is running. 1_open-project.bat handles that part.

    Scope rule: a server name is written to exactly one scope per client, so no client
    ever sees the same server twice. cocos-mcp & work-memory stay in the workspace file for VSCode
    (they are per-project endpoints); everything else lands in the user config.

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

$ProjectDir = [System.IO.Path]::GetFullPath($ProjectDir).TrimEnd('\').TrimEnd('/')
$CocosMcpUrl = "http://127.0.0.1:$CocosMcpPort/mcp"

$IsMacOS = $false
try {
    if ($PSVersionTable.PSObject.Properties['PSVersion'] -and $PSVersionTable.PSVersion.Major -ge 6) {
        $IsMacOS = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::OSX)
    }
} catch { $IsMacOS = $false }

function Get-UserHome {
    if ($env:USERPROFILE) { return $env:USERPROFILE }
    if ($env:HOME) { return $env:HOME }
    return [Environment]::GetFolderPath('UserProfile')
}

$HomeDir = Get-UserHome

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
        (Join-Path $HomeDir '.local\bin\uv.exe'),
        (Join-Path $HomeDir '.cargo\bin\uv.exe'),
        (Join-Path $HomeDir '.local/bin/uv'),
        (Join-Path $HomeDir '.cargo/bin/uv'),
        '/usr/local/bin/uv',
        '/opt/homebrew/bin/uv'
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

    # --- 1) cocos-mcp: HTTP, served by the editor extension in this project.
    [void] $Catalog.Add((New-McpServer 'cocos-mcp' 'http' $CocosMcpUrl $null @() ([ordered]@{})))

    # --- 2) work-memory: stdio bridge to local SQLite & semantic memory in shared kit.
    $WorkMemoryScript = Join-Path $ProjectDir 'playable-shared-kit\tools\work-memory-mcp.cjs'
    if (-not (Test-Path -LiteralPath $WorkMemoryScript)) {
        $WorkMemoryScript = Join-Path $ProjectDir 'playable-shared-kit/tools/work-memory-mcp.cjs'
    }
    if (Test-Path -LiteralPath $WorkMemoryScript) {
        $NodeCmd = Get-Command node -ErrorAction SilentlyContinue
        $NodeBin = if ($NodeCmd) { $NodeCmd.Source } else { 'node' }
        [void] $Catalog.Add((New-McpServer 'work-memory' 'stdio' $null $NodeBin @($WorkMemoryScript) ([ordered]@{
            WORK_MEMORY_REPO_ROOT = $ProjectDir
        })))
    } else {
        [void] $Skipped.Add("work-memory (missing script: $WorkMemoryScript)")
    }

    # --- 3) blender-mcp: stdio bridge, talks to the Blender addon over TCP 9876.
    $BlenderNodeServer = Join-Path $ProjectDir 'playable-shared-kit\tools\blender-mcp\blender-mcp-server.cjs'
    if (-not (Test-Path -LiteralPath $BlenderNodeServer)) {
        $BlenderNodeServer = Join-Path $ProjectDir 'playable-shared-kit/tools/blender-mcp/blender-mcp-server.cjs'
    }
    if (Test-Path -LiteralPath $BlenderNodeServer) {
        $NodeCmd = Get-Command node -ErrorAction SilentlyContinue
        $NodeBin = if ($NodeCmd) { $NodeCmd.Source } else { 'node' }
        [void] $Catalog.Add((New-McpServer 'blender-mcp' 'stdio' $null $NodeBin @($BlenderNodeServer) ([ordered]@{
            BLENDER_HOST = '127.0.0.1'
            BLENDER_PORT = '9876'
        })))
    } else {
        $BlenderPythonCandidates = @(
            (Join-Path $HomeDir '.codex\mcp\blender-1.0.0-official\.runtime-venv\Scripts\python.exe'),
            (Join-Path $HomeDir '.codex/mcp/blender-1.0.0-official/.runtime-venv/bin/python'),
            (Join-Path $HomeDir '.codex/mcp/blender-1.0.0-official/.runtime-venv/bin/python3')
        )
        $BlenderPython = $null
        foreach ($candidate in $BlenderPythonCandidates) {
            if (Test-Path -LiteralPath $candidate) { $BlenderPython = $candidate; break }
        }
        if ($BlenderPython) {
            [void] $Catalog.Add((New-McpServer 'blender-mcp' 'stdio' $null $BlenderPython @('-m', 'blmcp') ([ordered]@{
                BLENDER_HOST = 'localhost'
                BLENDER_PORT = '9876'
            })))
        } else {
            [void] $Skipped.Add("blender-mcp (blender-mcp-server script or blmcp runtime not found)")
        }
    }

    # --- 4) gimp-mcp: stdio bridge, talks to the GIMP plug-in over TCP 9877.
    $GimpDir = Join-Path $HomeDir '.codex\mcp\gimp-mcp'
    if (-not (Test-Path -LiteralPath $GimpDir)) {
        $GimpDir = Join-Path $HomeDir '.codex/mcp/gimp-mcp'
    }
    $GimpEntry = Join-Path $GimpDir 'gimp_mcp_server.py'
    $UvExe = Resolve-UvExe
    if ((Test-Path -LiteralPath $GimpEntry) -and $UvExe) {
        [void] $Catalog.Add((New-McpServer 'gimp-mcp' 'stdio' $null $UvExe @('run', '--directory', $GimpDir, 'gimp_mcp_server.py') ([ordered]@{})))
    } elseif (-not $UvExe) {
        [void] $Skipped.Add('gimp-mcp (uv.exe / uv not found)')
    } else {
        [void] $Skipped.Add("gimp-mcp (missing entry point: $GimpEntry)")
    }

    # --- optional) node_repl: stdio JS sandbox from the Codex runtime.
    $NodeRepl = Resolve-NodeReplBin
    if ($NodeRepl) {
        $ReplBinDir = Split-Path $NodeRepl -Parent
        $CodexHome = Join-Path $HomeDir '.codex'
        [void] $Catalog.Add((New-McpServer 'node_repl' 'stdio' $null $NodeRepl @() ([ordered]@{
            NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS = '1000'
            NODE_REPL_NODE_MODULE_DIRS               = (Join-Path $ReplBinDir 'node_modules')
            NODE_REPL_NODE_PATH                      = (Join-Path $ReplBinDir 'node.exe')
            NODE_REPL_TRUSTED_CODE_PATHS             = "$CodexHome;$(Join-Path $ReplBinDir 'node_modules')"
            CODEX_HOME                               = $CodexHome
        })))
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

# Claude Desktop (claude_desktop_config.json) only supports stdio servers (command, args, env).
# It strictly rejects "type" and "url" fields.
# Remote HTTP endpoints (like cocos-mcp) are bridged via cocos-mcp-bridge.cjs.
function ConvertTo-ClaudeEntry($Server) {
    if ($Server.Kind -eq 'http') {
        $BridgeScript = Join-Path $ProjectDir 'playable-shared-kit\tools\cocos-mcp-bridge.cjs'
        if (-not (Test-Path -LiteralPath $BridgeScript)) {
            $BridgeScript = Join-Path $ProjectDir 'playable-shared-kit/tools/cocos-mcp-bridge.cjs'
        }
        $NodeCmd = Get-Command node -ErrorAction SilentlyContinue
        $NodeBin = if ($NodeCmd) { $NodeCmd.Source } else { 'node' }
        $Entry = [ordered]@{
            command = $NodeBin
            args    = @($BridgeScript)
            env     = ConvertTo-EnvObject ([ordered]@{ COCOS_MCP_URL = $Server.Url })
        }
        return [pscustomobject] $Entry
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
        [string]   $Format,       # 'typed', 'antigravity', or 'claude'
        [string[]] $RemoveKeys = @('node_repl'),
        [switch]   $MustExist     # only write when the client is actually installed
    )

    if ($MustExist -and -not (Test-Path -LiteralPath (Split-Path $Path -Parent))) {
        Write-Detail "[skip] $Label - not installed"
        return $false
    }
    if (($null -eq $Servers -or $Servers.Count -eq 0) -and ($null -eq $RemoveKeys -or $RemoveKeys.Count -eq 0)) {
        Write-Detail "[skip] $Label - nothing to write"
        return $false
    }

    Backup-Once $Path
    $Config = Read-JsonObject $Path
    if (-not $Config.PSObject.Properties[$RootKey] -or $null -eq $Config.$RootKey -or $Config.$RootKey -is [array]) {
        Set-JsonProperty $Config $RootKey ([pscustomobject]@{})
    }

    # Clean up explicitly excluded / unsupported servers for this client (e.g. node_repl for non-Codex)
    if ($RemoveKeys) {
        foreach ($Key in $RemoveKeys) {
            if ($Config.$RootKey.PSObject.Properties[$Key]) {
                $Config.$RootKey.PSObject.Properties.Remove($Key)
                Write-Detail "[clean] $Label -> removed $Key" 'DarkYellow'
            }
        }
    }

    foreach ($Server in $Servers) {
        if ($Format -eq 'antigravity') {
            $Entry = ConvertTo-AntigravityEntry $Server
        } elseif ($Format -eq 'claude') {
            $Entry = ConvertTo-ClaudeEntry $Server
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
    $ClaudeCandidates = @(
        (Join-Path $env:APPDATA 'Claude\claude-code\*\claude.exe'),
        (Join-Path $HomeDir '.local/bin/claude'),
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude'
    )
    $ClaudeExe = Get-NewestFile $ClaudeCandidates
    if (-not $ClaudeExe) {
        $OnPath = Get-Command claude -ErrorAction SilentlyContinue
        if ($OnPath) { $ClaudeExe = $OnPath.Source }
    }
    if (-not $ClaudeExe) {
        Write-Detail '[skip] Claude Code user scope - claude CLI not found' 'Yellow'
        return
    }

    # Clean up node_repl from Claude user scope if present
    & $ClaudeExe mcp remove node_repl --scope user 2>&1 | Out-Null

    foreach ($Server in $Servers) {
        $Entry = ConvertTo-TypedEntry $Server
        $Json = $Entry | ConvertTo-Json -Depth 30 -Compress
        & $ClaudeExe mcp remove $Server.Name --scope user 2>&1 | Out-Null
        $Output = & $ClaudeExe mcp add-json $Server.Name $Json --scope user 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Detail "[ok] Claude Code user scope -> $($Server.Name)" 'Gray'
        } else {
            Write-Detail "[warn] Claude Code user scope failed for $($Server.Name): $Output" 'Yellow'
        }
    }
}

function Sync-CodexConfig($Servers) {
    $CodexDir = Join-Path $HomeDir '.codex'
    $ConfigPath = Join-Path $CodexDir 'config.toml'
    if (-not (Test-Path -LiteralPath $CodexDir)) {
        Write-Detail '[skip] Codex / ChatGPT desktop - .codex folder not found'
        return
    }

    Backup-Once $ConfigPath
    $Raw = if (Test-Path -LiteralPath $ConfigPath) { Get-Content -LiteralPath $ConfigPath -Raw } else { "" }
    $Updated = $Raw

    foreach ($Server in $Servers) {
        $TomlKey = $Server.Name -replace '-', '_'
        $SectionHeader = "[mcp_servers.$TomlKey]"
        
        $Lines = New-Object System.Collections.Generic.List[string]
        $Lines.Add($SectionHeader)
        if ($Server.Kind -eq 'http') {
            $Lines.Add("url = `"$($Server.Url)`"")
        } else {
            $EscapedCmd = ($Server.Command -replace '\\', '/')
            $Lines.Add("command = `"$EscapedCmd`"")
            $ArgsToml = @($Server.Args | ForEach-Object { '"' + ($_ -replace '\\', '/') + '"' }) -join ', '
            $Lines.Add("args = [$ArgsToml]")
            if ($Server.Env.Count -gt 0) {
                $EnvPairs = @($Server.Env.Keys | ForEach-Object { "$_ = `"$($Server.Env[$_] -replace '\\', '/')`"" }) -join ', '
                $Lines.Add("env = { $EnvPairs }")
            }
        }
        $Block = ($Lines -join [Environment]::NewLine) + [Environment]::NewLine

        if ($Updated -match [regex]::Escape($SectionHeader)) {
            $Pattern = "(?ms)^\s*" + [regex]::Escape($SectionHeader) + ".*?(?=^\s*\[|\z)"
            $Updated = [regex]::Replace($Updated, $Pattern, $Block)
        } else {
            if (-not [string]::IsNullOrWhiteSpace($Updated) -and -not $Updated.EndsWith([Environment]::NewLine)) {
                $Updated += [Environment]::NewLine
            }
            $Updated += [Environment]::NewLine + $Block
        }
    }

    [System.IO.File]::WriteAllText($ConfigPath, $Updated.Trim() + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
    Write-Detail "[ok] Codex / ChatGPT desktop -> $(($Servers | ForEach-Object { $_.Name }) -join ', ')" 'Gray'
}

# ----------------------------------------------------------------- verification

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

# node_repl is an internal runtime sandbox specifically for OpenAI Codex.
# Exclude it from all standard AI providers (Claude, Antigravity/Gemini, VSCode/Copilot, JetBrains).
$StandardServers = @($AllServers | Where-Object { $_.Name -ne 'node_repl' })
$CodexServers = $AllServers

if ($VerifyOnly) {
    foreach ($Note in $Resolved.Skipped) { Write-Host "  [skip] $Note" -ForegroundColor Yellow }
    Invoke-McpVerification $StandardServers | Out-Null
    return
}

Write-Step '==> Syncing MCP clients...'
foreach ($Note in $Resolved.Skipped) { Write-Detail "[skip] $Note" 'Yellow' }

$WorkspaceOnly = @($StandardServers | Where-Object { $_.Name -in @('cocos-mcp', 'work-memory') })
$UserOnly = @($StandardServers | Where-Object { $_.Name -notin @('cocos-mcp', 'work-memory') })

# 1) Claude Desktop (Anthropic stdio schema, bridges HTTP endpoints)
$ClaudeDesktopPath = if ($IsMacOS) {
    Join-Path $HomeDir 'Library/Application Support/Claude/claude_desktop_config.json'
} else {
    Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'
}
Sync-ClientConfig -Label 'Claude (desktop)' `
    -Path $ClaudeDesktopPath `
    -RootKey 'mcpServers' -Servers $StandardServers -Format 'claude' -RemoveKeys @('node_repl') | Out-Null

# Also sync Windows Store / MSIX packaged Claude instances if present
if (-not $IsMacOS) {
    $PackagedClaudeDirs = Get-ChildItem -Path "$env:LOCALAPPDATA\Packages" -Filter "*Claude*" -ErrorAction SilentlyContinue
    foreach ($PkgDir in $PackagedClaudeDirs) {
        $PkgClaudePath = Join-Path $PkgDir.FullName 'LocalCache\Roaming\Claude\claude_desktop_config.json'
        Sync-ClientConfig -Label 'Claude (MS Store / packaged)' `
            -Path $PkgClaudePath `
            -RootKey 'mcpServers' -Servers $StandardServers -Format 'claude' -RemoveKeys @('node_repl') | Out-Null
    }
}

# 2) Antigravity / Gemini (standard servers only)
$AntigravityPath = Join-Path $HomeDir '.gemini/config/mcp_config.json'
Sync-ClientConfig -Label 'Antigravity / Gemini' `
    -Path $AntigravityPath `
    -RootKey 'mcpServers' -Servers $StandardServers -Format 'antigravity' -RemoveKeys @('node_repl') | Out-Null

# 3) Copilot in VSCode: cocos-mcp & work-memory belong to the workspace, machine-wide tools go to user scope
Sync-ClientConfig -Label 'Copilot / VSCode (workspace)' `
    -Path (Join-Path $ProjectDir '.vscode\mcp.json') `
    -RootKey 'servers' -Servers $WorkspaceOnly -Format 'typed' -RemoveKeys @('node_repl') | Out-Null

$VSCodeUserPath = if ($IsMacOS) {
    Join-Path $HomeDir 'Library/Application Support/Code/User/mcp.json'
} else {
    Join-Path $env:APPDATA 'Code\User\mcp.json'
}
Sync-ClientConfig -Label 'Copilot / VSCode (user)' `
    -Path $VSCodeUserPath `
    -RootKey 'servers' -Servers $UserOnly -Format 'typed' -RemoveKeys @('node_repl') -MustExist | Out-Null

if (-not $IsMacOS) {
    Sync-ClientConfig -Label 'Copilot / VSCode Insiders (user)' `
        -Path (Join-Path $env:APPDATA 'Code - Insiders\User\mcp.json') `
        -RootKey 'servers' -Servers $UserOnly -Format 'typed' -RemoveKeys @('node_repl') -MustExist | Out-Null
}

# Copilot in JetBrains takes standard set
$JetBrainsPath = if ($IsMacOS) {
    Join-Path $HomeDir 'Library/Application Support/github-copilot/intellij/mcp.json'
} else {
    Join-Path $env:LOCALAPPDATA 'github-copilot\intellij\mcp.json'
}
Sync-ClientConfig -Label 'Copilot / JetBrains' `
    -Path $JetBrainsPath `
    -RootKey 'servers' -Servers $StandardServers -Format 'typed' -RemoveKeys @('node_repl') -MustExist | Out-Null

if ($ClaudeUserScope) { Sync-ClaudeUserScope $StandardServers }

# 4) Codex / ChatGPT Desktop (only client that receives node_repl)
Sync-CodexConfig $CodexServers

if ($Verify) { Invoke-McpVerification $StandardServers | Out-Null }
