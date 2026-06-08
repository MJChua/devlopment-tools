import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  buildAgentPacket,
  buildCreatePullRequestDescription,
  evaluatePullRequestRules,
  getCreatePullRequestWarnings,
  getRecommendedTargetBranch,
} = await import("../src/lib/repo-rule-engine.ts");
const {
  buildTeamPrDeliveryBranch,
  getTeamPrBranchKind,
  isTeamPrDeliveryBranch,
  isTeamPrDeliveryTargetBranch,
  getTestWritePolicyMessage,
  isTestWriteAllowedBranch,
  normalizeBranchName,
} = await import("../src/lib/test-write-policy.ts");
const { createRequestIntakeRecord } = await import(
  "../src/lib/request-intake.ts"
);
const { validateCreatePullRequestBody } = await import(
  "../src/lib/create-pr-validation.ts"
);
const {
  buildWorkItemFilterQuery,
  normalizeWorkItemIteration,
} = await import("../src/lib/azure-work-items.ts");

test("workflow UI does not render the removed workspace diagnostics card", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /WorkspaceStatusPanel/);
  assert.doesNotMatch(source, /工作區診斷/);
  assert.doesNotMatch(source, /Control Plane/);
  assert.doesNotMatch(source, /Repo snapshot/);
  assert.doesNotMatch(source, /共享 team/);
  assert.doesNotMatch(source, /個人 localhost/);
  assert.doesNotMatch(source, /label="Owner"/);
  assert.doesNotMatch(source, /getControlPlaneMode/);
});

test("workflow UI routes missing launcher profiles to toast-only guidance", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /launcher_profile_missing/);
  assert.match(source, /本機連線資料不存在，請按/);
  assert.match(source, /launcherState\.available\s*&&\s*launcherState\.hasProfile/);
  assert.match(source, /workerVersionMismatch && launcherHasProfile/);
  assert.doesNotMatch(source, /本機連線資料已不存在/);
  assert.doesNotMatch(source, /重新連線本機 Worker/);
});

test("workflow UI blocks worker disconnect only for open Agent runs", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const workerHasOpenRuns = Boolean\(currentWorker\?\.hasOpenRuns\)/,
  );
  assert.match(source, /localWorkerConnected && workerHasOpenRuns/);
  assert.match(source, /activeRun=\{workerHasOpenRuns\}/);
  assert.match(source, /if \(workerHasOpenRuns\)/);
  assert.doesNotMatch(source, /workerHasActiveRequest/);
  assert.doesNotMatch(source, /localWorkerConnected && workerHasActiveRequest/);
});

test("single working tree mode replaces request worktree branch preparation", () => {
  const workerSource = readFileSync(
    new URL("../scripts/local-worker.mjs", import.meta.url),
    "utf8",
  );
  const launcherSource = readFileSync(
    new URL("../scripts/local-launcher.mjs", import.meta.url),
    "utf8",
  );
  const uiSource = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(workerSource, /git worktree add/);
  assert.doesNotMatch(workerSource, /\.codex-request-worktrees/);
  assert.match(workerSource, /Preparing local workspace/);
  assert.match(workerSource, /branch_start_confirmation_required/);
  assert.match(workerSource, /checkoutLatestDevelop/);
  assert.match(launcherSource, /\/repository\/status/);
  assert.match(uiSource, /BranchStartConfirmationDialog/);
  assert.match(uiSource, /branchStartConfirmed/);
});

test("testing-stage write policy allows only AITraining source branches", () => {
  assert.equal(
    normalizeBranchName("refs/heads/AITraining/test_p"),
    "AITraining/test_p",
  );
  assert.equal(isTestWriteAllowedBranch("AITraining/test_p"), true);
  assert.equal(isTestWriteAllowedBranch("refs/heads/AITraining/test_p"), true);
  assert.equal(isTestWriteAllowedBranch("AI_Training/test_p"), false);
  assert.equal(isTestWriteAllowedBranch("bug/775"), false);
  assert.equal(isTestWriteAllowedBranch("hotfix/390"), false);
  assert.equal(
    getTestWritePolicyMessage("refs/heads/bug/775"),
    'Testing-stage Azure writes are limited to AITraining/ branches. "bug/775" is read-only.',
  );
});

