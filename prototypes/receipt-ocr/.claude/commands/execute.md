---
description: Execute an implementation plan through validated, documented handoff
argument-hint: [path-to-plan]
---

# Execute: Implement from Plan

## Plan to Execute

Read plan file: `$ARGUMENTS`

## Execution Instructions

### 1. Read and Understand

- Read the entire plan carefully.
- Understand all tasks and their dependencies.
- Note the validation commands and testing strategy.
- Preserve unrelated user changes already present in the worktree.

### 2. Execute Tasks in Order

For every task in the plan:

1. Read the existing files before modifying them.
2. Implement only the requested behavior and match existing patterns.
3. Add the specified tests.
4. Run the task's immediate validation.
5. Fix failures before continuing.

### 3. Maintain the Validation Contract Automatically

Before the final validation sweep, inspect the completed diff and hand-extend
`.claude/commands/validate.md` when the task introduced any of the following:

- new tests that need a Phase 4 coverage entry;
- a new user-facing flow that needs a Phase 8 journey and removal from Phase 9;
- a new tool, service, database workflow, environment variable, or deployment path;
- a new class of regression that deserves a permanent check.

Do not wait for the user to request this maintenance. Never run
`/ultimate_validate_command` over the existing file; preserve every existing phase and add only
task-specific coverage. If no validation-file change is warranted, explain why in the handoff.

### 4. Run Complete Validation Automatically

Run every validation command from the plan. After those pass, read and execute the entire
`.claude/commands/validate.md` workflow.

Plan checks are fast feedback, not a substitute for the project-wide sweep. A skipped phase is not a
pass. If a command fails, fix the issue and rerun the affected command, then rerun any downstream
checks whose result may have changed.

Do not wait for a separate `/validate` prompt. Validation is a mandatory continuation of
`/execute`.

### 5. Update Documentation Automatically

Only after implementation and the full validation sweep pass:

- inspect the changed-file list for documentation impact;
- follow the `documentation-manager` workflow, or perform the equivalent update directly when a
  documentation subagent is unavailable;
- update README, configuration, setup, API, and operational documentation only where the task
  changed reality;
- verify every documented command and path that was added or changed.

Do not wait for the user to request documentation. Do not add speculative documents or rewrite
unrelated prose.

### 6. Record History and Roadmap Completion Automatically

- Write `.agents/history/{NN}-{kebab-name}.md` with the actual implementation, decisions,
  deviations, validation evidence, deployment state, and known follow-ups.
- Update `.agents/ROADMAP.md`: mark the task done, link its plan and history, advance the header to
  the next task, and record any approved roadmap deviation.
- Never claim a check passed unless it was executed successfully.

Do not wait for a separate history or roadmap prompt.

### 7. Verify the Final Documented Worktree

After documentation and history edits, rerun documentation/style checks and `git diff --check`.
If this stage changes executable code or configuration, rerun the complete validation workflow.

### 8. Stop for Human Review — Never Commit Automatically

Before completing, confirm:

- all plan tasks and tests are complete;
- the validation contract was updated when needed;
- the full validation workflow passed, with skipped external/manual checks disclosed;
- documentation and task history are current;
- roadmap status and links are current;
- the final worktree checks pass.

Then present the uncommitted diff/status for human review. Do not stage files, create a commit, push,
open a pull request, or invoke `/commit`. The user triggers `/commit` manually after review.

## Output Report

Report:

### Completed Tasks

- Files created and modified.
- Important implementation decisions and deviations.

### Tests and Validation

- Tests added.
- Commands executed and real results.
- Any skipped check and why.

### Documentation and History

- Documentation files updated.
- History file written.
- Roadmap status and link changes.

### Ready for Human Review

- Confirm the complete task is uncommitted.
- Explicitly state that `/commit` remains a separate manual user action.

## Non-Negotiable Rules

- Do not skip validation steps or weaken tests to obtain a pass.
- Do not ask the user to run validation, documentation, or history as separate workflow steps.
- Do not document or mark a task complete after failed validation.
- Never commit automatically.
