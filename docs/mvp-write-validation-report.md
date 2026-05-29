# MVP Write Validation Report

## Workflow Control Plane Update

The App has been shifted from an Azure DevOps diagnostics-first interface to a request-first team workflow interface.

Added:

- Server-side workflow persistence with SQLite under `.control-plane/`.
- Request records with owner, Task Level, assigned local Codex worker, and workflow stage.
- Agent0 -> Agent1 -> Agent2 -> Agent3 stage dispatch.
- Local Worker registration with one-time worker token display.
- Worker polling, heartbeat, artifact upload, and completion APIs.
- `scripts/local-worker.mjs` for developer-local execution, plus `scripts/local-launcher.mjs` for Windows background startup.
- PR traceability records after guarded draft PR creation.

Existing Azure read/write guard behavior remains available under Diagnostics.

## Request-First Product UI Update

The main workflow was simplified for general team use:

- Request Intake now accepts natural-language request text only.
- The App shows a provisional local preview for request kind, Task Level, title, missing source signals, and high-risk operation signals.
- Local Codex returns the authoritative workflow interpretation after Agent0 completes.
- Worker interpretation is accepted only as workflow metadata; it is not treated as confirmed Spec/API/Figma/QA.
- The ordinary UI now shows only My Request Records. Worker task selection is hidden because dispatch is automatic.
- Stage Gate is renamed Workflow Status and displays compact status by default.
- Technical agent packets and artifacts are moved behind expandable technical details.
- Azure Diagnostics was moved out of the main workflow to `/diagnostics` so ordinary users do not see Azure connector controls unless they intentionally open the developer diagnostics route.
- The workflow no longer auto-selects an old request on page load, so the default visible flow remains Step 1 / request input.
- The main flow is now login-first: `我的 Codex 設定` is the only workflow surface rendered before login. Request input, request records, workflow status, and stage progress are not shown until the local worker has recent heartbeat evidence, has reported repository candidates, and the user has selected a repository.
- The product header is `Codex Mission Control`, with a request-to-PR subtitle for ordinary team users.
- Global status messages now use bottom-right fading toasts; persistent blocking status stays inside the Codex setup panel.
- The global refresh button was removed. Worker readiness and project candidates refresh in the background before login.
- Local Codex setup now includes a worker-reported local repository dropdown and an auto commit / draft PR preference.
- The ordinary UI uses `專案` for repository selection.
- The App can stop a local worker connection by disabling its token; queued or running Agent tasks block stop.
- The Azure PAT input appears only after the user enables auto commit / draft PR, with a hover tip describing where to create a PAT in Azure DevOps and which minimal scopes are needed.
- Repository candidates are reported by Local Worker Companion through `/api/workers/repositories`; the ordinary App UI no longer relies on browser-side or server-side filesystem scanning to populate the repository dropdown.
- The PAT is only sent to the user's Local Launcher when auto commit / draft PR is enabled. It is stored in that user's DPAPI-protected local profile and is not sent to `/api/workers`.
- The auto commit / draft PR preference is stored on the worker record and exported as `CONTROL_PLANE_AUTO_COMMIT_PR=1`; it does not bypass guarded write policy or authorize merge, abandon, deploy, branch policy, or Work Item field mutation.
- Local worker readiness now requires Codex execution readiness, not only heartbeat and project discovery. The worker reports `codexReady`, `codexStatus`, and `codexError`; the main request workflow stays closed when Codex CLI is unavailable. The App can request an explicit worker-side Codex setup flow, where the running worker terminal installs the CLI if missing, starts human login, and reports readiness again after login exits.
- The platform App host's absolute filesystem path is never exposed. The Local Launcher downloads the Local Worker Companion from the shared App into the developer's local cache directory, then starts the worker from that cache.
- Selecting a worker-reported project persists the selected repository path on the worker record. Creating a request snapshots that repository path onto the Request ID, and each queued Agent run stores the same repository path snapshot so Agent0-3 execute in the original selected repository rather than following later worker dropdown changes.
- The worker command template is hidden from ordinary users. The worker defaults to `codex exec --skip-git-repo-check --sandbox workspace-write - < {packetFile}` and exposes `danger-full-access` only after explicit user confirmation.
- Agent Packets are role-specific to reduce context pollution and token use. Agent0/Agent1 receive intake/source-check context; Agent2/Agent3 rely on compact structured handoff summaries and only receive fallback user request text when required evidence is missing. Agent1 Source Check Reports must carry confirmed requirements, confirmed scope, allowed files, non-scope, do-not-touch areas, blockers, can-proceed status, and the Task Package for Agent2; missing required fields are flagged as incomplete handoff instead of being inferred by the next Agent.
- Azure Boards Work Item IDs are shown as Azure `單號` in the request-first UI and workflow Agent Packets. Internal API names still use Work Item terminology.

