$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logPath = Join-Path $scriptDir 'guard.log'
$maxFileBytes = 1MB
$ic = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
$utf8 = New-Object System.Text.UTF8Encoding $false

function Write-Log([string]$message) {
    try {
        Add-Content -LiteralPath $logPath -Value ((Get-Date -Format 's') + ' ' + $message) -Encoding UTF8
    } catch { }
}

function New-RuleSet([string]$rulesFile) {
    $config = Get-Content -LiteralPath $rulesFile -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($rule in $config.rules) {
        if (-not $rule.enabled) { continue }
        $pattern = [string]$rule.pattern
        if ($rule.scope -eq 'command') {
            $pattern = '(?:^|[;|&(]|\s-c(?:ommand)?\s+["'']?)\s*(?:' + $pattern + ')'
        }
        $carrier = $null
        if ($rule.carrier) { $carrier = New-Object System.Text.RegularExpressions.Regex([string]$rule.carrier, $ic) }
        $outfile = $null
        if ($rule.outfile) { $outfile = New-Object System.Text.RegularExpressions.Regex([string]$rule.outfile, $ic) }
        $exceptions = @()
        foreach ($e in @($rule.exceptions)) {
            if ($e) { $exceptions += New-Object System.Text.RegularExpressions.Regex([string]$e, $ic) }
        }
        [pscustomobject]@{
            Id = [string]$rule.id
            Scope = [string]$rule.scope
            Message = [string]$rule.message
            Regex = New-Object System.Text.RegularExpressions.Regex($pattern, $ic)
            Carrier = $carrier
            Outfile = $outfile
            ExecExtensions = @($rule.execExtensions)
            Exceptions = $exceptions
        }
    }
}

function Remove-Comments([string]$text) {
    $kept = foreach ($line in ($text -split "`n")) {
        if ($line -match '^\s*#') { continue }
        $line -replace '\s#.*$', ''
    }
    $kept -join "`n"
}

function Test-Excepted($rule, [string]$line) {
    foreach ($e in $rule.Exceptions) {
        if ($e.IsMatch($line)) { return $true }
    }
    return $false
}

function New-Hit($rule, [string]$source, [int]$lineNo, [string]$snippet) {
    $snip = ($snippet -replace '\s+', ' ').Trim()
    if ($snip.Length -gt 160) { $snip = $snip.Substring(0, 160) + '...' }
    [pscustomobject]@{ Id = $rule.Id; Message = $rule.Message; Source = $source; Line = $lineNo; Snippet = $snip }
}

function Test-LineRules([string]$line, $lineRules) {
    foreach ($rule in $lineRules) {
        if ($rule.Carrier -and -not $rule.Carrier.IsMatch($line)) { continue }
        if (-not $rule.Regex.IsMatch($line)) { continue }
        if (Test-Excepted $rule $line) { continue }
        return $true
    }
    return $false
}

function Get-Violations([string]$text, [string]$source, $rules) {
    $clean = Remove-Comments $text
    $lines = @($clean -split "`n")
    $lineRules = @($rules | Where-Object { $_.Scope -eq 'line' -or $_.Scope -eq 'command' })
    $found = New-Object System.Collections.ArrayList

    foreach ($rule in $rules) {
        if ($rule.Scope -eq 'multiline') {
            foreach ($m in $rule.Regex.Matches($clean)) {
                $lineNo = $clean.Substring(0, $m.Index).Split("`n").Count
                if (Test-Excepted $rule $lines[$lineNo - 1]) { continue }
                [void]$found.Add((New-Hit $rule $source $lineNo $m.Value))
            }
            continue
        }

        for ($i = 0; $i -lt $lines.Count; $i++) {
            $line = $lines[$i]

            if ($rule.Scope -eq 'download-then-run') {
                if (-not $rule.Regex.IsMatch($line)) { continue }
                foreach ($om in $rule.Outfile.Matches($line)) {
                    $leaf = ($om.Groups[1].Value -split '[\\/]')[-1]
                    $ext = [IO.Path]::GetExtension($leaf).ToLowerInvariant()
                    if ($rule.ExecExtensions -notcontains $ext) { continue }
                    $withoutUrls = [regex]::Replace($clean, 'https?://\S+', '')
                    $occurrences = [regex]::Matches($withoutUrls, [regex]::Escape($leaf), $ic).Count
                    if ($occurrences -ge 2) { [void]$found.Add((New-Hit $rule $source ($i + 1) $line)) }
                }
                continue
            }

            if ($rule.Scope -eq 'python-call') {
                if (-not $rule.Regex.IsMatch($line)) { continue }
                $carrierHit = $rule.Carrier -and $rule.Carrier.IsMatch($line)
                if (-not $carrierHit -and -not (Test-LineRules $line $lineRules)) { continue }
                if (Test-Excepted $rule $line) { continue }
                [void]$found.Add((New-Hit $rule $source ($i + 1) $line))
                continue
            }

            if ($rule.Carrier -and -not $rule.Carrier.IsMatch($line)) { continue }
            $m = $rule.Regex.Match($line)
            if (-not $m.Success) { continue }
            if (Test-Excepted $rule $line) { continue }
            [void]$found.Add((New-Hit $rule $source ($i + 1) $line))
        }
    }
    return $found
}

