export type BlockerSummary = {
  title: string;
  reason: string;
  nextAction: string;
  original: string;
};

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
    normalized.includes("which exact app/page/component") ||
    normalized.includes("target app") ||
    normalized.includes("target surface") ||
    normalized.includes("expected visual result") ||
    normalized.includes("expected visual correction") ||
    normalized.includes("ui-only visual evidence mode")
  ) {
    return {
      title: "缺少 UI 目標與期望結果",
      reason:
        "這筆需求已標記為 UI-only，但 Agent1 還不知道要檢查或修改哪個 app/page/component/URL，也沒有可確認的預期畫面結果。",
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
      title: "缺少設計或 API 來源",
      reason:
        "這類變更可能牽涉設計規格、API 欄位或資料語意，Agent1 需要來源避免自行推測。",
      nextAction:
        "補上 Figma、Swagger、PR、Work Item 或可驗證截圖；UI-only 只適用於受限的視覺修改。",
      original,
    };
  }

  if (normalized === "blocked") {
    return {
      title: "Agent 明確標記為 blocked",
      reason: "Agent 判定目前資訊不足，尚不能安全交給下一階段。",
      nextAction: "查看其他阻擋原因，補齊缺口後重跑同一 Agent。",
      original,
    };
  }

  return {
    title: "需要人工確認",
    reason: "Agent 回報有資訊缺口或風險，主流程暫停以避免錯誤實作。",
    nextAction: "閱讀原文技術細節，補上最小必要資料後重跑同一 Agent。",
    original,
  };
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