The browser preview is deterministic and does not require an OpenAI API key. The workflow can use each developer's local Codex worker for request interpretation without central OpenAI API billing.

Date: 2026-05-22

## Scope

Validated Azure DevOps write operations currently allowed by the MVP:

- Create draft pull request.
- Post pull request readiness comment.
- Update pull request description with the control-plane marker block.

Deferred high-risk write operations:

- Abandon pull request.

## Environment

- Azure org: `odin-tech`
- Azure project: `MT5-Trading-Platform`
- Repository: `odin-mt5-web`
- Default target branch: `develop`

## Results

### PR Comment

Result: pass

Evidence:

- Posted readiness comment to PR `#388`.
- Posted readiness comment to PR `#390`.
- App displayed Azure comment thread success messages.
- Browser console error count was `0`.

### PR Description Update

Result: pass

Evidence:

- Updated PR `#388` description with the control-plane marker block.
- Updated PR `#390` description with the delivery gate marker block.
- App preserved marker-bounded description updates.
- Browser console error count was `0`.

### Create Draft PR

Result: pass

Evidence:

- Created draft PR `#390`.
- Source branch: `AITraining/collaborationProtocol`
- Target branch: `develop`
- App required branch policy acknowledgement because the source branch is not `feature/*`, `bug/*`, or `hotfix/*`.
- Refresh showed PR `#390` in the pull request table.
- App displayed `active` and `draft` status.
- Delivery Gate included PR `#390`.
- Server-side create PR guard rejects protected branches as source branches.
- Server-side create PR guard rejects non-protected branches as target branches.

### Duplicate PR Guard

Result: pass

Evidence:

- After PR `#390` was created, selecting `AITraining/collaborationProtocol -> develop` disabled `Create Azure PR`.
- App showed an existing active PR guard message.

### Write Activity Log

Result: pass

Evidence:

- App recorded Azure write activity for PR `#390`.
- Write activity is persisted locally without storing PAT or full payload content.
- App provides a manual `Clear` control for local activity records.
- Recorded operations included:
  - Update description on PR `#390`.
  - Post comment on PR `#390`.

### PR Deep Links

Result: pass

Evidence:

- Azure connector returns PR web URLs for created PRs, duplicate PR guards, updated PR descriptions, and PR list rows.
- Pull request table links PR IDs to Azure DevOps.
- Created PR success state and write activity records can link directly to the Azure PR when a URL is available.

### Rule Check History

Result: pass

Evidence:

- App records Delivery Gate and Historical Audit runs in local storage without storing PAT.
- Live Delivery Gate read-only check on PR `#390` created a local history entry.
- The recorded result showed:
  - Checked: `1`
  - Blocked: `1`
  - Warnings: `0`
  - Passed: `0`
- Browser console error count was `0`.

### Agent Packet Handoff

Result: pass

Evidence:

- Rule check reports now include changed file evidence from Azure PR iterations.
- App can generate a structured Agent Packet per checked PR.
- Agent Packet includes:
  - Request ID.
  - Recommended next Agent role.
  - Agent startup prompt.
  - Confirmed Azure evidence.
  - Scope and Non-Scope.
  - Allowed files and do-not-touch boundaries.
  - Stage gate result.
  - Blockers, review items, human decisions, and required verification.
  - Changed files.
  - Stop conditions.
- This is a read-only handoff artifact and does not execute local Codex or write Azure.

### Action Queue

Result: pass

Evidence:

- Current rule check results now consolidate blockers, human decisions, and required verification commands into one Action Queue.
- Action Queue is read-only and derived from the same rule check reports used for Delivery Gate and Agent Packet handoff.

