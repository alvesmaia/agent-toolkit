param(
    [string]$CopilotHome = $(if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { Join-Path $env:USERPROFILE '.copilot' }),
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$hooksDir = Join-Path $CopilotHome 'hooks'
$targetDir = Join-Path $hooksDir 'command-guard'
$configPath = Join-Path $hooksDir 'command-guard.json'
$guardSource = Join-Path $source 'guard.ps1'
$guardTarget = Join-Path $targetDir 'guard.ps1'
$rulesSource = Join-Path $source 'rules.json'
$rulesTarget = Join-Path $targetDir 'rules.json'
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$interactive = (-not $Yes) -and (-not [Console]::IsInputRedirected)
$utf8 = New-Object System.Text.UTF8Encoding $false

function Get-FileSha256([string]$path) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($path)))
}

function Read-Choice([string]$question, [bool]$defaultYes) {
    $suffix = if ($defaultYes) { '[Y/n]' } else { '[y/N]' }
    $answer = Read-Host "$question $suffix"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $defaultYes }
    return ($answer -match '^(y|yes|s|sim)$')
}

function Read-RulesFile([string]$path) {
    @((Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json).rules)
}

function Write-RulesFile([string]$path, $rules) {
    $json = [pscustomobject]@{ rules = @($rules) } | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText($path, $json, $utf8)
}

function Get-RulesSignature($rules) {
    $json = @($rules | Select-Object -Property * -ExcludeProperty enabled) | ConvertTo-Json -Depth 10 -Compress
    $sha = [System.Security.Cryptography.SHA256]::Create()
    [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($json)))
}

function Write-RuleLine($rule, [bool]$selected, [int]$width) {
    $prefix = '  '
    if ($selected) { $prefix = '> ' }
    $box = '[ ]'
    $boxColor = 'DarkGray'
    if ($rule.enabled) { $box = '[x]'; $boxColor = 'Green' }
    $text = '{0} {1,-20} {2}' -f $box, $rule.id, $rule.message
    $line = $prefix + $text
    if ($line.Length -gt $width) { $line = $line.Substring(0, $width) } else { $line = $line.PadRight($width) }
    $rest = $line.Substring($prefix.Length + 3)
    $label = $line.Substring(0, $prefix.Length)
    $boxPart = $line.Substring($prefix.Length, 3)
    if ($selected) {
        Write-Host $label -NoNewline -ForegroundColor Cyan -BackgroundColor DarkBlue
        Write-Host $boxPart -NoNewline -ForegroundColor $boxColor -BackgroundColor DarkBlue
        Write-Host $rest -ForegroundColor White -BackgroundColor DarkBlue
    } else {
        Write-Host $label -NoNewline
        Write-Host $boxPart -NoNewline -ForegroundColor $boxColor
        Write-Host $rest
    }
}

function Select-Rules($rules) {
    $changed = $false
    $index = 0
    $width = [Math]::Max(40, [Console]::WindowWidth - 2)
    Write-Host ''
    Write-Host 'Up/Down or Tab: move   Space: toggle   A: all   N: none   Enter: confirm' -ForegroundColor DarkGray
    $listTop = [Console]::CursorTop
    while ($true) {
        [Console]::SetCursorPosition(0, $listTop)
        for ($i = 0; $i -lt $rules.Count; $i++) {
            Write-RuleLine $rules[$i] ($i -eq $index) $width
        }
        $enabledCount = @($rules | Where-Object { $_.enabled }).Count
        Write-Host ("Enabled: {0} of {1}" -f $enabledCount, $rules.Count).PadRight($width) -ForegroundColor Yellow
        $key = [Console]::ReadKey($true)
        switch ($key.Key) {
            'UpArrow' { if ($index -gt 0) { $index-- } }
            'DownArrow' { if ($index -lt $rules.Count - 1) { $index++ } }
            'Tab' { if ($index -lt $rules.Count - 1) { $index++ } }
            'Spacebar' {
                $rules[$index].enabled = -not $rules[$index].enabled
                $changed = $true
            }
            'Enter' { return $changed }
        }
        switch ($key.KeyChar) {
            'a' { foreach ($r in $rules) { $r.enabled = $true }; $changed = $true }
            'A' { foreach ($r in $rules) { $r.enabled = $true }; $changed = $true }
            'n' { foreach ($r in $rules) { $r.enabled = $false }; $changed = $true }
            'N' { foreach ($r in $rules) { $r.enabled = $false }; $changed = $true }
        }
    }
}

$sourceRules = Read-RulesFile $rulesSource
$sourceSignature = Get-RulesSignature $sourceRules
$guardSame = (Test-Path -LiteralPath $guardTarget) -and ((Get-FileSha256 $guardTarget) -eq (Get-FileSha256 $guardSource))

