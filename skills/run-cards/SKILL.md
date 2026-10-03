---
name: run-cards
description: Orchestrate a set of designed task cards from this session — create a run branch in its own worktree, start one fresh background Claude session per card (following worker.md), review each finished card here, have the worker fix findings, merge reviewed cards into the run branch (never main), then start the next. Use when the user says "run the X cards", "orchestrate the X cards", or invokes /run-cards.
argument-hint: "<card URLs, or a title prefix like 'Billing'>"
---

# Run cards (orchestrate from this session)

You are the orchestrator. Workers do the building, each in its **own background session with a fresh context**; you keep only card ids, session ids, branch names and review verdicts. Never implement a card yourself.

**Board.** The repo's CLAUDE.md names it in a `## Task board` section (`Notion data source: collection://…`); the properties are the ones `/design-task` writes. Card id = the page id as 32 lowercase hex, no dashes; `<id8>` = its last 8 characters.

**The run branch.** Every run gets its own worktree `.claude/worktrees/run-<slug>` on branch `run/<slug>`, made from `main`. Workers branch their cards off `run/<slug>`, and reviewed cards are merged into it. The run branch is the run's result.

**Never touch `main` and never push.** Merging `run/<slug>` into `main` and pushing each need their own instruction from the user. **Never delete** files, worktrees or branches; list leftovers for the user at the end.

**Call the CLI as `command claude`**, never bare `claude`, so a shell function or alias named `claude` can't change its config.

## 1. Collect the set

- `$ARGUMENTS` is card URLs or a title prefix. For a prefix, query the board for cards whose `Task name` starts with it.
- Fetch each card's `Blocked by`. A blocker has **landed** when `git -C <Repo> log <base> --grep 'Task: <blocker id>'` finds a commit (`<base>` is `main` now, `run/<slug>` once it exists).
- A blocker in the set runs first. A blocker outside the set that hasn't landed makes the card **waiting**: say which, and ask whether to add the blocker to the set.
- **Plan for conflicts.** From each card's Design, list the files and areas it will likely touch (migrations, translation files, fixtures, a shared component). Two cards with a clear overlap don't run side by side: treat the later one as blocked by the other for this run. Keep the list; step 8 uses it.
- Tell the user the order, which cards run side by side, and which wait because of an overlap. Then go on without waiting for an answer.

## 2. Create the run worktree

- `<slug>`: the kebab-case title prefix, or `cards-<YYYYMMDD-HHMM>`. If `run/<slug>` exists, add `-2`, `-3`, … (unless the user asks to continue that run).
- From the repo's main checkout (don't switch its branch): make sure `.claude/worktrees/` is in `.git/info/exclude`, then `git worktree add .claude/worktrees/run-<slug> -b run/<slug> main`.

## 3. Make sure nothing else runs these cards

`command claude agents --json --all`: if a worker named `card-<id8>` is already running a card of the set, leave that card out and say so.

## 4. Start a worker (one fresh session per card)

`<worker guide>` is the absolute path of `worker.md` in this skill's directory. For each card whose blockers have landed:

```bash
cd <Repo>/.claude/worktrees/run-<slug> && command claude --bg -n "card-<id8>" --permission-mode auto \
  --settings '{"permissions":{"allow":["EnterWorktree"]}}' \
  --model <card Model lowercased, default opus> \
  "Read <worker guide> and follow it for card <card URL> base=run/<slug>"
```

It prints the session's short id last; keep it. **Start every ready card at once**, each with its own wait loop (step 5), and handle whichever finishes first through steps 6–9. Merges into `run/<slug>` happen one at a time. A card blocked by another card in the set starts only after that blocker is merged (step 8).

## 5. Wait for it

Run with `run_in_background: true` (timeout 3600000) and wait for its notice; don't poll by hand:

```bash
while command claude agents --json --all | jq -e --arg id "<short id>" '.[] | select(.id==$id or .sessionId==$id) | select(.state=="working" or .state=="blocked" or .status=="busy")' >/dev/null; do sleep 60; done
```