### GitFlow Policy Visibility

Result: pass

Evidence:

- App now displays the branch target policy used by Create PR and Delivery Gate.
- Feature and bug branch target policy is visible as `develop`.
- AI training branches using `AITraining/*` or `AI_Training/*` are classified as test branches targeting `develop`.
- Hotfix target policy remains visible as pending, matching the current product decision.
- Protected branches are shown in the policy panel.

### Work Item Traceability

Result: pass

Evidence:

- App now converts linked Work Item refs into Azure Work Item web links.
- App now reads linked Work Item details through Azure Work Item Tracking before display.
- Pull request table shows linked Work Item IDs and titles instead of only a count.
- PR detail view lists linked Work Items with title, type, state, owner, area, iteration, tags, and direct Azure links.
- Live Azure test linked Work Item `#795` to PR `#390`, refreshed Azure evidence, and reran Delivery Gate with `Blocked: 0`.

### Work Item Link Guarded Write

Result: pass

Evidence:

- App can link an existing Azure Boards Work Item ID to an active PR through a guarded write.
- This operation adds a Work Item relation to the PR artifact. It does not create a Work Item or update Work Item fields.
- App reads the entered Work Item before the write confirmation so the operator can confirm the correct title, type, state, and iteration.
- Server-side route requires explicit write confirmation.
- Server-side route validates Work Item ID is a positive integer.
- Local negative test returned HTTP `400` when write confirmation was missing.
- Local negative test returned HTTP `400` when Work Item ID was not numeric.
- Azure client verifies the PR is active before linking.

### Work Item Candidate Search

Result: pass

Evidence:

- Added read-only Azure Boards WIQL query endpoint for Work Item candidate search.
- Candidate search infers numeric Work Item IDs from PR branch, title, and description when possible.
- If no ID is inferred, the App lists recent non-closed Work Items as candidates.
- Candidate rows show title, type, state, owner, iteration, and Azure link.
- Choosing a candidate only fills the Work Item ID input. It does not write to Azure.
- Live Azure test on PR `#399` returned candidate Work Items including `Bug #758`, `Bug #742`, `Bug #784`, `Bug #765`, `Bug #768`, `Task #39`, `Task #706`, and `Task #795`.
- Local negative test returned HTTP `400` when PAT was missing.
- `pnpm lint` and `pnpm build` pass after this change.

### Evidence Deep Links

Result: pass

Evidence:

- Repo rule source rows link directly to the corresponding Azure Repos file on the configured rule-source branch.
- Build evidence badges link to Azure build or PR status URLs when Azure returns one.
- PR detail view lists all build evidence items and the checked evidence sources.
- PR detail view lists Azure PR status checks with target links when Azure returns them.
- These links are read-only evidence shortcuts and do not mutate Azure DevOps state.

### Reviewer Evidence

Result: pass

Evidence:

- App now reads Azure PR reviewers through the read-only Pull Request Reviewers API.
- Pull request table shows reviewer count, required count, approvals, and rejections.
- PR detail view lists reviewer display name, account, vote label, required, declined, and flagged evidence.
- Reviewer evidence is display-only. The MVP does not add reviewers, remove reviewers, or cast votes.
- Live Azure test on PR `#399` returned required reviewer `[MT5-Trading-Platform]\Frontend-Approve-Group` with vote `0` and label `no vote`.
- `pnpm lint` and `pnpm build` pass after this change.

### PAT Scope Guidance

Result: pass

Evidence:

- Connection panel distinguishes read-check scopes from guarded-write scopes.
- UI states that Work Items write, Build execute, Release, Test Management, Packaging, deploy, merge, and branch policy mutation scopes are not part of the MVP.

### Operator Guide

Result: pass

Evidence:

- Added `docs/operator-guide.md`.
- Guide documents the normal workflow, PAT scopes, allowed guarded writes, deferred operations, Agent Packet purpose, local audit records, and stop conditions.

### Request Intake

Result: pass

Evidence:

