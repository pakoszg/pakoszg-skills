---
name: design-task
description: Design task cards with the user before autonomous workers build them — brainstorm, split into 1/2/3/5-point cards with dependencies, write the agreed design onto each card in the Notion task board and mark them Ready. Use when the user says "design task", "design this card", "plan cards", turns an audit or a goal ("ready for real users") into cards, or invokes /design-task.
argument-hint: "[card URL, a new idea, or a goal to audit]"
---

# Design task (human in the loop)

**Board.** The repo's CLAUDE.md names the board in a `## Task board` section (`Notion data source: collection://…`). If it has none, ask the user for the data source and offer to add the section. Properties: `Task name` (title), `Status` (Plans → Ready → In progress → Review → Done, plus Blocked), `Repo` (local path), `Priority` (High/Medium/Low), `Points` (1/2/3/5), `Model` (Opus/Sonnet/Haiku), `Blocked by` (relation), `Result`, `Question`, `Branch`.

Workers (`/run-cards`) run unattended and treat a card's `## Design` as the approved design. **Everything a worker needs must be on the card.** Nothing is marked Ready without the user's explicit approval.

**Scope: change only what the user asked for.** Any other edit (another card's fields, a relation, wording on a card the user already approved) is a proposal: show it and wait for a yes.

**Batch tool calls.** At the start of each step, send the independent calls together (related cards, dependency queries, repo files).

## Steps

1. **Subject.**
   - A card URL: fetch it.
   - Text naming one change: a new idea.
   - A goal rather than a change ("what do we need before real users?"): **audit** first. Dispatch read-only Explore agents in parallel, one per angle (e.g. privacy, data lifecycle, security, ops), with file paths required in their reports. Present the findings as *critical* and *nice to have*, and let the user pick which become cards.
   - Empty: list `Plans` cards with their blockers, run the dependency check (step 5) over them, and recommend what to design next (cards whose blockers are done or Ready, cards that unblock the most others). Then ask.
2. **Ground it.** Read the repo (CLAUDE.md, the relevant code, recent commits), read-only.
3. **Brainstorm.** Invoke `superpowers:brainstorming` and follow it with the user through questions, approaches and design approval. Stop where it would write a spec file; the cards replace the spec.
   - Ask first the question that shapes the most cards, then one question at a time.
   - Ask for facts only the user knows (names, addresses, accounts) as plain text.
   - For UI work, if a design-reference tool (e.g. the Mobbin MCP) is available, look at how established apps solve it and name the references on the card.
4. **Estimate and split.** Points: **1** a few lines, **2** a small change, **3** a focused feature slice, **5** large (the maximum). Anything bigger must be split. Every card is an independently testable deliverable that leaves `main` working once merged on its own.
   **Model** per card (the worker runs unattended through spec, plan, TDD and tests, so a failed run costs more than the tokens saved):
   - **Opus**: security, auth, payments, data and migrations, cross-cutting changes, any 5-point card, any card that still leaves judgment calls.
   - **Sonnet**: a well-specified 1–3 point card that follows an existing pattern.
   - **Haiku**: a 1-point mechanical change (rename, constant, typo).
   When unsure, pick the next model up.
5. **Dependencies and parallelism.**
   - B is `Blocked by` A when B needs A's code merged.
   - Cards that edit the same files are chained, to avoid merge conflicts. So are cards that each add a database migration (parallel branches take the same number).
   - Cards on disjoint files stay independent, so they run in parallel.
   - Put shared interfaces (exact names, types, signatures) in the earliest card, so later cards can code against them.
   - **Dependency check** (always, even for one card): for the subject card and every card it relates to, compare `Blocked by` with the body. Any card the text names, whose design edits the same files, or that also adds a migration, needs a relation. Query the repo's other open cards for overlaps too. Report missing or wrong relations as a table and fix them once the user approves.
6. **Assumption sweep.** Re-read every drafted card and list each choice the user didn't make: defaults, time periods, who gets notified, what happens to related data. Ask about each one. Done when every choice traces to a user answer or to the repo.
7. **Present the card set** as a table (`# · title · points · model (why) · blocked by · wave`, where "wave N ∥" marks cards that can run together). Revise until the user explicitly approves.
8. **Write the cards.** If you started from a card, reuse it as the first one. Set `Task name`, `Repo`, `Priority`, `Points`, `Model` and `Blocked by`. Body:
   ```
   ## Design
   **Goal:** one sentence
   **Context:** why, and what exists today
   **Decisions:** what the user decided, dated (YYYY-MM-DD)
   **Approach:** the agreed design, specific enough to implement without questions
   **Interfaces:** consumes / produces — exact names and signatures
   **Files:** create / modify
   **Testing:** what proves it works
   **Human steps:** what only the user can do (dashboards, credentials, pushing), or "none"
   ## Acceptance criteria
   - [ ] …
   ## Out of scope
   - …
   ```
   A card that is *only* human steps stays in `Plans` and is never marked Ready.
9. **Mark Ready.** Only after approval, set every new card's Status to `Ready`. Report the table with card links, and suggest `/run-cards <cards>`.