test("formal PR delivery policy allows numbered feature, bug, and hotfix branches without suffixes", () => {
  assert.equal(isTeamPrDeliveryBranch("feature/725"), true);
  assert.equal(isTeamPrDeliveryBranch("refs/heads/bug/399"), true);
  assert.equal(isTeamPrDeliveryBranch("hotfix/390"), true);
  assert.equal(isTeamPrDeliveryBranch("feature/390-title"), false);
  assert.equal(isTeamPrDeliveryBranch("bug/390-fix"), false);
  assert.equal(isTeamPrDeliveryBranch("hotfix/390-prod"), false);
  assert.equal(isTeamPrDeliveryBranch("feature/member-filter"), false);
  assert.equal(isTeamPrDeliveryBranch("AITraining/test_p"), false);
  assert.equal(isTeamPrDeliveryTargetBranch("develop"), true);
  assert.equal(isTeamPrDeliveryTargetBranch("main"), false);
  assert.equal(
    buildTeamPrDeliveryBranch({ workItemId: "399", workItemType: "Bug" }),
    "bug/399",
  );
  assert.equal(
    buildTeamPrDeliveryBranch({ workItemId: "725", requestKind: "REQ" }),
    "feature/725",
  );
  assert.equal(
    buildTeamPrDeliveryBranch({ workItemId: "390", requestKind: "HOTFIX" }),
    "hotfix/390",
  );
  assert.equal(
    buildTeamPrDeliveryBranch({ workItemId: "390-title", requestKind: "REQ" }),
    "",
  );
  assert.equal(getTeamPrBranchKind({ workItemType: "Bug" }), "bug");
  assert.equal(getTeamPrBranchKind({ requestKind: "BUG" }), "bug");
  assert.equal(getTeamPrBranchKind({ requestKind: "HOTFIX" }), "hotfix");
});

