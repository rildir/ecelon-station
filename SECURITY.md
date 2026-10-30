# Security policy

## Threat model (what Ecelon Station is, and is not)

Ecelon Station is a **single-user, local** tool. It starts a web server on `127.0.0.1` that can run
Claude Code agents, read and edit files in the project folders you added, and run commands you
approve. Treat it like your terminal:

- The server listens on **loopback only** and rejects requests whose `Host`, `Origin` or
  `Sec-Fetch-Site` do not match (protection against CSRF and DNS rebinding from web pages).
- There is **no login**. Any program running as *you* on the same machine can already do what the
  station can do, so it is not an extra boundary. **Do not run it on a shared machine, a terminal
  server, or behind a port forward / tunnel / reverse proxy** — whoever can reach the port can
  drive your agents.
- Files the file API and the Git panel touch are confined to the project folder (symlinks that
  point outside it are refused). Git calls run with fsmonitor, hooks and external diff disabled,
  so opening an untrusted repository does not execute code from its `.git/config`.
- Nothing is sent anywhere by the station itself: no telemetry, no update check, no remote assets.
  The only network traffic is Claude Code talking to Anthropic, plus `pip install markitdown`
  if *you* press the install button for the optional document reader.
- Data lives in `./data` (clone) or `~/.ecelon-station` (npm) with owner-only permissions. Documents
  and logs are git-ignored.
- "Full access" permission mode lets an agent run commands without asking. Only use it on projects
  you trust.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's
["Report a vulnerability"](../../security/advisories/new) (Security tab → Advisories) and include
steps to reproduce. I aim to answer within a few days and will credit you in the release notes
if you wish.

## Supported versions

Only the latest release receives fixes.
