export const REQUEST_INPUT_TEMPLATE_IDS = [
  "freeform",
  "ui_visual",
  "bug_fix",
  "feature_change",
  "api_permission_data",
] as const;

export type RequestInputTemplateId = (typeof REQUEST_INPUT_TEMPLATE_IDS)[number];

export type RequestInputTemplate = {
  id: RequestInputTemplateId;
  label: string;
  description: string;
  body: string;
};

export const REQUEST_INPUT_TEMPLATES: RequestInputTemplate[] = [
  {
    id: "freeform",
    label: "自由輸入",
    description: "不套用模板，保留自然語言描述。",
    body: "",
  },
  {
    id: "ui_visual",
    label: "小幅 UI/視覺修正",
    description: "適用 copy、顏色、間距、位置、簡單狀態樣式。",
    body: [
      "## 小幅 UI/視覺修正",
      "- 目標 app/page/component/URL：",
      "- 目前畫面：",
      "- 預期結果：",
      "- 可改範圍：",
      "- 不包含事項：API、權限、資料模型、商業規則、跨頁流程",
      "- 可驗證截圖或來源：",
    ].join("\n"),
  },
  {
    id: "bug_fix",
    label: "Bug 修復",
    description: "適用 QA bug、重現步驟、預期和實際行為落差。",
    body: [
      "## Bug 修復",
      "- 現象：",
      "- 重現步驟：",
      "- 預期行為：",
      "- 實際行為：",
      "- 影響範圍：",
      "- 可驗證來源：",
    ].join("\n"),
  },
  {
    id: "feature_change",
    label: "功能/需求變更",
    description: "適用新增或調整功能行為。",
    body: [
      "## 功能/需求變更",
      "- 目標：",
      "- 現況：",
      "- 期望行為：",
      "- 來源依據：",
      "- 限制與非範圍：",
      "- 驗證方式：",
    ].join("\n"),
  },
  {
    id: "api_permission_data",
    label: "API/權限/資料相關",
    description: "適用 API 欄位、角色 mapping、資料來源或權限語意。",
    body: [
      "## API/權限/資料相關",
      "- 來源文件/API：",
      "- 角色 mapping：",
      "- 資料欄位：",
      "- 權限語意：",
      "- 資料來源或同步方式：",
      "- 驗證方式：",
    ].join("\n"),
  },
];

const TEMPLATE_BY_ID = new Map(
  REQUEST_INPUT_TEMPLATES.map((template) => [template.id, template]),
);

export function normalizeRequestInputTemplateId(
  value: unknown,
): RequestInputTemplateId {
  return REQUEST_INPUT_TEMPLATE_IDS.includes(value as RequestInputTemplateId)
    ? (value as RequestInputTemplateId)
    : "freeform";
}

export function getRequestInputTemplate(id: unknown) {
  return TEMPLATE_BY_ID.get(normalizeRequestInputTemplateId(id)) ??
    REQUEST_INPUT_TEMPLATES[0];
}

export function recommendRequestInputTemplateId(evidenceMode: unknown) {
  return evidenceMode === "ui_only" ? "ui_visual" : "freeform";
}

export function appendRequestInputTemplate(
  detail: string,
  templateId: RequestInputTemplateId,
) {
  const template = getRequestInputTemplate(templateId);
  if (!template.body) {
    return detail;
  }

  const current = detail.trimEnd();
  if (current.includes(template.body.split("\n")[0])) {
    return detail;
  }

  return current ? `${current}\n\n${template.body}` : template.body;
}

export function getRequestTemplateCompletenessHints(input: {
  detail: string;
  evidenceMode: unknown;
  templateId?: unknown;
}) {
  const detail = input.detail.trim();
  const normalizedDetail = detail.toLowerCase();
  const templateId = normalizeRequestInputTemplateId(input.templateId);
  const hints: string[] = [];

  if (input.evidenceMode === "ui_only" || templateId === "ui_visual") {
    if (
      !hasFilledLine(detail, "目標 app/page/component/URL") &&
      !normalizedDetail.includes("url") &&
      !normalizedDetail.includes("component")
    ) {
      hints.push("可選補充：目標 app/page/component/URL。");
    }

    if (
      !hasFilledLine(detail, "預期結果") &&
      !normalizedDetail.includes("expected")
    ) {
      hints.push("可選補充：預期視覺結果或對照截圖。");
    }
  }

  return hints;
}

function hasFilledLine(detail: string, label: string) {
  const line = detail
    .split(/\r?\n/)
    .find((item) => item.includes(label));
  if (!line) {
    return false;
  }

  const [, value = ""] = line.split(/[:：]/, 2);
  return value.trim().length > 0;
}