test("local worker explains verified Work Item requirement for formal PR branches", () => {
  const source = readFileSync(
    new URL("../scripts/local-worker.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /no verified Azure Work Item/);
  assert.match(source, /feature\/\{id\}, bug\/\{id\}, or hotfix\/\{id\}/);
});

test("local worker pushes formal PR branches without merging develop locally", () => {
  const source = readFileSync(
    new URL("../scripts/local-worker.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /git merge --no-edit origin\/develop/);
  assert.doesNotMatch(source, /Merging origin\/develop/);
  assert.match(source, /git merge-base --is-ancestor origin\/develop HEAD/);
  assert.match(source, /CONTROL_PLANE_BLOCKER_DIAGNOSTIC_START/);
  assert.match(source, /git rev-list --left-right --count origin\/develop\.\.\.HEAD/);
  assert.match(source, /git diff --name-only origin\/develop\.\.\.HEAD/);
  assert.match(source, /不是本機 develop 沒有拉到最新/);
  assert.match(source, /pr_branch_outdated/);
  assert.match(source, /origin\/\$\{branchName\}/);
  assert.equal((source.match(/git push/g) ?? []).length, 1);
});

test("local worker keeps polling when the App is temporarily unreachable", () => {
  const source = readFileSync(
    new URL("../scripts/local-worker.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /pollRetryDelaysMs = \[5000, 10000, 30000\]/);
  assert.match(source, /App is temporarily unreachable/);
  assert.match(source, /worker stays alive and will retry/);
  assert.match(source, /isTransientPollError/);
  assert.match(source, /WorkerStoppedError/);
  assert.match(source, /HTTP 5\\d\\d/);
  assert.match(source, /ECONNREFUSED/);
});

test("local launcher supervises saved workers and reports stale pids", () => {
  const launcherSource = readFileSync(
    new URL("../scripts/local-launcher.mjs", import.meta.url),
    "utf8",
  );
  const utilsSource = readFileSync(
    new URL("../scripts/local-launcher-utils.mjs", import.meta.url),
    "utf8",
  );

  assert.match(launcherSource, /workerSupervisorIntervalMs = 15000/);
  assert.match(launcherSource, /startWorkerSupervisor\(\)/);
  assert.match(launcherSource, /superviseSavedProfiles/);
  assert.match(launcherSource, /worker supervisor restarting/);
  assert.match(utilsSource, /workerStatusReason/);
  assert.match(utilsSource, /pid_not_running/);
});

test("local worker retries completion reports when the App is unreachable", () => {
  const source = readFileSync(
    new URL("../scripts/local-worker.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /completionRetryDelaysMs/);
  assert.match(source, /async function postRunCompletion/);
  assert.match(source, /completion report failed/);
  assert.match(source, /retrying in/);
  assert.match(source, /postRunCompletion\(run\.runId/);
});

test("local worker supports run-level cancellation without stopping the worker", () => {
  const workerSource = readFileSync(
    new URL("../scripts/local-worker.mjs", import.meta.url),
    "utf8",
  );
  const uiSource = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );
  const dbSource = readFileSync(
    new URL("../src/lib/control-plane-db.ts", import.meta.url),
    "utf8",
  );

  assert.match(workerSource, /runCancelCheckIntervalMs/);
  assert.match(workerSource, /cancelRequestedAt/);
  assert.match(workerSource, /taskkill\.exe/);
  assert.match(workerSource, /status: "cancelled"/);
  assert.match(dbSource, /export function cancelWorkerRun/);
  assert.match(dbSource, /agent\.cancelled/);
  assert.match(uiSource, /停止 Agent/);
  assert.match(uiSource, /runs\/\$\{openRun\.runId\}\/cancel/);
});

test("workflow UI keeps launcher recovery guidance concise", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /Launcher 需要更新/);
  assert.match(source, /Launcher 暫時模式/);
  assert.match(source, /複製管理員安裝指令/);
  assert.match(source, /launcherState\.requiresAdminInstall\s*&&\s*!launcherVersionMismatch/);
  assert.match(source, /目前可以繼續使用暫時連線/);
  assert.match(source, /系統管理員 PowerShell/);
  assert.match(source, /Windows Scheduled Task 常駐安裝/);
  assert.match(source, /查看診斷/);
  assert.match(source, /Startup folder fallback/);
  assert.match(source, /launcherState\.installMode === "temporary-startup-folder"/);
  assert.match(source, /Scheduled Task 狀態/);
  assert.match(source, /Scheduled Task 錯誤/);
  assert.match(source, /inferWorkerStatusReason/);
  assert.match(source, /pid_not_running/);
  assert.match(source, /查看詳情/);
  assert.match(source, /Agent run 已停滯，不是仍在正常執行/);
  assert.match(source, /Run 更新/);
  assert.match(source, /進度更新/);
  assert.match(source, /command output、artifact 或 error/);
  assert.match(source, /這不代表多個 codex\.exe 都在跑同一個 Agent/);
  assert.match(source, /codex\.exe app-server \/ Desktop 子程序/);
  assert.match(source, /Agent 任務子程序會是 codex exec/);
  assert.match(source, /沒有明確 exec activity，只能判定 run 回報停滯/);
  assert.match(source, /同步後重跑 Agent/);
  assert.match(source, /診斷詳情/);
  assert.match(source, /不是 develop 沒拉最新/);
  assert.match(source, /需要更新的是 PR 分支/);
  assert.match(source, /原文技術細節/);
  assert.doesNotMatch(source, /Launcher 目前是暫時啟動模式/);
  assert.doesNotMatch(source, /目前 worker 可以使用，但 Scheduled Task 尚未正式安裝/);
  assert.doesNotMatch(source, /重開機或重新登入後穩定性取決於 Startup/);
});

test("connection setup keeps project selection while reducing setup copy", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /hideLabel\s+label="Azure access token"/);
  assert.match(source, /placeholder="請輸入您的 Azure access token"/);
  assert.doesNotMatch(source, /label="我的 Azure PAT"/);
  assert.doesNotMatch(source, /只送到本機 Launcher，不會送到 \/api\/workers/);
  assert.doesNotMatch(
    source,
    /完成本機 worker 連線、Codex 檢查與專案選擇後，此視窗會自動關閉/,
  );
  assert.match(source, /title="等待回報並選擇本機專案"/);
  assert.match(
    source,
    /grid min-w-0 gap-2 lg:grid-cols-\[minmax\(0,240px\)_minmax\(0,1fr\)\]/,
  );
  assert.match(source, /<RepositoryPicker/);
  assert.match(source, /hideLabel\s+label="選擇本機專案"/);
  assert.doesNotMatch(
    source,
    /detail: "請選擇要交給 Codex 處理的本機專案。"/,
  );
  assert.doesNotMatch(source, /min-h-5 text-xs leading-5 text-slate-500/);
  assert.match(source, /function WorkerConnectionStatus/);
  assert.match(source, /設定 Codex/);
  assert.match(source, /getCompactWorkerConnectionStatus/);
});

test("connection setup and theme changes use transition hooks", () => {
  const workflowSource = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );
  const themeSource = readFileSync(
    new URL("../src/components/theme-controls.tsx", import.meta.url),
    "utf8",
  );
  const cssSource = readFileSync(
    new URL("../src/app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(workflowSource, /setupDialogWelcome/);
  assert.match(workflowSource, /showWelcome/);
  assert.match(workflowSource, /const SETUP_WELCOME_HOLD_MS = 1800/);
  assert.match(workflowSource, /const SETUP_WELCOME_FADE_MS = 520/);
  assert.match(workflowSource, /const \[welcomeClosing, setWelcomeClosing\]/);
  assert.match(
    workflowSource,
    /setWelcomeClosing\(true\)[\s\S]*SETUP_WELCOME_HOLD_MS/,
  );
  assert.match(
    workflowSource,
    /SETUP_WELCOME_HOLD_MS \+[\s\S]*SETUP_WELCOME_FADE_MS/,
  );
  assert.match(workflowSource, /setup-dialog-backdrop-out/);
  assert.match(workflowSource, /setup-welcome-overlay/);
  assert.match(workflowSource, /welcomeClosing \? "setup-welcome-overlay-out"/);
  assert.match(workflowSource, /aria-label="連線完成，歡迎"/);
  assert.match(workflowSource, /setup-welcome-mark/);
  assert.match(workflowSource, /<Sparkles/);
  assert.doesNotMatch(workflowSource, />連線完成<\/div>/);
  assert.match(themeSource, /theme-transitioning/);
  assert.match(themeSource, /runThemeTransition/);
  assert.match(cssSource, /\.setup-dialog-panel-out/);
  assert.match(cssSource, /\.setup-welcome-overlay/);
  assert.match(cssSource, /\.setup-welcome-content/);
  assert.match(cssSource, /\.setup-welcome-mark/);
  assert.match(cssSource, /prefers-reduced-motion: reduce/);
  assert.match(cssSource, /html\.theme-transitioning body/);
});

test("PR traceability actions require a formal trace before Azure PR writes", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const canCreateOrRefreshPr =/);
  assert.match(
    source,
    /canCreateOrRefreshPr =[\s\S]*hasAzurePat[\s\S]*discoveryState !== "loading"[\s\S]*hasFormalPrTrace/,
  );
  assert.match(source, /const canDiscoverPr =/);
  assert.match(
    source,
    /canDiscoverPr =[\s\S]*hasAzurePat[\s\S]*discoveryState !== "loading"[\s\S]*Boolean\(trace\.sourceBranch\)[\s\S]*!hasTrackedPr/,
  );
  assert.match(source, /disabled=\{!canCreateOrRefreshPr\}/);
  assert.match(source, /disabled=\{!canDiscoverPr\}/);
  assert.match(
    source,
    /需先補 Azure 單號，才能建立或追蹤 Azure PR。/,
  );
  assert.match(source, /補充調整/);
  assert.match(
    source,
    /已建立補充調整；同一 Azure Work Item 會更新同一個 PR 分支。/,
  );
  assert.doesNotMatch(source, /另開調整需求/);
  assert.doesNotMatch(source, /已另開調整需求/);
});

test("workflow request records are scoped to the selected repository", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /isRequestForSelectedRepository\(request, selectedRepoPath\)/);
  assert.match(source, /normalizeRepositoryPath\(request\.repoPath\) === normalizedSelectedRepo/);
  assert.match(source, /!selectedExists \|\| selectedVisible/);
  assert.match(source, /const hiddenRequestId = selectedRequestId/);
  assert.match(source, /window\.setTimeout/);
  assert.match(source, /selectedRequestIdRef\.current !== hiddenRequestId/);
  assert.match(source, /setSelectedRequestId\(""\)/);
  assert.match(source, /setDetail\(null\)/);
  assert.match(source, /setStageGate\(null\)/);
});

test("request record titles hide legacy English placeholders", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );
  const workflowSource = readFileSync(
    new URL("../src/lib/control-plane-workflow.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /formatRequestDisplayTitle\(request\)/);
  assert.match(source, /formatRequestDisplayTitle\(selectedRequest\)/);
  assert.match(source, /request \? formatRequestDisplayTitle\(request\) : ""/);
  assert.match(source, /isEnglishPlaceholderTitle/);
  assert.match(source, /未命名需求/);
  assert.match(source, /formatInterpretationSummary\(interpretation\.summary\)/);
  assert.match(source, /isEnglishPlaceholderSummary/);
  assert.match(source, /需求摘要待本機 Codex 重新判讀/);
  assert.doesNotMatch(workflowSource, /short human-readable title/);
  assert.match(workflowSource, /中文可讀標題/);
  assert.match(workflowSource, /中文分類摘要；不要宣稱來源已確認/);
});

test("request intake text does not ask users to repeat selected Azure numbers", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /例：會員搜尋頁按下查詢沒有反應，附截圖；預期顯示符合 login name 的結果。/,
  );
  assert.doesNotMatch(source, /單號 795/);
  assert.match(source, /不需要在需求內容重複填寫/);
  assert.match(source, /建立正式 PR 前需要選擇並驗證 Azure 單號/);
  assert.match(
    source,
    /const azureReference = canUseSelectedWorkItem[\s\S]*requestForm\.azureWorkItemId[\s\S]*: extractAzureReferenceFromDetail\(requestForm\.detail\)/,
  );
});

