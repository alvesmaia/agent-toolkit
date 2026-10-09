# skills

Personal collection of [Claude Code](https://claude.com/claude-code) skills,
kept in one place so they can be versioned, reused across machines, and shared.

## What's a skill here

A skill is a self-contained directory under `skills/` with a `SKILL.md`
(frontmatter `name` + `description`, telling an agent *when* to use it) and
any scripts or reference files it needs. This is the same shape Claude Code
expects in `~/.claude/skills/`, so installing one is just copying or linking
its folder there.

## Skills

| Skill | What it's for |
|---|---|
| [`tasks-panel`](skills/tasks-panel/) | A clickable progress panel for a multi-task plan tracked in `TASKS.md`, so the user can see status without asking. |

## Hooks

Hooks are not skills and live outside `skills/`:

| Hook | What it does |
|---|---|
| [`command-guard`](copilot-hooks/command-guard/) | GitHub Copilot CLI `preToolUse` hook that denies commands and script writes matching patterns that trigger endpoint antivirus (`irm ... \| iex`, `-EncodedCommand`, `-ExecutionPolicy Bypass`, ...). Installs with a PowerShell script; see its README for limits. |

## Installing

### As a plugin (recommended)

This repo is also a self-hosted Claude Code plugin marketplace: it declares
itself as both the marketplace and the one plugin it offers
(`.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json`). From any
Claude Code session:

```
/plugin marketplace add alvesmaia/agent-toolkit
/plugin install alvesmaia@alvesmaia-skills
```

This installs every skill in `skills/` and keeps them updatable through the
plugin system — no manual copying, no path to keep in sync by hand. The
plugin's name (`alvesmaia`) is also what prefixes any slash command it
exposes, e.g. `/alvesmaia:<command>` instead of the repo's own name.

### Manually, one skill at a time

Copy (or symlink) the skill's directory into your skills folder:

```bash
cp -r skills/tasks-panel ~/.claude/skills/tasks-panel
# or, to keep it in sync with this repo:
ln -s "$(pwd)/skills/tasks-panel" ~/.claude/skills/tasks-panel
```

**Note the installed path of any script**: scripts live under
`scripts/` inside a skill's folder here, so a skill installed this way
ends up at `~/.claude/skills/<skill>/scripts/<script>.py`, not directly
at `~/.claude/skills/<skill>/<script>.py`. If you point a shortcut,
terminal profile, or alias at a skill's script directly, update it to
the `scripts/` path — and update it again if you re-install after this
layout changes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the conventions each skill in this
repo follows.

## License

MIT — see [LICENSE](LICENSE).
