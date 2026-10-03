# Blueprint: an e2e lock for parallel workers

Give this file to a coding agent and ask it to build the lock for your machine, in whatever language you prefer.

## Problem

`/run-cards` runs several workers at once, each in its own git worktree. Their end-to-end tests usually start a dev server on one fixed port and may share a test database, so two runs at once break each other, often silently: a spec runs against another worktree's server. The workers need to take turns.

## Contract (the skills rely on this)

- A command named **`e2e-slot`** on the `PATH`: `e2e-slot <command> [args…]`.
- It runs `<command>` while holding the machine's **one** e2e slot, and releases the slot when the command ends.
- If the slot is taken, it **waits** and prints a short line now and then (who holds it, for how long).
- If it waits longer than a cap (default 20 minutes, overridable with an env var), it gives up with **exit code 75**.
- Otherwise it exits with the command's own exit code (128 + signal if it was killed).

## Design points

1. **Atomic acquire.** Use an operation that is atomic on every filesystem, e.g. creating a directory (`mkdir` fails if it exists). Don't use "check if a file exists, then create it": two workers can both pass the check.
2. **Owner record.** Inside the lock, write who holds it: pid, working directory, command, start time. Waiters print it, and it makes stale locks detectable.
3. **Stale locks.** A crashed holder leaves the lock behind. Treat the lock as free when its pid is dead, or alive but no longer an `e2e-slot` process (pids get reused). Give a just-created lock a short grace period (e.g. 30 s) before judging it, because the owner record is written right after the directory.
4. **Release on every exit path**: normal exit, command not found, and SIGINT/SIGTERM/SIGHUP. Forward the signal to the child first, then release. Only remove the lock if it is still yours (the owner pid matches).
5. **Location.** A user-level directory such as `~/.cache/e2e-slot`, overridable with an env var, so every worktree on the machine shares it.
6. **Inherit stdio**, so test output looks the same as running the command directly.

## Tests the agent should write

- Two concurrent runs: the second starts only after the first ends.
- The wait cap: a held lock makes the second run exit 75 after the cap (use a tiny cap in the test).
- A stale lock (dead pid, or a live pid that isn't `e2e-slot`) is taken over.
- The exit code is passed through; a killed child gives 128 + signal; the lock is gone afterwards.
- A missing command releases the lock and exits 127.

## Done when

`e2e-slot <your e2e command> <one spec>` works from two worktrees at once, and the second one visibly waits for the first.