test("User Story Azure number candidates are visible but not selectable", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /item\?\.type\?\.trim\(\)\.toLowerCase\(\) === "user story"/,
  );
  assert.match(source, /selectedWorkItem\?\.id === requestForm\.azureWorkItemId/);
  assert.match(source, /!isUserStoryCandidate\(selectedWorkItem\)/);
  assert.match(source, /aria-disabled=\{isUserStory \|\| undefined\}/);
  assert.match(source, /cursor-not-allowed bg-amber-100 text-amber-950/);
  assert.match(source, /tabIndex=\{isUserStory \? undefined : 0\}/);
  assert.match(source, /if \(!isUserStory\) \{\s+onSelect\(selected \? "" : item\.id\);/);
  assert.match(source, /User Story 只作需求來源參考，請選 Bug \/ Feature \/ Task 等開發單號。/);
  assert.match(source, /border-amber-500 bg-amber-200 text-amber-950/);
});

test("blocker recovery exposes one rerun Agent action", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );
  const blockerSource = readFileSync(
    new URL("../src/lib/blocker-summary.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /async function rerunAgent/);
  assert.match(source, /hasRecoveryInput \? "clarify_and_retry" : "retry_same_agent"/);
  assert.match(source, /onRerunAgent=\{rerunAgent\}/);
  assert.match(source, /const canRerunAgent = canManualRetry \|\| canClarifyAndRetry/);
  assert.match(source, /重跑 Agent/);
  assert.doesNotMatch(source, /重跑同一 Agent/);
  assert.doesNotMatch(source, /補充後重跑 Agent/);
  assert.doesNotMatch(blockerSource, /重跑同一 Agent/);
});

