---
name: show
description: Start the Tracks dev server and open the app in CodeHydra's Simple Browser, restarting whatever was already serving this worktree. Use when asked to show the app, open the UI, look at it in a browser, or see a change running — and on an explicit /show.
---

# show

Starts the dev server against the local database and opens the running app in the Simple
Browser beside the terminal.

It is a launcher and nothing else. It does not read the diff, summarise changes, drive the
app, or judge what it sees — you look, it just gets the window open.

Every invocation **restarts**: it kills whatever is serving this worktree first, so what you
end up looking at is always a server started after the current working tree. A server that
predates a config or dependency change looks healthy while serving stale code, which is the
failure mode worth spending two seconds of startup to rule out.

Run every command from the worktree root — step 2 uses `$PWD` as the worktree's identity.

---

## 1. Install if needed

```bash
[ -d node_modules ] || pnpm install
```

Foreground. Every fresh CodeHydra worktree starts without `node_modules`, so this fires once
per workspace and then never again — seconds against a warm pnpm store, longer against a cold
one.

## 2. Kill whatever is serving this worktree

```bash
for pid in $(ss -ltnpH | grep -oP 'pid=\K[0-9]+' | sort -u); do
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || continue
  case "$cwd" in "$PWD" | "$PWD"/*) ;; *) continue ;; esac
  tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q vite || continue
  kill -- "-$(ps -o pgid= -p "$pid" | tr -d ' ')"
done
```

The working directory is the identity. A task id would only find a server this session
started; `cwd` finds one left behind by a session that has since ended, which is the case
that actually strands a stray Vite.

Killing the **process group** rather than the pid matters: `ch bg` puts itself and the dev
server in a group of their own, so `kill -- -PGID` takes both and leaves the calling shell
untouched.

## 3. Start it

A Bash tool call with `run_in_background: true`:

```bash
ch bg pnpm dev:local
```

`dev:local` rather than `dev`: it points at `data/dev.db`, which needs no credentials and
cannot be written to by accident from a half-finished change. `pnpm dev` is the same server
against the deployed database, which is a poor place to try out a bulk tag write — use it
deliberately, not by default.

Both halves earn their place. `ch bg` keeps the workspace from being marked busy for as long
as the server runs. Backgrounding the *tool call* is what makes the harness hold it as a
task — which is the stop button (below) and which captures output to a
`tasks/<id>.output` file. **Note that path from the tool result**: it is the only log.

`pnpm dev` is `vite`, and `packages/web/vite.config.ts` mounts the real Hono app through
`@hono/vite-dev-server` — so this one process serves the API and the browser bundle on one
port, with HMR on both sides. Nothing else needs starting.

## 4. Wait for the URL

```bash
LOG=<the tasks/<id>.output path from step 3>
for _ in $(seq 120); do
  URL=$(sed 's/\x1b\[[0-9;]*m//g' "$LOG" 2>/dev/null | grep -oP 'Local:\s+\K\S+' | head -1)
  [ -n "$URL" ] && curl -sf -o /dev/null "$URL" && { echo "$URL"; exit 0; }
  sleep 0.25
done
echo "timed out after 30s"; exit 1
```

Vite chooses its own free port — starting at 5173 and incrementing — which is why sibling
workspaces never collide and why the port is never passed in. The consequence is that the
log is the only place the URL exists, so it is read rather than constructed.

The `curl` is not redundant with the `Local:` line: Vite prints the URL when it binds, a
moment before it will actually answer.

## 5. Open it

```bash
ch ws browser "$URL"
```

Unconditionally, every time. Simple Browser has no scriptable reload, so re-opening the URL
is the only way a restarted server gets a fresh page instead of a dead one.

## 6. Report

One line: the URL. Nothing else — the app is on screen, and the point is to look at it.

---

## When it fails

Do not open the browser. `tail -30 "$LOG"`, report what it says, stop. A Simple Browser tab
showing a connection error is worse than a message, because it looks like a bug in the app.

## Stopping

There is no `/show stop`. The dev server dies with its background task, so stopping it is
`/tasks` in the terminal, or a `TaskStop` on that task id. Otherwise it lives until the
workspace closes, which is the intended behaviour — `ch bg` exists so it can.

## Fill the database first

A fresh worktree has no `data/`, and the server no longer invents one — it says which
variable is missing and stops, rather than coming up serving an empty database that looks
like a bug in the app.

```bash
pnpm db:seed
```

Sixty generated activities across three years, five places and three sports, deterministic
so the same command gives the same map. `pnpm db:pull` is the other filling: real
activities older than a cutoff, copied down from the deployed database, which needs
`.env`. Sign in with any password — the seeded account has none, and the first one typed
becomes it.

## Expect one failed task per restart

Killing the previous server's process group makes the harness report that task as *failed,
exit 143*. Cosmetic, and expected on every restart after the first.
