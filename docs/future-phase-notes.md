# Future Phase Notes

## Promoted From Future Phase

### Local Worker Companion

Status: promoted into the main workflow MVP

Reason:

- The product goal is multi-user operation where each developer uses their own repo, Codex, and permissions.
- A browser-only App cannot safely or directly control each user's local Codex.
- Without the Local Worker, the App would fall back to prompt generation and manual handoff.

Current implementation:

- The App registers Local Workers and stores token hashes server-side.
- `scripts/local-worker.mjs` polls for queued Agent Packets.
- The worker runs the operator-configured command template from the developer's repo path.
- The worker returns command output, diff summary, artifact, and completion status.

## Deferred Azure Operations

### Azure Operation Risk Split

Status: product decision recorded

Current decision:

- Abandon PR and merge PR remain human-controlled high-risk operations.
- Linking an existing Work Item to an active PR is allowed in the MVP as a guarded write.
- Hotfix target policy remains pending.

### Hotfix Release Target Policy

Status: pending product decision

Confirmed MVP boundary:

- `HOTFIX` requests may be classified during intake.
- A verified Azure Work Item may derive `hotfix/{workItemId}` for formal PR delivery.
- The current request delivery base remains `develop`.
- The App, Codex, and Local Worker must not infer production release routing from the `HOTFIX` request kind alone.

Open decisions:

- Whether production hotfix PRs target `develop`, `main`, `release/*`, or another protected branch.
- What approval, build, deployment, rollback, and audit evidence is required before a hotfix can ship.
- Whether hotfix delivery needs a separate operator confirmation or permission scope.

AI-operable candidates for later phases, still requiring explicit product rules:

- Assign reviewers.
- Create branch under an approved branch prefix.
- Trigger selected non-deploy validation builds.

Remain high-risk and should not be treated as ordinary AI operations:

- Delete branch.
- Deploy.
- Change branch policy.
- Update Work Item content, state, assignee, or fields.

Reason:

- These operations can change team workflow state, production state, audit trails, or repository governance.
- They need operation-specific confirmation, rollback expectations, permission scopes, and audit records before implementation.

### Abandon Pull Request

Status: deferred

MVP decision:

- Do not implement Abandon PR in the MVP.
- Treat Abandon PR as a high-risk Azure workflow state mutation.
- Record it for later product and governance review.
- Do not design or encode detailed behavior yet.

Reason:

- Abandoning a PR changes Azure PR state, review visibility, and audit trail.
- The App should not treat it as automatic cleanup.
- Human ownership and team policy need to be confirmed before implementation.

Future review questions:

- Should the App support Abandon PR at all?
- Should it be limited to draft PRs or test PRs?
- What human confirmation, reason capture, or audit evidence is required?
- Should this operation require a separate permission scope or operator role?
