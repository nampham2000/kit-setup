Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Set-Location -Path (Join-Path $PSScriptRoot '..\..\..')
node .\playable-shared-kit\tools\playable-build.cjs build @args
