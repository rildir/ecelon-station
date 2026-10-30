# Contributing

Thanks for taking a look. Ecelon Station is a small, dependency-light codebase — plain ES modules,
no build step — so most changes are quick to make and to test.

## Run it locally

```
git clone https://github.com/rildir/ecelon-station
cd ecelon-station
npm install
npm run demo      # fake agents + three sample projects, no Claude Code needed
npm start         # real mode (needs Claude Code: `claude --version`)
npm run dev       # real mode, restarts the server when server files change
```

The browser reloads itself when a file under `public/` changes.

## Before you open a pull request

```
npm test          # unit tests + a demo-mode smoke test (~20 s)
npm run lint      # i18n consistency: every t() key translated, no untranslated text left in code
```

- **Strings:** English is the source language; wrap user-facing text in `t("…")` and add the Turkish
  line to `public/i18n/tr.json`. Details in [docs/i18n.md](docs/i18n.md).
- **No frameworks, no bundler.** The front end is vanilla JS modules + three.js + Monaco; keep it that way.
- **Privacy is a feature.** The server listens on 127.0.0.1 only, rejects cross-site requests, and
  nothing is sent anywhere except by Claude Code itself. Don't add telemetry or remote calls.
- **Data files under `data/` and `logs/` are the user's.** Never commit them, never write them from tests
  (tests use a temporary `ECELON_DATA`).
- Keep diffs focused; a PR that does one thing is easy to review and merge.

## Where things are

| Path | What |
|---|---|
| `server/index.js` | Express + WebSocket app, agent runs, team delegation, MCP tool handling |
| `server/runner.js` | spawns `claude -p` and parses its stream-json output |
| `server/team-mcp.js` | the stdio MCP server that gives agents the team tools |
| `server/roles.js` | roles (developer, analyst, tester, reviewer): prompts and tool permissions |
| `server/requirements.js`, `server/coverage.js` | requirements, verification, document coverage |
| `server/mockRunner.js` | demo mode: scripted fake runs |
| `public/app.js` | the main UI; `scene.js` the 3D office; `reqs.js`, `library.js`, `gitui.js`, `editor.js`, `runui.js` the panels |
| `demo/` | sample projects and document used by `--demo` |

## Reporting bugs

Open an issue with what you did, what you expected, what happened, your OS, Node version and
`claude --version`. Attach `data/server.log` if the server misbehaved — but check it for anything
private first.

## Branches, commits and releases

- **`main`** is always releasable and protected: changes arrive only through pull requests, CI must be green, no force-pushes.
- Work happens on short-lived branches cut from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>`, `refactor/<topic>`, `test/<topic>`.
- Pull requests are **squash-merged**; the PR title becomes the commit message, so write it as a
  [Conventional Commit](https://www.conventionalcommits.org/): `feat: add a Spanish translation`, `fix(scope): keep the hand-off button enabled`.
- Releases are tags on `main` named `vMAJOR.MINOR.PATCH` (semver), with a GitHub Release and an entry in [CHANGELOG.md](CHANGELOG.md).
- Never commit `data/`, `logs/`, documents, keys or screenshots of real projects (the `.gitignore` already excludes them).