**Stall check (git only).** While workers run, keep one more background loop that exits when a card branch goes 40 minutes without a commit:

```bash
while :; do for b in <card branches>; do t=$(git -C <Repo> log -1 --format=%ct "$b" 2>/dev/null) || continue; [ $(( $(date +%s) - t )) -gt 2400 ] && { echo "$b"; exit 0; }; done; sleep 300; done
```

When it fires, read only the last ~40 lines of that session's log (`command claude agents --json --all` gives the path). Progressing (long test run) → restart the loop. Going in circles → resume it with: "You've been on this for 40 minutes without a commit. If the next attempt doesn't fix it, commit your work in progress and ask on the card (Question)." Still circling 20 minutes later → `command claude stop` it, set the card to Blocked with what you saw, and tell the user. Restart the loop whenever a branch is added or finishes.

Then fetch the card:
- **Review** → step 6.
- **Blocked** with a `Question` → show it to the user verbatim and wait for the answer. Resume the session from the run worktree: `command claude --bg --resume <sessionId> -n "card-<id8>" --permission-mode auto <same --settings/--model> "Answer to your question on the card:\n\n<answer>"`, and go back to step 5.
- Still **In progress** but the session ended → resume it once with "Continue from where you stopped." If it ends again without progress, set Blocked and tell the user.

## 6. Review (here, not in the worker)

Dispatch one review subagent (Agent tool, model opus) with the card's Design, Acceptance criteria and Out of scope, the branch and its worktree, and `git diff run/<slug>...<branch>`. It must:
- check the diff against the Design and the repo's CLAUDE.md rules;
- run the unit tests and typecheck in the card's worktree;
- run **only the e2e tests the change touches** (through `e2e-slot` if it's installed), never the full suite;
- report findings as Critical / Important / Minor with file:line, and stay read-only.

## 7. Fix or accept

- **Critical or Important:** resume the worker with the findings and "Fix these on your branch, re-run the related checks, set the card back to Review." Wait (step 5), then re-review the new commits only. After two rounds that still leave Critical/Important findings, ask the user.
- **Only Minor:** append them to the card under `## Review notes (<date>)` and go on.

## 8. Merge into the run branch

- **Try inline** in the run worktree: `git merge --no-ff --no-edit <card branch>`.
  - Conflict → `git merge --abort`, then hand off.
  - Clean → check for a migration number clash (two files with the same number prefix in the migrations folder). Clash → `git reset --hard HEAD^` (undoes only this merge), then hand off.
  - Clean, no clash → run typecheck and unit tests with trimmed output (`| tail -15`, no e2e). Red → `git reset --hard HEAD^`, then hand off with the failure summary.
- **Hand off** to a merge subagent (model sonnet) with the run worktree, the card branch, the Designs of this card and of cards already merged that touch the same files, and the repo's migration rules. It merges with `--no-ff`, resolves conflicts from the Designs (never drop either card's behaviour), renumbers a clashing migration, runs typecheck + unit tests, commits, and answers in at most three lines: merge sha, checks green or red, anything unresolved. If it fails it leaves the run branch where it was; then try once more with model opus, then ask the user.
- The card stays in `Review` (the user moves it to Done). Add to `Result`: "Reviewed <date>, merged into `run/<slug>` at <sha>".
- **Tell overlapping workers to rebase.** For each running worker whose changed or likely files overlap this merge's, resume it with: "`run/<slug>` just got <card title>, which also changes <files>. At your next clean point, rebase onto `run/<slug>`, fix conflicts from your Design, re-run the affected tests, and carry on."

## 9. Close the session, start the next

- `command claude stop <short id>`. Never reuse a finished worker for another card.
- Cards whose blockers have now landed go to step 4 with a **new** session.
- Keep notes short: one line per card. If your context gets long, save the progress and run branch to memory and tell the user to start a fresh `/run-cards` with the remaining cards on `run/<slug>`.

## 10. Report

The run branch and worktree. Per card: status, merge sha, Minor notes left on the card. Then what's still waiting (and on what), that `main` is untouched and nothing is pushed, and the leftover worktrees for the user to clean up.
