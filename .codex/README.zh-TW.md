# Repo AI 協作規範

這份文件是給人類維護者閱讀的中文版規範。AI 入口請看根目錄 `AGENTS.md`；較完整的產品操作背景請看 `docs/operator-guide.md`。

## Repo 定位

- 這個 repo 是 `azure-ai-control-plane`，使用 Next.js 16、React 19、TypeScript strict mode。
- 主要功能是 Azure DevOps / Local Worker Companion / Agent0-3 工作流控制平面。
- 詳細規則應放在 repo 內，讓團隊可以版本控管、review、一起更新；不要把專案細節藏在本機 Codex skill。

## AI 開始工作前要讀什麼

AI 在 coding、debug、review、publish 前，應依序讀：

1. 根目錄 `AGENTS.md`。
2. 與任務相關的 `docs/` 文件，尤其是 `docs/operator-guide.md`。
3. 相關程式碼與測試。
4. 目前 git 狀態，避免覆蓋使用者既有修改。

如果任務涉及 workflow、Azure、Local Worker、PR delivery，不能只看單一元件檔就開始改。

## 驗證指令

常用指令：

```text
pnpm test
pnpm lint
pnpm build
pnpm smoke
```

文件規範類修改，例如只新增或調整 `AGENTS.md` / `.codex` 文件：

- 跑 `git diff --check`。
- 人工快速閱讀 AI 版與中文版，確認沒有互相矛盾。
- 不需要跑 `pnpm test/lint/build/smoke`，除非同時改到程式碼。

實質修改 workflow、routing、readiness、Local Worker、PR delivery、state machine 時：

- 跑 `pnpm test`。
- 跑 `pnpm lint`。
- 跑 `pnpm build`。
- 跑 `pnpm smoke`。

`pnpm smoke` 必須維持 local-first，不可執行 Azure write。若環境有 `AZURE_DEVOPS_PAT`，只能做 read-only Azure 檢查。

## Workflow 基本原則

- 使用者輸入、截圖、瀏覽器 preview 都只是 intake evidence，不是已確認需求。
- Agent0 可以分類與分派，但不能確認需求。
- Agent1 必須檢查 repo 與已確認來源，定義 scope / non-scope / allowed files。
- Agent2 只能實作 Agent1 確認的範圍。
- Agent3 要檢查 Agent2 的 diff、scope compliance、驗證證據，才可交付。
- Agent0 -> Agent1 -> Agent2 -> Agent3 是產品契約，不要任意繞過。

Agent handoff 必須保留結構化欄位：

- Agent1: `Confirmed Requirements`, `Confirmed Scope`, `Allowed Files`, `Non-Scope`, `Do Not Touch`, `Can Proceed`, `Task Package`。
- Agent2: `Changed Files`, `Commands Run`, `Verification Result`, `Scope Compliance`, `Human Decisions`。
- Agent3: `Review Result`, `Scope Compliance`, `Unapproved Changes`, `Verification Result`, `Regression Risk`, `Human Decisions`。

缺少必要欄位時，要視為 blocker；不要從散文描述自行推論 scope。

## Azure 與 PR 安全規則

Azure write 必須同時通過 UI confirmation 與 server-side validation。

目前允許的 MVP writes 只有：

- 建立 Draft PR。
- 在 control-plane marker block 內更新 active PR description。
- 發 active PR readiness comment，且內容要有 control-plane readiness marker。
- 先讀取並確認既有 Azure Boards Work Item 後，把它連到 active PR。

除非產品規則明確改變，AI / App / Local Worker 不可：

- merge PR。
- abandon PR。
- approve / reject / cast review vote。
- deploy。
- 修改 branch policy。
- 建立或刪除 branch。
- 建立 Work Item。
- 更新 Work Item 欄位、狀態、負責人或內容。
- 觸發 build。
- 修改 reviewer。

正式 PR delivery 必須先有 verified Azure Work Item，才能推導 team branch。

正式 team branch 只能是：

- `feature/{workItemId}`
- `bug/{workItemId}`
- `hotfix/{workItemId}`

目標 branch 是 `develop`。branch name 不可加 title、slug、日期或其他 suffix。

`hotfix/{workItemId}` 目前只代表 branch naming；production release routing 還沒決策。不要因此建立 release branch、deploy，或跳過正常 PR gate。

Local Worker 不可把 `origin/develop` merge 或 rebase 到正式 PR branch。若 branch 落後 `origin/develop`，要以 `pr_branch_outdated` block，交由人類更新 branch。

## Local Worker 狀態要分清楚

下列狀態是不同問題，不要合併成籠統的 worker issue：

- heartbeat。
- Codex readiness。
- worker version / hash。
- repo dirty state。
- queued / running / stale run。
- PR branch freshness。

Codex readiness 需要 terminal 可執行的 Codex CLI。WindowsApps 裡的 Codex Desktop executable 是 Desktop 內部執行檔，不算 Local Worker 可用 executor。

repo candidates 由開發者本機 Local Worker 回報，不由瀏覽器掃 filesystem。建立 request 時會 snapshot 當下選到的 repo path；後續 worker dropdown 改變不應影響已建立 request / queued Agent run。

Dirty repo、merge conflict 是 repo-state blocker，不是需求來源不足。Worker version/hash mismatch 或 worker runtime error 是 operational blocker，應更新或重啟 worker 後重跑同一個 Agent。

## 實作守則

- 修改範圍要貼合已確認需求，不做順手的大重構。
- 優先使用現有 helper、state machine、API route、shadcn/Radix 元件與測試模式。
- 沒有明確必要與同意時，不新增 package dependency、不新增 env var、不做 migration、不刪檔、不擴大 shared core module。
- UI 修改要維持 request-first ordinary user flow；diagnostics 與 technical detail 不應進入一般流程，除非產品規則要求。
- blocker 文案要能區分 worker readiness、worker version、dirty repo、branch outdated、缺 verified Azure Work Item、high-risk request、guarded write approval。
- Windows 上新增或修改 agent instruction Markdown 時，使用 `apply_patch`，避免 PowerShell 5.1 寫出 UTF-8 BOM。

## Git / Publish 慣例

- 使用者說 `c+p` 時，在這個 checkout 代表 commit and push。
- publish 前要確認 branch、upstream、diff 與驗證證據。
- 不要 stage / commit 使用者無關修改。
- 大一點的 diff，stage 前跑 `git diff --check`，stage 後跑 `git diff --cached --check`。

## 需要停下來問人的情況

遇到下列情況要停下來問人：

- 需要 MVP 範圍外的 Azure write。
- 需要新的 Azure permission scope。
- 需求、商業規則、API、permission、data model、persistence 或 workflow scope 擴張，但沒有確認來源。
- 需要改環境、裝 package、deploy、刪檔或大型重構。
- shared core module 會被影響，但 scope 不清楚。
- hotfix release target policy 這類產品決策尚未確定。
