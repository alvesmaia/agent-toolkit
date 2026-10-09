$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$install = Join-Path $root 'install.ps1'
$uninstall = Join-Path $root 'uninstall.ps1'
$copilotHome = Join-Path ([IO.Path]::GetTempPath()) ('guard-home-' + [guid]::NewGuid().ToString('N'))
$hooks = Join-Path $copilotHome 'hooks'
$failures = 0

function Assert([bool]$condition, [string]$name) {
    if ($condition) { Write-Output "PASS  $name" } else { $script:failures++; Write-Output "FAIL  $name" }
}

function Get-Hash([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return '' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($path)))
}

try {
    New-Item -ItemType Directory -Path $hooks -Force | Out-Null
    $other = Join-Path $hooks 'other.json'
    [IO.File]::WriteAllText($other, '{"version":1,"hooks":{"preToolUse":[{"type":"command","powershell":"exit 0","timeoutSec":5}]}}')
    $otherHash = Get-Hash $other

    & $install -CopilotHome $copilotHome | Out-Null
    $config = Join-Path $hooks 'command-guard.json'
    Assert (Test-Path -LiteralPath (Join-Path $hooks 'command-guard\guard.ps1')) 'install copies guard.ps1'
    Assert (Test-Path -LiteralPath (Join-Path $hooks 'command-guard\rules.json')) 'install copies rules.json'
    Assert (Test-Path -LiteralPath $config) 'install writes command-guard.json'
    Assert ((Get-Hash $other) -eq $otherHash) 'install leaves other hook config untouched'
    $configHash = Get-Hash $config
    $parsed = Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
    Assert ($parsed.version -eq 1 -and $parsed.hooks.preToolUse[0].timeoutSec -eq 30) 'config has version 1 and timeoutSec 30'

    & $install -CopilotHome $copilotHome | Out-Null
    Assert ((Get-Hash $config) -eq $configHash) 'second install is idempotent'
    Assert (@(Get-ChildItem -LiteralPath $hooks -Filter 'command-guard.json.bak-*').Count -eq 0) 'second install creates no backup'

    [IO.File]::WriteAllText($config, '{"version":2}')
    & $install -CopilotHome $copilotHome | Out-Null
    Assert (@(Get-ChildItem -LiteralPath $hooks -Filter 'command-guard.json.bak-*').Count -eq 1) 'changed config is backed up before rewrite'
    Assert ((Get-Hash $config) -eq $configHash) 'changed config is restored to expected content'

    $userRules = Join-Path $hooks 'command-guard\rules.json'
    Add-Content -LiteralPath $userRules -Value ' '
    $userRulesHash = Get-Hash $userRules
    & $install -CopilotHome $copilotHome | Out-Null
    Assert ((Get-Hash $userRules) -eq $userRulesHash) 'user edits to rules.json are preserved'
    Assert (Test-Path -LiteralPath (Join-Path $hooks 'command-guard\rules.default.json')) 'latest defaults written to rules.default.json'

    & $uninstall -CopilotHome $copilotHome | Out-Null
    Assert (-not (Test-Path -LiteralPath $config)) 'uninstall removes command-guard.json'
    Assert (-not (Test-Path -LiteralPath (Join-Path $hooks 'command-guard'))) 'uninstall moves guard directory out of hooks'
    Assert ((Get-Hash $other) -eq $otherHash) 'uninstall leaves other hook config untouched'
    Assert (@(Get-ChildItem -LiteralPath $copilotHome -Filter 'command-guard-removed-*').Count -eq 1) 'uninstall archives guard directory'

    & $uninstall -CopilotHome $copilotHome | Out-Null
    Assert ((Get-Hash $other) -eq $otherHash) 'second uninstall is a no-op'
} finally {
    Remove-Item -LiteralPath $copilotHome -Recurse -Force -ErrorAction SilentlyContinue
}

if ($failures -gt 0) { Write-Output "$failures failure(s)"; exit 1 }
Write-Output 'all install tests passed'
exit 0
