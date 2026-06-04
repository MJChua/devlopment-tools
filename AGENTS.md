# Repository Agent Rules

## Repository Identity

- This repository is `azure-ai-control-plane`, a Next.js / React / TypeScript control plane for Azure DevOps, Local Worker Companion, and Agent0-3 workflow delivery.
- Treat this file as the first AI-facing instruction source for repo work. For deeper product behavior, read `docs/operator-guide.md` and the relevant code/tests before making changes.
- Do not import rules from another repository unless the user explicitly says this task follows those rules.

## Instruction Loading Order

Before coding, reviewing, debugging, or publishing changes:

1. Read this `AGENTS.md`.
2. Read task-relevant docs under `docs/`, especially `docs/operator-guide.md` for workflow and Azure behavior.
3. Inspect the relevant implementation and tests before deciding scope.
4. Preserve any existing user changes in the worktree. Do not revert files you did not change.

## Tech Stack And Commands

- Package manager: `pnpm`.
- Framework: Next.js 16 with React 19.
- TypeScript is strict and uses `@/*` imports for `src/*`.
- Main validation commands:
  - `pnpm test`
  - `pnpm lint`
  - `pnpm build`
  - `pnpm smoke`
- For documentation-only rule changes, run `git diff --check` and manually review the changed Markdown.
- For substantive workflow, routing, readiness, Local Worker, PR delivery, or state-machine changes, run `pnpm test`, `pnpm lint`, `pnpm build`, and `pnpm smoke`.
- `pnpm smoke` must remain local-first and must not perform Azure writes. With `AZURE_DEVOPS_PAT`, it may perform read-only Azure checks only.

## Product Workflow Rules

- User request text, screenshots, and browser previews are intake evidence, not confirmed requirements.
- Agent0 may classify and route the request, but must not confirm requirements.
- Agent1 must verify source/scope from repository inspection and confirmed sources before implementation.
- Agent2 implements only Agent1-confirmed scope and allowed files.
- Agent3 reviews Agent2 output against confirmed scope, changed files, and verification evidence before delivery.
- Preserve the Agent0 -> Agent1 -> Agent2 -> Agent3 workflow unless the user explicitly asks to change that product contract.
- Required handoff fields must stay structured:
  - Agent1: `Confirmed Requirements`, `Confirmed Scope`, `Allowed Files`, `Non-Scope`, `Do Not Touch`, `Can Proceed`, `Task Package`.
  - Agent2: `Changed Files`, `Commands Run`, `Verification Result`, `Scope Compliance`, `Human Decisions`.
  - Agent3: `Review Result`, `Scope Compliance`, `Unapproved Changes`, `Verification Result`, `Regression Risk`, `Human Decisions`.
- Missing required handoff fields are blockers. Do not infer missing scope from prose.

## Azure And PR Guardrails

- Azure writes must remain guarded by UI confirmation and server-side validation.
- Allowed MVP writes are limited to:
  - Create a draft PR from an allowed source branch to the protected target branch.
  - Update an active PR description only within the control-plane marker block.
  - Post an active PR readiness comment only with the control-plane readiness marker.
  - Link an existing Azure Boards Work Item to an active PR after reading and confirming that Work Item.
- Do not merge, abandon, approve, deploy, mutate branch policy, create/delete branches, create Work Items, update Work Item fields, trigger builds, change reviewers, or cast review votes unless product rules are explicitly changed.
- Formal PR delivery requires verified Azure Work Item evidence before deriving a team branch.
- Formal team branches are exactly `feature/{workItemId}`, `bug/{workItemId}`, or `hotfix/{workItemId}` and target `develop`.
- Branch names must not add titles, slugs, dates, or other suffixes.
- `hotfix/{workItemId}` is recognized for branch naming, but production release routing remains undecided. Do not create release branches or bypass normal PR gates for hotfix requests.
- The Local Worker must not merge or rebase `origin/develop` into a formal PR branch. If the branch is behind `origin/develop`, block with `pr_branch_outdated` and require human branch update.

## Local Worker And Runtime State

- Local Worker heartbeat, Codex readiness, worker version/hash, repo dirty state, queued/running status, stale run state, and PR branch freshness are separate states. Do not collapse them into a generic worker issue.
- Codex readiness requires a terminal-callable Codex CLI. WindowsApps Codex Desktop executables are desktop-internal and do not count as a valid Local Worker executor.
- Repository candidates come from the developer's Local Worker, not browser filesystem scanning.
- Creating a request snapshots the selected repository path onto the request and each queued Agent run. Do not make running requests follow later dropdown changes.
- Dirty repo and merge conflict blockers are repo-state blockers, not missing requirement evidence.
- Worker version/hash mismatch and worker-side runtime errors are operational blockers; the user should update/restart the worker and retry the same Agent.

## Implementation Rules

- Keep changes scoped to confirmed request behavior and established ownership boundaries.
- Prefer existing helpers, state-machine functions, API routes, shadcn/Radix UI components, and tests over new abstractions.
- Do not add package dependencies, environment variables, migrations, broad refactors, or file deletions without explicit need and user approval when risk is high.
- For UI work, preserve request-first ordinary user flow. Keep diagnostics and technical details out of the normal path unless the product rule says otherwise.
- Use clear blocker messages for operational failures: worker readiness, worker version, dirty repo, branch outdated, missing verified Azure Work Item, high-risk request, and guarded write approval are distinct cases.
- On Windows, create or edit agent instruction Markdown with `apply_patch` to avoid UTF-8 BOM problems.

## Git And Publish Rules

- If the user says `c+p`, treat it as commit and push for this checkout after appropriate validation and repo checks.
- Before publishing, check branch, upstream, diff, and validation evidence.
- Do not stage or commit unrelated user changes.
- For substantial diffs, include `git diff --check` before staging and `git diff --cached --check` after staging.

## Stop Conditions

Stop and ask for human direction if the next step requires:

- Azure write behavior outside the allowed MVP writes.
- New Azure permission scopes.
- Requirement, business-rule, API, permission, data model, persistence, or workflow expansion not confirmed by sources.
- Environment modification, package installation, deployment, file deletion, or large refactor.
- Shared core module changes where the requested scope is unclear.
- Product decisions such as hotfix release target policy.