- App now provides a Request Intake panel after Azure connection and before PR write / rule-check workflows.
- Request Intake captures request kind, title, detail, Task Level, and optional Azure PR or Work Item reference.
- App generates local Request IDs with `<KIND>-<YYYYMMDDHHmm>-<slug>`.
- App stores up to 20 local request records in `azure-ai-control-plane.requestIntake`.
- Agent0 dispatch prompt preview and copy are available without Azure writes.
- Existing PR Agent Packet copy can include the selected Request Intake as a `User Request` section.
- Unit tests cover Request ID generation, slug fallback, local record parse fallback, PAT-field exclusion, record cap, and Agent0 prompt guardrails.
- Browser verification created a local request record, displayed the Agent0 dispatch prompt, copied it to clipboard, and reported `0` console errors.

### Automated Regression Tests

Result: pass

Evidence:

- Added Node test coverage for Request Intake request IDs, local record parsing, record cap, PAT-field exclusion, and Agent0 prompt guardrails.
- Added regression coverage for testing-stage write policy, Create PR validation, GitFlow target recommendations, stage gate readiness, missing Work Item blocking, and Request Intake merging into Agent Packet.
- `pnpm test` currently runs 11 tests without adding a third-party test framework.

### Smoke Check Script

Result: pass

Evidence:

- Added `pnpm smoke` as a local-first smoke check.
- Without PAT, it verifies App shell HTTP `200` and confirms non-`AITraining/*` Create PR write attempts return the expected policy block before PAT validation.
- With `AZURE_DEVOPS_PAT`, it can additionally run read-only Azure overview checks for protected branches, PR list, reviewer evidence count, and Work Item evidence count.

### Error State Classification

Result: pass

Evidence:

- Main connector and PR/rule-check error surfaces now classify PAT missing, authentication failure, permission scope, not-found, build evidence, reviewer evidence, Work Item evidence, and testing-stage write-block errors.
- Classified errors show an operator action and keep the raw technical detail available for troubleshooting.
- Partial PR read diagnostics now summarize evidence-specific failures instead of showing only raw strings.

### Guarded Write Confirmation

Result: pass

Evidence:

- Replaced browser-native confirmation with an App-level guarded write modal.
- Modal displays:
  - Operation.
  - Target.
  - Risk.
  - Side effect.
  - Reversibility.
  - Human confirmation reason.
  - Payload summary.
- Canceling the modal closes it without performing Azure writes.
- Fresh browser verification after the Work Item detail update had `0` new console errors.

### PR Comment Write Guard

Result: pass

Evidence:

- Server-side PR comment route now requires explicit write confirmation.
- Comment content must contain the Azure AI Control Plane readiness marker.
- Comment content is length-limited before Azure write execution.
- Azure client verifies the PR is active before posting a control-plane comment.
- Local negative test returned HTTP `400` for an arbitrary comment without the readiness marker.
- This prevents the MVP comment endpoint from being used as a generic arbitrary PR comment proxy.

### PR Detail API Error Semantics

Result: pass

Evidence:

- PR detail route returns HTTP `400` when required Azure request data is missing instead of returning HTTP `200` with an embedded error.
- Local negative test with missing PAT returned HTTP `400` and `detailUnavailable: true`.
- Rule Check can still convert detail read failures into inspection-failed reports.

### Create PR Write Guard

Result: pass

Evidence:

- Local negative test returned HTTP `400` when `sourceBranch` was `main`.
- Local negative test returned HTTP `400` when `targetBranch` was `AITraining/test-target`.
- These checks happen before Azure DevOps write execution.

### Testing Stage Branch Write Policy

Result: pass

Evidence:

- Testing-stage Azure writes are limited to source branches under `AITraining/*`.
- `AI_Training/*` remains classified as an AI training branch for rule checks, but it is read-only during the testing stage.
- Create PR source branch selection only lists writable `AITraining/*` branches.
- PR description updates, readiness comments, and Work Item linking are hidden or disabled for non-`AITraining/*` PR source branches.
- Server-side Azure client rejects write operations when the PR source branch is not under `AITraining/*`.
- Local negative test returned HTTP `400` when `sourceBranch` was `bug/775`.
- Local negative test returned HTTP `400` when `sourceBranch` was `AI_Training/test_p`.
- Local app shell returned HTTP `200` after the policy change.

## Known Follow-Up

- Abandon PR remains deferred for later governance review.
- Work Item mutation remains outside the current MVP write scope.
