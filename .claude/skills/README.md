# Skill directories — what's here and why

**engineering review P1-6 note:** this project previously had THREE copies of
the /teach skill (`.claude/skills/teach/`, `.claude/skills/qudrat-teach/`, and
`.agents/skills/teach/`), with no indication of which was authoritative.
`.agents/skills/teach/` was confirmed near-byte-identical to
`.claude/skills/teach/` (the only diff was a trailing separator line) and has
been removed as pure duplication.

## `teach/`
The generic, unmodified `/teach` skill as installed from
`mattpocock/skills` (tracked in `../../skills-lock.json`). This is the base
methodology — do not edit it directly; it's meant to stay in sync with the
upstream source.

## `qudrat-teach/`
The actual, customized skill used to produce this project's Phase 0 learning
session (the lessons under `../../lessons/`, the learning records under
`../../learning-records/`, and `../../MISSION.md` / `../../GLOSSARY.md` /
`../../RESOURCES.md`) — specialized for the Qudrat exam in Arabic. **This is
the one that was actually invoked.** If the /teach methodology needs
Qudrat-specific adjustments going forward, edit this copy, not `teach/`.
