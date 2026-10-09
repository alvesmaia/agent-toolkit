# command-guard

A GitHub Copilot CLI `preToolUse` hook that denies agent commands and file writes
before they run, when they match patterns that typically trigger endpoint
antivirus (for example, `irm ... | iex`, `-EncodedCommand`, `-ExecutionPolicy Bypass`).

It prevents false positives in the antivirus. It is not a security boundary:
a determined or obfuscated command can get past it.

## Install

```powershell
powershell -NoProfile -File copilot-hooks\command-guard\install.ps1
```

Installs to `$COPILOT_HOME\hooks` (default `%USERPROFILE%\.copilot\hooks`):

- `command-guard\guard.ps1`, `command-guard\rules.json`
- `command-guard.json` (hook config, only this file of yours is written)

Re-running is a no-op when nothing changed. If the config differs, the old one is
copied to `command-guard.json.bak-<timestamp>` first. If you edited `rules.json`, it is
kept and the latest defaults are written to `rules.default.json`. Restart Copilot CLI
to load the hook.

## Uninstall

```powershell
powershell -NoProfile -File copilot-hooks\command-guard\uninstall.ps1
```

Removes `command-guard.json` (only if it references `command-guard`) and moves
`command-guard\` to `$COPILOT_HOME\command-guard-removed-<timestamp>`, keeping
`guard.log` and your `rules.json`.

## What is checked

| Tool | Checked |
|---|---|
| `powershell` | the command text; any `.ps1`, `.bat`, `.cmd` run from it (`.\x.ps1`, `& x.ps1`, `call x.bat`, `powershell -File x.ps1`) and any `.py` run with `python x.py`. Script contents are checked with the same rules. |
| `apply_patch`, `create` | added lines (`apply_patch`) or `file_text` (`create`) of `.ps1`, `.psm1`, `.psd1`, `.py`, `.bat`, `.cmd` files, before the file is written. |
| anything else | allowed. |

Rules are in `rules.json`: `remote-exec`, `base64-exec`, `execution-policy`,
`encoded-command`, `defender-tamper`, `invoke-expression`, `scheduled-task`,
`alt-interpreter`, `obfuscation`, `python-exec`, `download-then-run`.

A denied call returns `{"permissionDecision":"deny","permissionDecisionReason":"..."}`
with the rule id, file and line, so the model can rewrite only that part.

## Editing rules

Each rule in `rules.json`:

- `id`, `message`: shown to the model on deny.
- `scope`: `line`, `command` (must start a command), `multiline`, `python-call`, `download-then-run`.
- `pattern`: .NET regex, case-insensitive.
- `carrier` (optional): the line must also match this regex.
- `enabled`: `false` turns the rule off.
- `exceptions`: regexes; a matching line is not reported. Use this for a known false
  positive instead of disabling the rule.

Comments are stripped before matching (full-line `#` and trailing ` #`).

## Limitations

- Regex, not a parser. Obfuscated or split commands (`'i'+'e'+'x'`, variables, `[char]`
  arithmetic) can pass. Backtick splitting is covered only for `iex`/`Invoke-Expression`.
- Script contents are read only one level deep: a script that downloads another script
  is not followed.
- A script run by its path must exist on disk when the hook runs. If it does not exist, or is
  larger than 1 MB, the run is denied as `uninspectable`.
- Multi-line Python calls are checked by the content patterns only, not by the `subprocess` context.
- A matching string in a comment or a `Write-Host` argument is denied unless it is in
  `exceptions`. Full-line comments and trailing comments are stripped.
- `ask` is not used: the Copilot CLI hook reference documents `deny` only, and this hook
  never returns anything else.
- Only `preToolUse` is used. Observed tools: `powershell`, `create`, `apply_patch`, `view`, `glob`. Other tools are allowed without checks.
- Matching is on the text of the tool call. The hook does not stop the process started
  by an allowed command.
- Hook crash denies every tool call. Keep `tests\run-tests.ps1` green after any edit to `guard.ps1`.
- The hook command passes `-ExecutionPolicy RemoteSigned` so a local `guard.ps1` runs under a
  `Restricted` user or machine policy. Verified with a `-ExecutionPolicy Restricted` host and no
  Group Policy keys. A policy set by Group Policy overrides the command-line flag and is untested.
- Internal errors in `guard.ps1` are logged to `guard.log` and allowed (fail-open).
  Only unreadable or missing scripts are denied.
- `guard.log` records every decision, including tool name and denied content (not allowed
  commands). Delete it when you do not need it.

## Contract (Copilot CLI hooks)

- Hooks are read from `$COPILOT_HOME\hooks\*.json`; `COPILOT_HOME` overrides the directory.
- Input on stdin: `toolName`, `toolArgs` (object for `powershell`, string patch for `apply_patch`), `cwd`.
- Deny: print the JSON above and exit 0. Allow: print nothing and exit 0.
- Crash or non-zero exit denies. Timeout allows.

References:
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference
- https://docs.github.com/copilot/reference/hooks-reference
- https://docs.github.com/en/copilot/tutorials/copilot-cli-hooks

## Tests

```powershell
powershell -NoProfile -File copilot-hooks\command-guard\tests\run-tests.ps1      # rule cases, 5.1 or pwsh 7
powershell -NoProfile -File copilot-hooks\command-guard\tests\install-tests.ps1   # install/uninstall in a temp COPILOT_HOME
powershell -NoProfile -File copilot-hooks\command-guard\tests\integration.ps1     # real Copilot CLI, temp COPILOT_HOME, needs `gh auth`
```

`run-tests.ps1` only passes strings to the guard; no test command is executed.
`integration.ps1` runs two harmless probes. The deny probe would only connect to
`127.0.0.1:9` if the guard failed.