function Format-Reason($hit) {
    "[command-guard] $($hit.Id): $($hit.Message) [$($hit.Source), line $($hit.Line)] Matched: $($hit.Snippet)"
}

function Get-ScriptRefs([string]$command) {
    $refs = New-Object System.Collections.ArrayList
    $path = '[^\s"'';|&()]+'
    $patterns = @(
        @{ Kind = 'script'; Regex = '(?:^|[;|&(]\s*)(?:[&.]\s+)?"?(' + $path + '\.(?:ps1|bat|cmd))"?(?=$|[\s;|)])' },
        @{ Kind = 'script'; Regex = '(?:^|\s)"?(\.[\\/]' + $path + '\.(?:ps1|bat|cmd))"?(?=$|[\s;|)])' },
        @{ Kind = 'script'; Regex = '\s-File\s+"?(' + $path + '\.ps1)"?(?=$|[\s;|)])' },
        @{ Kind = 'script'; Regex = '(?:^|[;|&(]\s*)(?:call\s+|cmd(?:\.exe)?\s+/c\s+)"?(' + $path + '\.(?:bat|cmd))"?(?=$|[\s;|)])' },
        @{ Kind = 'script'; Regex = '(?:^|[;|&(]\s*|\s)(?:python(?:3)?(?:\.exe)?|py)\s+(?:-\S+\s+)*"?(' + $path + '\.py)"?(?=$|[\s;|)])' }
    )
    foreach ($p in $patterns) {
        foreach ($m in [regex]::Matches($command, $p.Regex, $ic)) {
            [void]$refs.Add([pscustomobject]@{ Path = $m.Groups[1].Value })
        }
    }
    return $refs
}

function Get-PatchText($toolArgs) {
    if ($toolArgs -is [string]) { return $toolArgs }
    foreach ($name in 'patch', 'input') {
        if ($toolArgs.PSObject.Properties[$name]) { return [string]$toolArgs.$name }
    }
    return ''
}

function Get-PatchFiles([string]$patch) {
    $files = New-Object System.Collections.ArrayList
    $current = $null
    foreach ($line in ($patch -split '\r?\n')) {
        if ($line -match '^\*\*\* (?:Add|Update) File: (.+)$') {
            $current = [pscustomobject]@{ Path = $Matches[1].Trim(); Lines = New-Object System.Collections.ArrayList }
            [void]$files.Add($current)
            continue
        }
        if ($line.StartsWith('*** ')) { $current = $null; continue }
        if ($current -and $line.StartsWith('+')) { [void]$current.Lines.Add($line.Substring(1)) }
    }
    return $files
}

function Get-Decision($event, $rules) {
    $cwd = [string]$event.cwd
    if (-not $cwd) { $cwd = (Get-Location).Path }

    switch ([string]$event.toolName) {
        'powershell' {
            $command = [string]$event.toolArgs.command
            $hits = @(Get-Violations $command 'command' $rules)
            if ($hits.Count -gt 0) { return Format-Reason $hits[0] }

            foreach ($ref in @(Get-ScriptRefs $command)) {
                $full = $ref.Path
                if (-not [IO.Path]::IsPathRooted($full)) { $full = Join-Path $cwd $full }
                $full = [IO.Path]::GetFullPath($full)
                if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
                    return "[command-guard] uninspectable: '$($ref.Path)' was not found in '$cwd', so its content cannot be checked. Write it to disk first or run its contents directly."
                }
                if ((Get-Item -LiteralPath $full).Length -gt $maxFileBytes) {
                    return "[command-guard] uninspectable: '$full' is larger than 1 MB, so its content cannot be checked."
                }
                $content = [IO.File]::ReadAllText($full, $utf8)
                $fileHits = @(Get-Violations $content $full $rules)
                if ($fileHits.Count -gt 0) { return Format-Reason $fileHits[0] }
            }
        }
        'create' {
            $path = [string]$event.toolArgs.path
            $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
            if (@('.ps1', '.psm1', '.psd1', '.py', '.bat', '.cmd') -contains $ext) {
                $hits = @(Get-Violations ([string]$event.toolArgs.file_text) $path $rules)
                if ($hits.Count -gt 0) { return Format-Reason $hits[0] }
            }
        }
        'apply_patch' {
            $patch = Get-PatchText $event.toolArgs
            foreach ($file in @(Get-PatchFiles $patch)) {
                $ext = [IO.Path]::GetExtension($file.Path).ToLowerInvariant()
                if (@('.ps1', '.psm1', '.psd1', '.py', '.bat', '.cmd') -notcontains $ext) { continue }
                $content = $file.Lines -join "`n"
                $hits = @(Get-Violations $content $file.Path $rules)
                if ($hits.Count -gt 0) { return Format-Reason $hits[0] }
            }
        }
    }
    return $null
}

try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
    $event = $raw | ConvertFrom-Json
    $rules = New-RuleSet (Join-Path $scriptDir 'rules.json')
    $reason = Get-Decision $event $rules
    if ($reason) {
        Write-Log "DENY tool=$($event.toolName) $reason"
        [Console]::Out.WriteLine((([ordered]@{ permissionDecision = 'deny'; permissionDecisionReason = $reason }) | ConvertTo-Json -Compress))
    } else {
        Write-Log "ALLOW tool=$($event.toolName)"
    }
} catch {
    Write-Log "ERROR $($_.Exception.Message)"
}
exit 0
