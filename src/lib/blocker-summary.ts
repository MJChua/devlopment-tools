export type BlockerSummary = {
  title: string;
  reason: string;
  nextAction: string;
  original: string;
  kind?: string;
  details?: { label: string; value: string }[];
  warnings?: string[];
};

type PrBranchOutdatedDiagnostic = {
  kind: "pr_branch_outdated";
  sourceBranch?: string;
  baseBranch?: string;
  sourceSha?: string;
  baseSha?: string;
  aheadCount?: number | null;
  behindCount?: number | null;
  worktreePath?: string;
  changedFiles?: string[];
  currentBranch?: string;
};

const blockerDiagnosticStart = "CONTROL_PLANE_BLOCKER_DIAGNOSTIC_START";
const blockerDiagnosticEnd = "CONTROL_PLANE_BLOCKER_DIAGNOSTIC_END";

export function summarizeStageGateBlockers(items: string[]): BlockerSummary[] {
  const summaries = items
    .flatMap(splitBlockerItem)
    .filter((item) => item.trim().length > 0)
    .map(summarizeStageGateBlocker);
  const merged = new Map<string, BlockerSummary>();

  for (const summary of summaries) {
    const key = `${summary.title}\n${summary.reason}\n${summary.nextAction}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, summary);
      continue;
    }

    const originals = new Set(
      current.original
        .split("\n\n---\n\n")
        .concat(summary.original)
        .map((item) => item.trim())
        .filter(Boolean),
    );
    merged.set(key, {
      ...current,
      original: [...originals].join("\n\n---\n\n"),
    });
  }

  return [...merged.values()];
}

export function summarizeStageGateBlocker(item: string): BlockerSummary {
  const original = item.trim();
  const normalized = original.toLowerCase();
  const diagnostic = parseBlockerDiagnostic(original);

  if (diagnostic?.kind === "pr_branch_outdated") {
    return summarizePrBranchOutdatedDiagnostic(original, diagnostic);
  }

  if (
    normalized.includes("verified azure work item") ||
    (normalized.includes("formal pr branch") &&
      normalized.includes("azure work item"))
  ) {
    return {
      title: "Azure 單號尚未驗證",
      reason:
        "Draft PR 分支只能使用已讀取並確認的 Azure Work Item；文字中解析出的單號只能當 tracking reference。",
      nextAction:
        "選取可讀取的 Azure Work Item，或修正 Azure 權限後重跑同一流程。",
      original,
    };
  }

  if (
    normalized.includes("azure work item") &&
    (normalized.includes("not confirmed") ||
      normalized.includes("tracking") ||
      normalized.includes("only id"))
  ) {
    return {
      title: "Azure 單號尚未驗證",
      reason:
        "目前只有單號可追蹤，App 尚未讀到 Work Item 的標題、狀態或內容，因此 Agent1 不能把它當成已確認來源。",
      nextAction:
        "確認 Azure 權限後重新送出或重跑；若讀不到內容，補上截圖、單號內容摘要，或把它視為 tracking reference。",
      original,
    };
  }

  if (
    normalized.includes("agent0 handoff is incomplete") ||
    normalized.includes("handoff is incomplete") ||
    normalized.includes("missing required fields")
  ) {
    return {
      title: "前一階段輸出不完整",
      reason:
        "下一個 Agent 需要結構化 handoff 才能安全接續；缺欄位時不能猜測 scope 或來源。",
      nextAction:
        "先使用「重新同步 Agent 輸出」；若仍缺欄位，再重跑同一個 Agent。",
      original,
    };
  }

  if (
    normalized.includes("worker_offline") ||
    normalized.includes("worker has not picked up") ||
    normalized.includes("still queued") ||
    normalized.includes("尚未領取")
  ) {
    return {
      title: "Worker 已停止，Agent 尚未開始",
      reason: "Agent run 還在 queued，沒有真正開始執行。",
      nextAction: "按「重啟 Worker」，保留同一筆 run 接續處理。",
      original,
    };
  }

  if (
    normalized.includes("worker_internal_error") ||
    normalized.includes("referenceerror") ||
    normalized.includes("is not defined")
  ) {
    return {
      title: "Worker 內部錯誤",
      reason:
        "流程是在本機 Worker 自己的執行或收尾邏輯中斷，尚未變成真正的 Agent 判斷結果。",
      nextAction:
        "先更新/重啟 Worker，然後重跑同一個 Agent；如果仍出現同一個內部錯誤，表示 App 提供的 worker bundle 需要修復。",
      original,
    };
  }

  if (
    normalized.includes("worker_version_mismatch") ||
    normalized.includes("worker 版本不同步") ||
    normalized.includes("worker version") ||
    normalized.includes("worker script integrity mismatch") ||
    (normalized.includes("worker_runtime_error") &&
      (normalized.includes("版本不同步") ||
        normalized.includes("script hash") ||
        normalized.includes("worker hash")))
  ) {
    return {
      title: "本機 Worker 版本不同步",
      reason:
        "App 期望的 Worker 版本或腳本 hash 與本機正在執行的 Worker 不一致，流程需要先同步本機 Worker。",
      nextAction:
        "按「重新下載並重啟 Worker」，完成後重跑同一個 Agent，不需要重新輸入需求。",
      original,
    };
  }

  if (
    normalized.includes("git_remote_unreachable") ||
    normalized.includes("git fetch origin failed") ||
    normalized.includes("git ls-remote origin") ||
    ((normalized.includes("ssh.dev.azure.com") ||
      normalized.includes("could not read from remote repository") ||
      normalized.includes("could not read username") ||
      normalized.includes("authentication failed") ||
      normalized.includes("permission denied (publickey)") ||
      normalized.includes("connection timed out")) &&
      normalized.includes("origin"))
  ) {
    return {
      title: "Git remote cannot be reached",
      reason:
        "Local Worker is connected, but the selected repository cannot read origin/develop from its Git remote.",
      nextAction:
        "Fix VPN/firewall/SSH key/credentials, or manually switch this repository remote to HTTPS, then rerun the same Agent.",
      original,
      kind: "git_remote_unreachable",
      details: getGitRemoteBlockerDetails(original),
    };
  }

  if (
    normalized.includes("repo_dirty_blocked") ||
    normalized.includes("uncommitted changes") ||
    normalized.includes("本機 repo 目前有未提交異動") ||
    normalized.includes("merge conflict")
  ) {
    return {
      title: "本機 repo 狀態不乾淨",
      reason:
        "正式 PR 流程需要從乾淨分支開始，避免把其他需求或舊變更一起帶進這次 request。",
      nextAction:
        "先 commit、stash 或清掉不屬於本需求的異動；如果是 conflict，先解完再重跑同一個 Agent。",
      original,
    };
  }

  if (
    normalized.includes("pr_branch_outdated") ||
    (normalized.includes("behind origin/develop") &&
      normalized.includes("will not merge or rebase"))
  ) {
    return {
      title: "PR 分支尚未更新到 origin/develop",
      reason:
        "這通常不是本機 develop 沒有拉到最新；阻擋點是正式 PR 分支尚未包含最新 base branch。",
      nextAction:
        "到 Azure Repos 或列出的本機工作區更新 PR 分支，確認乾淨後重跑 Agent2。",
      original,
      kind: "pr_branch_outdated",
    };
  }

  if (
    normalized.includes("agent3 delivery review blocked") ||
    normalized.includes("delivery review blocked") ||
    normalized.includes("pr-ready") ||
    normalized.includes("pr readiness") ||
    normalized.includes("branch") ||
    normalized.includes("unrelated")
  ) {
    return {
      title: "PR 交付範圍不乾淨",
      reason:
        "Agent3 檢查到目前 branch、diff 或未核准變更含有非本需求內容，因此不能把這筆需求標成可發 PR。",
      nextAction:
        "切到乾淨的本機工作區需求分支，保留本需求變更後再重跑 Agent3。",
      original,
    };
  }

  if (
    normalized.includes("missing confirmed spec") ||
    normalized.includes("business rule") ||
    normalized.includes("no confirmed product") ||
    normalized.includes("confirmed source")
  ) {
    return {
      title: "缺少可驗證規格或業務規則",
      reason:
        "Agent1 沒有足夠來源確認需求是否為正式規格、bug 修正或允許的變更範圍。",
      nextAction:
        "補上可讀來源。若只是 copy、顏色、間距、位置或簡單狀態樣式，改用「小幅 UI/視覺修正」並附截圖。",
      original,
    };
  }

  if (
    normalized.includes("login identity") ||
    normalized.includes("requested display") ||
    normalized.includes("role mapping") ||
    normalized.includes("agent/admin") ||
    normalized.includes("mapping")
  ) {
    return {
      title: "角色文字對應不明",
      reason:
        "需求中的顯示文字與程式內既有身分值不一定一一對應，直接實作可能造成權限或顯示語意錯誤。",
      nextAction:
        "只補一個明確答案：畫面上的 Agent/Admin 分別要對應哪個既有登入身分或資料欄位。",
      original,
    };
  }

  if (
    (normalized.includes("multiple plausible") ||
      normalized.includes("multiple candidate") ||
      normalized.includes("repository inspection found multiple") ||
      normalized.includes("apps/admin-agent-web") ||
      normalized.includes("apps/admin-hq-web") ||
      normalized.includes("apps/trader-web")) &&
    (normalized.includes("target surface") ||
      normalized.includes("topbar") ||
      normalized.includes("header") ||
      normalized.includes("screen"))
  ) {
    return {
      title: "需要選擇目標子專案或畫面",
      reason:
        "Agent1 已經在 repo 裡找到多個合理位置，不能自己猜要改哪一個，否則可能改錯子專案或頁面。",
      nextAction:
        "直接選一個目標，例如 admin-agent、admin-hq、trader，或補上明確 app/page/component。",
      original,
    };
  }

  if (
    normalized.includes("logout") &&
    (normalized.includes("after") ||
      normalized.includes("before") ||
      normalized.includes("rightmost") ||
      normalized.includes("final control"))
  ) {
    return {
      title: "需要確認放置位置",
      reason:
        "Agent1 不確定新內容要放在登出按鈕後面成為最右側，還是放在登出按鈕前面並保留登出為最後一個控制項。",
      nextAction:
        "補一句位置決定，例如「MJ 放在登出後面」或「MJ 放在登出前面」。",
      original,
    };
  }

  if (
    normalized.includes("which exact app/page/component") ||
    normalized.includes("target app") ||
    normalized.includes("target surface") ||
    normalized.includes("expected visual result") ||
    normalized.includes("expected visual correction") ||
    normalized.includes("ui-only visual evidence mode")
  ) {
    const isVisualOnly =
      normalized.includes("ui-only") ||
      normalized.includes("visual evidence") ||
      normalized.includes("visually check") ||
      normalized.includes("expected visual");
    return {
      title: isVisualOnly ? "缺少 UI 目標與期望結果" : "缺少目標畫面或元件",
      reason: isVisualOnly
        ? "這筆需求已標記為 UI-only，但 Agent1 還不知道要檢查或修改哪個 app/page/component/URL，也沒有可確認的預期畫面結果。"
        : "Agent1 需要知道實際要改哪個 app/page/component/URL，才能限制 Agent2 的檔案範圍並避免改錯地方。",
      nextAction:
        "補上目標 app/page/component/URL，以及預期 copy、顏色、間距、位置、簡單狀態樣式或截圖。",
      original,
    };
  }

  if (
    normalized.includes("figma") ||
    normalized.includes("swagger") ||
    normalized.includes("api")
  ) {
    return {
      title: "缺少外部契約或高風險來源",
      reason:
        "只有牽涉 API、權限、資料、商業規則或跨頁流程時，Agent1 才需要外部來源避免自行推測。",
      nextAction:
        "補上最小必要 API/權限/資料來源；一般 bug 或視覺修正補目標、預期結果、截圖或重現描述即可。",
      original,
    };
  }

  if (normalized === "blocked") {
    return {
      title: "Agent 明確標記為 blocked",
      reason: "Agent 判定目前資訊不足，尚不能安全交給下一階段。",
      nextAction: "查看其他阻擋原因，補齊缺口後重跑 Agent。",
      original,
    };
  }

  return {
    title: "需要人工確認",
    reason: "Agent 回報有資訊缺口或風險，主流程暫停以避免錯誤實作。",
    nextAction: "閱讀原文技術細節，補上最小必要資料後重跑 Agent。",
    original,
  };
}

function summarizePrBranchOutdatedDiagnostic(
  original: string,
  diagnostic: PrBranchOutdatedDiagnostic,
): BlockerSummary {
  const sourceBranch = diagnostic.sourceBranch || "PR 分支";
  const baseBranch = diagnostic.baseBranch || "origin/develop";
  const details = [
    { label: "需要更新的是", value: sourceBranch },
    { label: "Base branch", value: baseBranch },
    diagnostic.behindCount != null
      ? { label: `落後 ${baseBranch}`, value: `${diagnostic.behindCount} commits` }
      : null,
    diagnostic.aheadCount != null
      ? { label: "PR 分支 ahead", value: `${diagnostic.aheadCount} commits` }
      : null,
    diagnostic.worktreePath
      ? { label: "要處理的位置", value: diagnostic.worktreePath }
      : null,
    diagnostic.currentBranch
      ? { label: "目前分支", value: diagnostic.currentBranch }
      : null,
    diagnostic.changedFiles?.length
      ? {
          label: "目前分支變更檔案",
          value: formatChangedFiles(diagnostic.changedFiles),
        }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));
  const warnings = diagnostic.changedFiles?.length
    ? ["此 PR 分支可能是舊需求分支，請確認是否要重用。"]
    : undefined;

  return {
    title: `PR 分支 ${sourceBranch} 尚未更新到 ${baseBranch}`,
    reason:
      `不是本機 develop 沒更新。阻擋點是正式 PR 分支 ${sourceBranch} 尚未包含最新 ${baseBranch}。`,
    nextAction:
      `到列出的本機工作區或 Azure Repos 更新 ${sourceBranch}，確認乾淨後重跑 Agent2。`,
    original,
    kind: "pr_branch_outdated",
    details,
    warnings,
  };
}

function getGitRemoteBlockerDetails(original: string) {
  const details: { label: string; value: string }[] = [];
  const reason = original.match(/git_remote_unreachable:[^(]*\(([^)]+)\)/i)?.[1];
  if (reason) {
    details.push({ label: "Reason", value: reason });
  }

  const endpoint =
    original.match(/\bhost\s+([a-z0-9.-]+\.[a-z0-9.-]+)\s+port\s+(\d+)\b/i) ??
    original.match(/\b([a-z0-9.-]+\.[a-z0-9.-]+):(\d+)\b/i);
  if (endpoint) {
    details.push({ label: "Endpoint", value: `${endpoint[1]}:${endpoint[2]}` });
  }

  return details;
}

function parseBlockerDiagnostic(
  value: string,
): PrBranchOutdatedDiagnostic | null {
  const start = value.indexOf(blockerDiagnosticStart);
  const end = value.indexOf(blockerDiagnosticEnd);
  if (start < 0 || end < 0 || end <= start) {
    return null;
  }

  const json = value
    .slice(start + blockerDiagnosticStart.length, end)
    .trim();
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isPrBranchOutdatedDiagnostic(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function isPrBranchOutdatedDiagnostic(
  value: unknown,
): value is PrBranchOutdatedDiagnostic {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (value as { kind?: unknown }).kind === "pr_branch_outdated";
}

function formatChangedFiles(files: string[]) {
  const visible = files.slice(0, 5).join(", ");
  if (files.length <= 5) {
    return visible;
  }

  return `${visible}，另 ${files.length - 5} 個`;
}

function splitBlockerItem(item: string) {
  const normalized = item.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const withoutPrefix = normalized.replace(
    /^Agent\d+\s+source check cannot proceed:\s*/i,
    "",
  );
  const parts = withoutPrefix.split(/\n\s*-\s+|:\s*-\s+/);
  if (parts.length === 1) {
    return [withoutPrefix.replace(/^\s*-\s+/, "")];
  }

  return parts.map((part) => part.replace(/^\s*-\s+/, "").trim());
}