test("new request tab is blocked while the selected workspace has an active request", () => {
  const source = readFileSync(
    new URL("../src/components/WorkflowControlPlane.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /blockNewRequestForActiveWorkspace/);
  assert.match(source, /formatActiveRequestBlockMessage/);
  assert.match(source, /tab === "new" && blockNewRequestForActiveWorkspace/);
  assert.match(source, /onAbandon=\{abandonCurrentRequest\}/);
});

test("workflow dark mode keeps legacy utility colors readable", () => {
  const source = readFileSync(
    new URL("../src/app/globals.css", import.meta.url),
    "utf8",
  );

  assert(source.includes(".dark .bg-white\\/75"));
  assert(source.includes(".dark .text-blue-600"));
  assert(source.includes(".dark .text-green-900"));
  assert(source.includes(".dark .text-amber-950"));
  assert(source.includes(".dark input"));
  assert(source.includes(".dark textarea"));
  assert(source.includes(".dark input::placeholder"));
});

test("hotfix planning remains documented as pending release policy", () => {
  const operatorGuide = readFileSync(
    new URL("../docs/operator-guide.md", import.meta.url),
    "utf8",
  );
  const futureNotes = readFileSync(
    new URL("../docs/future-phase-notes.md", import.meta.url),
    "utf8",
  );

  assert.match(operatorGuide, /Hotfix planning status/);
  assert.match(operatorGuide, /Formal PR delivery still uses `develop`/);
  assert.match(operatorGuide, /does not decide production release routing/);
  assert.match(operatorGuide, /must not create release branches, deploy, update branch policy/);
  assert.match(futureNotes, /Hotfix Release Target Policy/);
  assert.match(futureNotes, /pending product decision/);
  assert.match(futureNotes, /must not infer production release routing/);
});

test("request-scoped PR create route refreshes existing Azure PR before creating one", () => {
  const routeSource = readFileSync(
    new URL("../src/app/api/requests/[requestId]/pr-create/route.ts", import.meta.url),
    "utf8",
  );
  const launcherSource = readFileSync(
    new URL("../scripts/local-launcher.mjs", import.meta.url),
    "utf8",
  );

  assert.match(routeSource, /findActivePullRequestsForBranches/);
  assert.match(routeSource, /client\.createPullRequest/);
  assert.match(routeSource, /linkPullRequestToWorkflow/);
  assert.match(routeSource, /confirmWrite/);
  assert.match(routeSource, /isTeamPrDeliveryBranch/);
  assert.match(launcherSource, /pr-create/);
});

test("request abandon route uses audit-preserving helper and reports open runs as conflict", () => {
  const routeSource = readFileSync(
    new URL("../src/app/api/requests/[requestId]/abandon/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(routeSource, /abandonWorkflowRequest/);
  assert.match(routeSource, /requestId/);
  assert.match(routeSource, /queued or running/);
  assert.match(routeSource, /status: message\.includes\("queued or running"\) \? 409 : 400/);
});

test("Work Item filter WIQL does not exclude states or types by default", () => {
  const query = buildWorkItemFilterQuery();

  assert.match(query, /\[System.TeamProject\] = @project/);
  assert.doesNotMatch(query, /\[System.State\] <> 'Closed'/);
  assert.doesNotMatch(query, /\[System.State\] <> 'Done'/);
  assert.doesNotMatch(query, /\[System.WorkItemType\]/);
});

test("Work Item filter WIQL applies selected Sprint and escapes quotes", () => {
  const query = buildWorkItemFilterQuery({
    iterationPath: "MT5-Trading-Platform\\Iteration\\Release 'A'\\Sprint 1",
    state: "Done",
    type: "Bug",
    assignedTo: "Michael Chao",
  });

  assert.match(
    query,
    /\[System.IterationPath\] UNDER 'MT5-Trading-Platform\\Release ''A''\\Sprint 1'/,
  );
  assert.match(query, /\[System.State\] = 'Done'/);
  assert.match(query, /\[System.WorkItemType\] = 'Bug'/);
  assert.match(query, /\[System.AssignedTo\] = 'Michael Chao'/);
});

test("Work Item filter WIQL supports project-level queries without Sprint", () => {
  const query = buildWorkItemFilterQuery({ state: "Active" });

  assert.match(query, /\[System.TeamProject\] = @project/);
  assert.match(query, /\[System.State\] = 'Active'/);
  assert.doesNotMatch(query, /\[System.IterationPath\]/);
  assert.doesNotMatch(query, /\[System.State\] <> 'Closed'/);
});

test("Work Item iteration tree normalizer preserves Sprint metadata", () => {
  const normalized = normalizeWorkItemIteration({
    id: 1,
    name: "MT5-Trading-Platform",
    path: "\\MT5-Trading-Platform",
    children: [
      {
        id: 2,
        name: "Sprint 1",
        path: "\\MT5-Trading-Platform\\Iteration\\Sprint 1",
        attributes: {
          startDate: "2026-01-01T00:00:00Z",
          finishDate: "2026-01-15T00:00:00Z",
        },
      },
      {
        id: 3,
        name: "Release 1",
        path: "\\MT5-Trading-Platform\\Release 1",
        children: [
          {
            id: 4,
            name: "Iteration Review",
            path: "\\MT5-Trading-Platform\\Release 1\\Iteration Review",
          },
        ],
      },
    ],
  });

  assert.equal(normalized.path, "MT5-Trading-Platform");
  assert.equal(normalized.children[0].name, "Sprint 1");
  assert.equal(normalized.children[0].path, "MT5-Trading-Platform\\Sprint 1");
  assert.equal(
    normalized.children[0].sourcePath,
    "MT5-Trading-Platform\\Iteration\\Sprint 1",
  );
  assert.equal(normalized.children[0].startDate, "2026-01-01T00:00:00Z");
  assert.equal(normalized.children[0].finishDate, "2026-01-15T00:00:00Z");
  assert.equal(normalized.children[1].path, "MT5-Trading-Platform\\Release 1");
  assert.equal(
    normalized.children[1].children[0].path,
    "MT5-Trading-Platform\\Release 1\\Iteration Review",
  );
});

test("Create PR validation rejects non-AITraining source branches before PAT validation", () => {
  const result = validateCreatePullRequestBody({
    pullRequest: {
      sourceBranch: "bug/775",
      targetBranch: "develop",
      title: "blocked write policy",
      description: buildCreatePullRequestDescription({
        sourceBranch: "bug/775",
        targetBranch: "develop",
      }),
      isDraft: true,
    },
    confirmWrite: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(
    result.error,
    'Testing-stage Azure writes are limited to AITraining/ branches. "bug/775" is read-only.',
  );
});

test("Create PR validation keeps AI_Training read-only during testing stage", () => {
  const result = validateCreatePullRequestBody({
    pullRequest: {
      sourceBranch: "AI_Training/test_p",
      targetBranch: "develop",
      title: "blocked underscore training branch",
      description: buildCreatePullRequestDescription({
        sourceBranch: "AI_Training/test_p",
        targetBranch: "develop",
      }),
      isDraft: true,
    },
    confirmWrite: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(
    result.error,
    'Testing-stage Azure writes are limited to AITraining/ branches. "AI_Training/test_p" is read-only.',
  );
});

test("Create PR validation rejects invalid targets before Azure client work", () => {
  const result = validateCreatePullRequestBody({
    pullRequest: {
      sourceBranch: "AITraining/test_p",
      targetBranch: "AITraining/test-target",
      title: "blocked target",
      description: buildCreatePullRequestDescription({
        sourceBranch: "AITraining/test_p",
        targetBranch: "AITraining/test-target",
      }),
      isDraft: true,
    },
    confirmWrite: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(
    result.error,
    "targetBranch must be a configured protected branch for MVP PR creation.",
  );
});

test("repo rule engine keeps branch targets and stage gate regression-safe", () => {
  assert.equal(getRecommendedTargetBranch("feature/member-filter"), "develop");
  assert.equal(getRecommendedTargetBranch("bug/775"), "develop");
  assert.equal(getRecommendedTargetBranch("hotfix/390"), "develop");
  assert.equal(getRecommendedTargetBranch("AITraining/test_p"), "develop");
  assert.equal(getRecommendedTargetBranch("AI_Training/test_p"), "develop");
  assert.deepEqual(
    getCreatePullRequestWarnings({
      sourceBranch: "hotfix/390",
      targetBranch: "develop",
    }),
    [
      "Hotfix branch target policy is pending until the production release flow is finalized.",
    ],
  );
  assert.deepEqual(
    getCreatePullRequestWarnings({
      sourceBranch: "feature/member-filter",
      targetBranch: "main",
    }),
    ["feature branches should target develop, but the selected target is main."],
  );

  const report = evaluatePullRequestRules(
    samplePullRequest(),
    samplePullRequestDetail({
      linkedWorkItems: [sampleWorkItem()],
      changes: [
        {
          path: "/apps/admin-agent-web/src/pages/member.tsx",
          changeType: "edit",
        },
      ],
    }),
  );

  assert.equal(report.status, "passed");
  assert.equal(report.stageGate.status, "ready");
  assert.equal(report.readiness.decision, "deliverable");
  assert.deepEqual(report.requiredVerification, ["pnpm verify:admin-agent"]);
});

test("repo rule engine blocks missing Work Item and carries request intake into Agent Packet", () => {
  const report = evaluatePullRequestRules(
    samplePullRequest(),
    samplePullRequestDetail({
      linkedWorkItems: [],
      changes: [
        {
          path: "/apps/admin-agent-web/src/pages/member.tsx",
          changeType: "edit",
        },
      ],
    }),
  );
  const intake = createRequestIntakeRecord(
    {
      kind: "REQ",
      title: "Member filter",
      detail: "Add a member filter for operations users.",
      taskLevel: "Level 2",
      azureReferenceType: "pr",
      azureReferenceId: "390",
    },
    new Date(2026, 4, 25, 17, 30),
  );
  const packet = buildAgentPacket(report, intake);

  assert.equal(report.status, "blocked");
  assert.equal(report.stageGate.status, "blocked");
  assert.match(packet, /Request ID: REQ-202605251730-member-filter/);
  assert.match(packet, /## User Request/);
  assert.match(packet, /Add a member filter for operations users\./);
  assert.match(packet, /intake evidence only/);
});

function samplePullRequest(overrides = {}) {
  return {
    id: 390,
    title: "Member filter",
    description: "Existing PR description",
    webUrl: "https://dev.azure.com/odin-tech/project/_git/repo/pullrequest/390",
    status: "active",
    sourceBranch: "feature/member-filter",
    targetBranch: "develop",
    createdBy: "Michael Chao",
    isDraft: false,
    linkedWorkItems: [],
    buildEvidence: [],
    buildEvidenceSourcesChecked: [],
    statuses: [],
    reviewers: [],
    diagnostics: [],
    ...overrides,
  };
}

function samplePullRequestDetail(overrides = {}) {
  return {
    pullRequestId: 390,
    description: "Existing PR description",
    changes: [],
    linkedWorkItems: [],
    latestBuild: undefined,
    buildEvidence: [
      {
        source: "branch-build",
        state: "succeeded",
        label: "Build succeeded",
      },
    ],
    buildEvidenceSourcesChecked: [
      "branch latest build",
      "source commit build",
      "PR statuses",
    ],
    statuses: [],
    reviewers: [],
    diagnostics: [],
    ...overrides,
  };
}

function sampleWorkItem() {
  return {
    id: "795",
    url: "https://dev.azure.com/odin-tech/_apis/wit/workItems/795",
    webUrl:
      "https://dev.azure.com/odin-tech/MT5-Trading-Platform/_workitems/edit/795",
    title: "testing",
    type: "Task",
    state: "New",
  };
}
