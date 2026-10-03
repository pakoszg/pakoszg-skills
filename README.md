# pakoszg-skills

Two [Claude Code](https://docs.claude.com/en/docs/claude-code) skills that turn an idea into reviewed, merged code with you deciding only the design:

1. **`/design-task`**: you and Claude design the work together and it becomes task cards on a Notion board.
2. **`/run-cards`**: Claude builds those cards unattended, one background session per card, reviews each one and merges it into a run branch for you to check.

```
idea ──/design-task──▶ Ready cards in Notion ──/run-cards──▶ run/<name> branch ──you──▶ main
        (you + Claude)                          (Claude alone)                (review, merge, push)
```

## What you need

- **Claude Code** with background sessions (`claude --bg`, `claude agents`).
- **[Superpowers](https://github.com/obra/superpowers)**, a skills plugin. The skills use its `brainstorming`, `writing-plans`, `subagent-driven-development` and `verification-before-completion` skills.
- **Notion MCP**: the claude.ai Notion connector or the [Notion MCP server](https://developers.notion.com/docs/mcp), with access to your board.
- **git** and **jq**.
- Optional: an e2e lock (see below), and the [Mobbin](https://mobbin.com) MCP for UI references while designing.

## Install

```bash
git clone https://github.com/pakoszg/pakoszg-skills ~/code/pakoszg-skills
ln -s ~/code/pakoszg-skills/skills/design-task ~/.claude/skills/design-task
ln -s ~/code/pakoszg-skills/skills/run-cards   ~/.claude/skills/run-cards
```

## Set up the board

Create a Notion database with these properties:

| Property | Type | Values |
| --- | --- | --- |
| Task name | title | |
| Status | select | Plans, Ready, In progress, Review, Done, Blocked |
| Repo | select | local repo paths, e.g. `~/code/my-app` |
| Priority | select | High, Medium, Low |
| Points | select | 1, 2, 3, 5 |
| Model | select | Opus, Sonnet, Haiku |
| Blocked by | relation | to the same database |
| Result, Question, Branch | text | |

Then tell each repo where its board is, in its `CLAUDE.md`:

```markdown
## Task board
Notion data source: collection://<your data source id>
```

(Ask Claude "what's the data source id of my Tasks database?" if you don't know it.)

## How I use it

I run both skills on Opus (`/model opus`): design needs judgment, and the orchestrator reviews and merges everything. The workers use whichever model each card names.

1. **Design.** In the repo, run `/design-task <idea, goal or card URL>`. Claude reads the code, brainstorms with me one question at a time, splits the work into small cards (1–5 points, each mergeable on its own), sets dependencies and a model per card, and asks about every assumption. I approve the table, and it writes the cards and marks them **Ready**.
2. **`/clear`.** Everything the workers need is on the cards, so I start the build with a clean context.
3. **Run.** I run `/run-cards <card URLs or a shared title prefix>`. It:
   - creates a worktree on a new branch `run/<name>`;
   - starts one background Claude session per card (in parallel when cards don't overlap). Each writes a spec and a plan, builds with TDD and sets its card to **Review**;
   - reviews each card, sends findings back to its worker, and merges it into `run/<name>`;
   - brings a worker's question to me when it is stuck, and passes my answer back.
4. **Finish.** I review the `run/<name>` branch, merge it into `main` and push myself. `/run-cards` never touches `main`, never pushes and never deletes anything; at the end it lists the worktrees I can clean up.

Cards stay in **Review** after merging; I move them to **Done**.

## Optional: e2e lock

When several workers run end-to-end tests at once, they can collide on one test port. The fix is a small `e2e-slot` command that lets one run go at a time. It isn't included: [docs/e2e-lock-blueprint.md](docs/e2e-lock-blueprint.md) describes it, so you can hand it to Claude and have it built for your setup. Once `e2e-slot` is on your `PATH`, the skills use it.

## Not using Notion?

The skills only need a tracker that can: query cards by status or title, read a card's body and fields, update fields (Status, Result, Question, Branch), append to the body, and link cards (`Blocked by`). To use Linear, GitHub Issues or another tracker, replace the Notion wording in both `SKILL.md` files and in `worker.md` with that tracker's MCP tools, and keep the same fields.

## Good to know

- Workers run with `--permission-mode auto`, so check your permission settings before the first run.
- Cards land when a commit with a `Task: <card id>` trailer is on the branch; `Blocked by` uses this to decide what can start.
- A worker that needs a decision writes a **Question** on the card and stops; nothing guesses on your behalf.

## License

MIT
