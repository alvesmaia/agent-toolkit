param(
    [string]$CopilotHome = $(if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { Join-Path $env:USERPROFILE '.copilot' })
)

$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$hooksDir = Join-Path $CopilotHome 'hooks'
$targetDir = Join-Path $hooksDir 'command-guard'
$configPath = Join-Path $hooksDir 'command-guard.json'
$stamp = Get-Date -Format 'yyyyMMddHHmmss'

function Get-FileSha256([string]$path) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($path)))
}

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$guardTarget = Join-Path $targetDir 'guard.ps1'
Copy-Item -LiteralPath (Join-Path $source 'guard.ps1') -Destination $guardTarget -Force

$rulesSource = Join-Path $source 'rules.json'
$rulesTarget = Join-Path $targetDir 'rules.json'
if (-not (Test-Path -LiteralPath $rulesTarget)) {
    Copy-Item -LiteralPath $rulesSource -Destination $rulesTarget
    Write-Output "installed $rulesTarget"
} elseif ((Get-FileSha256 $rulesTarget) -ne (Get-FileSha256 $rulesSource)) {
    Copy-Item -LiteralPath $rulesSource -Destination (Join-Path $targetDir 'rules.default.json') -Force
    Write-Output "kept your $rulesTarget; latest defaults written to rules.default.json"
}

$guardCommand = 'powershell -NoProfile -ExecutionPolicy RemoteSigned -File "' + $guardTarget + '"'
$config = [ordered]@{
    version = 1
    hooks = [ordered]@{
        preToolUse = @(
            [ordered]@{ type = 'command'; powershell = $guardCommand; timeoutSec = 30 }
        )
    }
}
$json = $config | ConvertTo-Json -Depth 6

if (Test-Path -LiteralPath $configPath) {
    $current = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
    if ($current.Trim() -eq $json.Trim()) {
        Write-Output "hook config already up to date: $configPath"
        exit 0
    }
    $backup = "$configPath.bak-$stamp"
    Copy-Item -LiteralPath $configPath -Destination $backup
    Write-Output "previous config backed up to $backup"
}

[IO.File]::WriteAllText($configPath, $json, (New-Object System.Text.UTF8Encoding $false))
Write-Output "installed hook config: $configPath"
Write-Output "restart Copilot CLI to load the hook"