$rulesExists = Test-Path -LiteralPath $rulesTarget
$targetRules = $null
if ($rulesExists) { $targetRules = Read-RulesFile $rulesTarget }
$rulesDiffer = $rulesExists -and ((Get-RulesSignature $targetRules) -ne $sourceSignature)

$guardCommand = 'powershell -NoProfile -ExecutionPolicy RemoteSigned -File "' + $guardTarget + '"'
$config = [ordered]@{
    version = 1
    hooks = [ordered]@{
        preToolUse = @(
            [ordered]@{ type = 'command'; powershell = $guardCommand; timeoutSec = 30 }
        )
    }
}
$configJson = $config | ConvertTo-Json -Depth 6
$configExists = Test-Path -LiteralPath $configPath
$configSame = $configExists -and ((Get-Content -LiteralPath $configPath -Raw -Encoding UTF8).Trim() -eq $configJson.Trim())

Write-Output 'Plan:'
Write-Output "  guard.ps1 -> $guardTarget $(if ($guardSame) { '(already current)' } else { '(copy)' })"
if (-not $rulesExists) {
    Write-Output "  rules.json -> $rulesTarget (create)"
} elseif ($rulesDiffer) {
    Write-Output "  rules.json -> $rulesTarget (differs from the new defaults: you choose)"
} else {
    Write-Output "  rules.json -> $rulesTarget (matches the defaults; enabled flags are yours)"
}
if (-not $configExists) {
    Write-Output "  command-guard.json -> $configPath (create)"
} elseif ($configSame) {
    Write-Output "  command-guard.json -> $configPath (already current)"
} else {
    Write-Output "  command-guard.json -> $configPath (differs: you choose, old one is backed up)"
}

$replaceRules = $false
$replaceConfig = $true
if ($interactive) {
    if ($rulesDiffer) {
        $replaceRules = Read-Choice 'Replace your rules.json with the new defaults? Your copy is backed up.' $false
    }
    if ($configExists -and -not $configSame) {
        $replaceConfig = Read-Choice 'Replace the existing command-guard.json? The old one is backed up.' $true
    }
}

if ($replaceRules -or -not $rulesExists) {
    $baseRules = $sourceRules
} else {
    $baseRules = $targetRules
}

$togglesChanged = $false
if ($interactive) {
    $togglesChanged = Select-Rules $baseRules
}

$rulesChanged = (-not $rulesExists) -or $replaceRules -or $togglesChanged
$rulesDefaultNeeded = $rulesDiffer -and (-not $replaceRules)
$configChanged = -not $configSame
$needsWork = (-not $guardSame) -or $rulesChanged -or $rulesDefaultNeeded -or $configChanged

if (-not $needsWork) {
    Write-Output 'Nothing to change.'
    exit 0
}

$enabledCount = @($baseRules | Where-Object { $_.enabled }).Count
Write-Output "Enabled rules: $enabledCount of $($baseRules.Count)"

if ($interactive) {
    if (-not (Read-Choice 'Apply these changes?' $true)) {
        Write-Output 'Cancelled. Nothing changed.'
        exit 0
    }
} elseif (-not $Yes) {
    Write-Error 'Non-interactive run: pass -Yes to accept the plan without prompts.'
    exit 1
}

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -LiteralPath $guardSource -Destination $guardTarget -Force

if (-not $rulesExists) {
    Write-RulesFile $rulesTarget $baseRules
    Write-Output "installed $rulesTarget"
} elseif ($replaceRules) {
    Copy-Item -LiteralPath $rulesTarget -Destination "$rulesTarget.bak-$stamp"
    Write-RulesFile $rulesTarget $baseRules
    Write-Output "replaced $rulesTarget (backup: $rulesTarget.bak-$stamp)"
} elseif ($rulesChanged) {
    Write-RulesFile $rulesTarget $baseRules
    Write-Output "updated enabled rules in $rulesTarget"
}

if ($rulesDefaultNeeded) {
    Copy-Item -LiteralPath $rulesSource -Destination (Join-Path $targetDir 'rules.default.json') -Force
    Write-Output 'kept your rules.json; new defaults written to rules.default.json'
}

if (-not $configExists) {
    [IO.File]::WriteAllText($configPath, $configJson, $utf8)
    Write-Output "installed hook config: $configPath"
} elseif ($configChanged) {
    if ($replaceConfig) {
        Copy-Item -LiteralPath $configPath -Destination "$configPath.bak-$stamp"
        [IO.File]::WriteAllText($configPath, $configJson, $utf8)
        Write-Output "replaced hook config: $configPath (backup: $configPath.bak-$stamp)"
    } else {
        Write-Output "kept existing hook config: $configPath"
    }
}

Write-Output 'Restart Copilot CLI to load the hook.'
