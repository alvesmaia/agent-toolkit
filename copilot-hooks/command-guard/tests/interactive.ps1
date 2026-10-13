# Drives install.ps1 in a real console window with keystrokes. Needs an interactive desktop session.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$install = Join-Path $root 'install.ps1'
$shell = New-Object -ComObject WScript.Shell
$failures = 0

function New-TempHome {
    $path = Join-Path ([IO.Path]::GetTempPath()) ('guard-ui-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $path | Out-Null
    $path
}

function Invoke-Interactive([string]$copilotHome, [string[]]$keys) {
    $title = 'guard-ui-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $transcript = Join-Path ([IO.Path]::GetTempPath()) ("$title.txt")
    $command = "Start-Transcript -Path '$transcript' | Out-Null; `$Host.UI.RawUI.WindowTitle='$title'; & '$install' -CopilotHome '$copilotHome'; Stop-Transcript | Out-Null"
    $process = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-Command', $command) -PassThru
    Start-Sleep -Seconds 5
    $null = $shell.AppActivate($title)
    Start-Sleep -Milliseconds 800
    foreach ($key in $keys) {
        $shell.SendKeys($key)
        Start-Sleep -Milliseconds 1500
    }
    $exited = $process.WaitForExit(30000)
    if (-not $exited) { $process.Kill() }
    [pscustomobject]@{ Exited = $exited; Transcript = $transcript }
}

function Assert([bool]$condition, [string]$name) {
    if ($condition) { Write-Output "PASS  $name" } else { $script:failures++; Write-Output "FAIL  $name" }
}

# A: fresh install, disable rule 2 (encoded-command), confirm, apply
$homeA = New-TempHome
$runA = Invoke-Interactive $homeA @('2', '{ENTER}', '{ENTER}', '{ENTER}')
$rulesA = Join-Path $homeA 'hooks\command-guard\rules.json'
Assert $runA.Exited 'A: installer exits after confirmation'
Assert (Test-Path -LiteralPath (Join-Path $homeA 'hooks\command-guard.json')) 'A: hook config written'
if (Test-Path -LiteralPath $rulesA) {
    $rulesObjA = (Get-Content -LiteralPath $rulesA -Raw -Encoding UTF8 | ConvertFrom-Json).rules
    Assert ($rulesObjA[1].id -eq 'encoded-command' -and $rulesObjA[1].enabled -eq $false) 'A: rule 2 disabled in rules.json'
    Assert ($rulesObjA[0].enabled -eq $true) 'A: other rules still enabled'
} else {
    $script:failures++; Write-Output 'FAIL  A: rules.json missing'
}

# B: existing customized rules.json, choose to replace it
$homeB = New-TempHome
$installer = Join-Path $root 'install.ps1'
& $installer -CopilotHome $homeB -Yes | Out-Null
$rulesB = Join-Path $homeB 'hooks\command-guard\rules.json'
$edited = Get-Content -LiteralPath $rulesB -Raw -Encoding UTF8 | ConvertFrom-Json
$edited.rules[0].message = 'custom message'
[IO.File]::WriteAllText($rulesB, ($edited | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding $false))
$runB = Invoke-Interactive $homeB @('y', '{ENTER}', '{ENTER}', '{ENTER}')
$restoredB = (Get-Content -LiteralPath $rulesB -Raw -Encoding UTF8 | ConvertFrom-Json).rules[0].message
Assert $runB.Exited 'B: installer exits after confirmation'
Assert ($restoredB -ne 'custom message') 'B: custom rules.json replaced with new defaults'
Assert (@(Get-ChildItem -LiteralPath (Join-Path $homeB 'hooks\command-guard') -Filter 'rules.json.bak-*').Count -eq 1) 'B: old rules.json backed up'

# C: cancel at confirmation, nothing written
$homeC = New-TempHome
$runC = Invoke-Interactive $homeC @('{ENTER}', 'n', '{ENTER}')
Assert $runC.Exited 'C: installer exits after cancel'
Assert (-not (Test-Path -LiteralPath (Join-Path $homeC 'hooks'))) 'C: cancel writes nothing'

foreach ($home in $homeA, $homeB, $homeC) { Remove-Item -LiteralPath $home -Recurse -Force -ErrorAction SilentlyContinue }

if ($failures -gt 0) { Write-Output "$failures failure(s)"; exit 1 }
Write-Output 'all interactive cases passed'
exit 0
