param(
    [string]$CopilotHome = $(if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { Join-Path $env:USERPROFILE '.copilot' })
)

$ErrorActionPreference = 'Stop'
$hooksDir = Join-Path $CopilotHome 'hooks'
$targetDir = Join-Path $hooksDir 'command-guard'
$configPath = Join-Path $hooksDir 'command-guard.json'
$stamp = Get-Date -Format 'yyyyMMddHHmmss'

if (Test-Path -LiteralPath $configPath) {
    $content = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
    if ($content -match 'command-guard') {
        Remove-Item -LiteralPath $configPath -Force
        Write-Output "removed hook config: $configPath"
    } else {
        Write-Output "skipped ${configPath}: it does not reference command-guard"
    }
} else {
    Write-Output "hook config not present: $configPath"
}

if (Test-Path -LiteralPath $targetDir) {
    $archive = Join-Path $CopilotHome "command-guard-removed-$stamp"
    Move-Item -LiteralPath $targetDir -Destination $archive
    Write-Output "moved $targetDir to $archive (guard.log and your rules.json are kept there)"
} else {
    Write-Output "guard directory not present: $targetDir"
}
