# DeepSeek Harness Super Memory

English | [中文](README.zh.md)

[![Cross-platform Harness verification](https://github.com/Missher12/dsh-missher-memory/actions/workflows/cross-platform.yml/badge.svg)](https://github.com/Missher12/dsh-missher-memory/actions/workflows/cross-platform.yml)

`dsh-missher-memory` is an independently installable DeepSeek Harness bundle for recovering architecture, decisions, progress, failed approaches, and next steps in long-running projects. It neither changes Harness core nor copies or modifies the existing `vectors.db`.

## Platform support

The bundle is pure JavaScript and uses only Node built-ins at runtime, so the same `.tgz` installs on every verified target. The repository's required matrix runs the complete unit, type, build, package-safety, real CLI install/uninstall, and synthetic database lifecycle checks on macOS Intel, macOS Apple Silicon, Windows x64, and Linux x64. It is pinned to DeepSeek Harness Desktop 0.3.5 / Harness 0.1.1-rc.2 for reproducibility.

Windows ARM and Linux ARM are not claimed until stable native runners and a shipped Harness target are available. There is no platform-specific database payload or native addon inside the package.

## How it works

- `memory_search` searches external memory and reviewed plugin memory only through the active session's confirmed project binding, with source, time, and a stable reference on each result.
- cwd creates an in-memory binding candidate only. Durable state keeps an irreversible project key, basename, short hash, and encrypted external session identifiers; it never stores an absolute cwd.
- Project memory and personal preferences use separate scopes. Project search cannot read another project, and personal search does not read the external project database.
- Candidate capture defaults off. Session disposal may create review candidates only after the user binds the project and explicitly enables capture.
- Automatic recall defaults off independently. When enabled, it injects reviewed memory only for top-level user turns, with at most 5 results and 6000 bytes plus source, time, and an untrusted-history warning.
- Missing, damaged, unsafe, or timed-out databases return stable states and fail open without blocking Harness startup or a session.

## Install

The plugin requires a DeepSeek Harness 0.1.x Host with Node `^22.19.0` or `>=24`. The delivered tarball needs no Python, shell script, or native dependency build:

```sh
dsh plugin --profile web add /absolute/path/dsh-missher-memory-0.1.0.tgz
dsh --profile web --dump-config
```

The bundle patch is active when the configuration contains both `dsh-missher-memory` and `missher-memory`. Restart Harness and finish the first binding in Settings → Super Memory.

If the external database is not at `$HOME/.local/share/missher-memory/tencentdb/vectors.db`, set `MISSHER_TENCENTDB_DIR` to the existing absolute directory that contains `vectors.db` before starting Harness. The plugin never creates a missing directory or empty database and rejects links and escaping paths.

## First binding

1. Open a top-level session in the target project so Settings shows its basename and short-hash candidate.
2. Review the source list, which contains record counts and time ranges but no record text, and select only sources that belong to the project.
3. Confirm a new binding or link another worktree candidate to an existing project.
4. Enable candidate capture or automatic recall separately if needed. Both remain off by default.

The legacy database has no trustworthy project id. The plugin never classifies sources from cwd, text similarity, or time. A wrong source choice assigns history to the wrong project, so the first binding requires human review.

## Search

The model or user can explicitly call:

```text
memory_search({ query: "packaged smoke", scope: "project", limit: 5 })
```

`scope` is `project` or `personal`. The query is interpreted as literal text rather than FTS operators, and results are bounded by count and UTF-8 bytes. Search never creates `state.db` and never triggers candidate capture.

## Candidate review and recall

After capture is enabled, the plugin buffers only direct user and assistant text from top-level sessions; it ignores tool output, plugin injections, and delegated sessions. If any message matches a credential, private key, connection string, identity number, financial number, or sensitive user path, the entire session produces no candidate.

Settings lets the user edit, merge, approve, pin, or forget candidates. Only approved memories can be searched or recalled; pinning changes order only. Project deletion removes that project's bindings, settings, candidates, project memory, and personal memory derived from its candidates without touching the external database.

Automatic recall uses only reviewed content and explicitly bound external sources. It has an independent switch, result limit, and byte budget. Errors, timeout, or invalid state inject nothing.

## Data and uninstall

Plugin-owned state lives under `$DSH_HOME/missher-memory/`, primarily in permission-restricted `state.db` and a local key. Candidate and approved text remain readable in `state.db`; project aliases are irreversible digests and external session identifiers are encrypted with the local key. `DATA-RETENTION.md` defines the complete retention rules and `SECURITY.md` defines the threat model.

Export or delete projects in Settings as needed, then uninstall:

```sh
dsh plugin --profile web remove dsh-missher-memory
dsh --profile web --dump-config
```

Uninstall removes the bundle and profile patch but preserves `$DSH_HOME/missher-memory/` by default for reinstall recovery. After confirming backups and retention requirements, the user may delete that exact directory. Do not delete or move the external `vectors.db`.

## Status reference

- `not configured`: the target directory or `vectors.db` is absent; the plugin does not create it.
- `unsafe path`: the directory, database, or plugin state is a link, a non-regular file, or fails containment checks.
- `incompatible`: the external tables, FTS5 schema, or plugin state schema is unsupported.
- `corrupt`: SQLite cannot validate the database read-only.
- `timeout`: the Worker was terminated and will be rebuilt for the next search.

Before distribution, run:

```sh
node scripts/verify-package.mjs dist/dsh-missher-memory-0.1.0.tgz
node scripts/native-smoke.mjs --archive dist/dsh-missher-memory-0.1.0.tgz
```

`native-smoke.mjs` uses synthetic data only. Passing `--cli /absolute/path/to/dsh-cli.js` additionally installs, composes, and removes the tarball in a temporary profile.
