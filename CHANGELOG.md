# Changelog

## Unreleased

- Task board: agents leave a task for another role (or for you) instead of stopping at "I cannot do that"; start it with one click, track it in To do / In progress / Blocked / Done.
- Chat: team status strip, pinned last prompt; editor font zoom (Ctrl + wheel).
- Fixes: queued messages could get stuck after the agent finished; server restarts no longer silently cut agents off; notification panel overflow.

## 0.1.0 — first public release

- Isometric station: every project folder is a room, every role (developer, analyst, tester, reviewer) a character.
- Team workflow with hand-offs; only the developer writes files.
- Scope: requirements extracted from linked analysis documents, compared with code, verified by the tester with real evidence.
- Document coverage: every paragraph / item / row / heading / image tracked; "contains no requirement" needs your approval.
- Git checkpoints, change cards with diffs and one-click undo.
- Document library with version history, search, optional MarkItDown reader.
- English and Turkish UI.
- `npm run demo`: scripted demo agents on three sample projects, no Claude Code required.
