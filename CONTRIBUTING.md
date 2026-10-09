# Contributing

Conventions for skills in this repository.

## Layout

```
skills/<skill-name>/
  SKILL.md       # required
  scripts/       # executables the skill invokes, if any
  <other refs>   # heavy reference material, only if needed
```

One directory per skill, flat namespace, `kebab-case` names. Use a
gerund (`writing-x`, `reviewing-x`) when the skill names a process;
a plain noun phrase when it's a tool or reference.

Hooks (non-skill automation) go under `copilot-hooks/<name>/`, with their own
`README.md`, install/uninstall scripts and `tests/`. They are not skills and have
no `SKILL.md`.

## `SKILL.md`

- YAML frontmatter with `name` and `description`, nothing else required.
- `description` is written for the *decision to activate the skill*, not
  as a summary of what it does. Start with "Use when…" and list concrete
  triggers/symptoms — not the skill's internal steps.
- Written in English, so it's usable outside a single team or locale.
- Keep the skill itself readable: move long templates or heavy reference
  material to separate files instead of inlining them.

## Portability

- No absolute paths, usernames, or machine-specific data.
- Logic that decides behavior (e.g. "is this a status section?") should be
  **structural**, not keyed to words in one language — a check like
  "title starts with an icon" works everywhere; a check against a list of
  English or Portuguese words does not.
- Pin dependency versions for anything with an unstable API (e.g. a PEP 723
  header pinning a library's exact version). A skill that breaks itself on
  the next `uv` run isn't reusable.

## Before adding a skill

- Prefer `skill-creator` / `superpowers:writing-skills` if available — they
  hold the canonical, tested conventions this file summarizes.
- A single skill doesn't need `tests/` or an index skill. Once this repo
  has more than one, add both: a `tests/` per skill (or shared harness) so a
  skill can't rot silently, and a small index skill that points to the
  others.
