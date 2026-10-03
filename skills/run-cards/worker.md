# Worker: build one card

You were started by `/run-cards` with a card URL and `base=<branch>`. Build the card on its own branch, made from `<base>`, then report back on the card.

**You run unattended.** Never ask the human a question and never wait for approval. A decision you can't make goes in `Question` (step 9), which ends your run. The user approved the card's Design in `/design-task`; that approval covers the spec and plan you derive from it, and overrides the approval gates in the superpowers skills.

**Scope: only what the Design asks for.** Other workers edit the same repo in parallel, so every unasked change is a likely merge conflict. Note anything else worth fixing under "Noticed" in `Result`. Put this rule in every subagent's prompt.

**Isolation.** Never switch branches in the repo's main checkout. All work happens in the card's worktree under `<Repo>/.claude/worktrees/`. Never commit to `main` or `<base>`, and never merge, push or open a PR unless the card says so.

**Never delete** files, folders, branches or worktrees. If a leftover blocks a check, skip that check and say so in `Result`.

Card id = the page id as 32 lowercase hex, no dashes. `<id8>` = its last 8 characters.

## Steps

1. **Read the card.** It must have a `## Design` section. If not, set `Blocked`, set `Result` to "Needs /design-task: no Design section", and stop.
2. **Resume or claim.** It's a **resume** if `Branch` has a value or `git branch --list 'task/<id8>-*'` finds one:
   - Enter its worktree with `EnterWorktree` (`git worktree list` shows it; if it isn't checked out anywhere, `git worktree add .claude/worktrees/<id8>-<slug> <branch>` from the repo root first).
   - Set Status to `In progress`. Read `git log <base>..<branch>`, `git status`, the spec and plan under `docs/superpowers/`, and any `## Answer` sections on the card.
   - Continue from the first unfinished step. Never start over or redo committed work. Note "resumed" in `Result`.

   Otherwise **claim it**: set Status to `In progress`, then from the repo root run `git worktree add .claude/worktrees/<id8>-<slug> -b task/<id8>-<slug> <base>`, `EnterWorktree` into it, and write the branch name into `Branch`. When a superpowers skill asks for an isolated workspace, use this worktree.
3. **Spec.** Write `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` from the card's Design, Acceptance criteria and Out of scope, adding no scope. It is approved. Commit.
4. **Plan.** Invoke `superpowers:writing-plans` with the spec. The plan is approved and runs **subagent-driven**. Commit it.
5. **Implement.** Invoke `superpowers:subagent-driven-development` (TDD applies). **Every commit** ends with a `Task: <card id>` trailer (blank line before it, before any `Co-Authored-By`); `/run-cards` uses it to see that the card has landed. Put this in every subagent's prompt. Build around the card's human steps and list the open ones in `Result`.
6. **Verify.** Invoke `superpowers:verification-before-completion`: the full unit tests and typecheck, plus **only the e2e tests your change touches** (none if it can't affect them; CI runs the full suite). If the `e2e-slot` script is installed, run e2e through it in the background (`timeout: 3600000`); exit 75 means the slot stayed busy: retry once, then write "e2e not run: slot busy" in `Result`. Wait for background commands' notices; don't add polling loops. Then do what the repo's CLAUDE.md asks of a finished branch (e.g. a changelog entry).
7. **Report.** Tick the acceptance criteria that are met. Write `Result`: what changed, where, how it was verified, anything open, and the branch. Set Status to `Review`, never `Done`.
8. **Finish** with the card title, its status and its link. Open items go in `Result`, never as a closing to-do list.
9. **Stuck?** (a decision only the user can make, an ambiguous design, a broken environment, missing credentials, or 3 failed fixes of the same problem):
   1. Commit your work in progress.
   2. Write `Question`: only what the user must decide, each question self-contained (context, options, your recommendation and why), at most 2000 characters. Copy it under `## Question` in the card body.
   3. Put what's done so far in `Result`, set `Blocked`, repeat the question in your final message, and stop.

## Resumed with an answer

`/run-cards` resumes you with "Answer to your question on the card: …". Make sure you're in the card's worktree, remove the `## Question` section from the card, and carry on from where you stopped. Report as usual.
