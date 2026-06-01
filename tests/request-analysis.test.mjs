import assert from "node:assert/strict";
import test from "node:test";

const {
  WORKER_INTERPRETATION_END_MARKER,
  WORKER_INTERPRETATION_START_MARKER,
  analyzeNaturalLanguageRequest,
  extractWorkerInterpretationFromText,
  inferTitle,
} = await import("../src/lib/request-analysis.ts");

test("request analysis lets low-risk bug reports use user evidence and repo inspection", () => {
  const analysis = analyzeNaturalLanguageRequest(
    "會員搜尋頁面按下查詢沒有反應，附截圖；預期顯示符合 login name 的結果。",
  );

  assert.equal(analysis.kind, "BUG");
  assert.equal(analysis.source, "provisional");
  assert.equal(analysis.taskLevel, "Level 1");
  assert.match(analysis.title, /會員搜尋頁面/);
  assert.deepEqual(analysis.missingSources, []);
  assert.match(analysis.sourceWarnings.join("\n"), /repo inspection/);
  assert.equal(analysis.riskFlags.length, 0);
});

test("request analysis still asks for external contracts for API changes", () => {
  const analysis = analyzeNaturalLanguageRequest(
    "會員搜尋頁面需要新增 login name 篩選，可能需要 API 欄位確認。",
  );

  assert.equal(analysis.kind, "REQ");
  assert(analysis.missingSources.includes("Swagger / API contract source"));
  assert(!analysis.missingSources.includes("Figma / UI behavior source"));
  assert(!analysis.missingSources.includes("QA TestCase or provisional verification checklist"));
});

test("request analysis classifies explicit hotfix requests", () => {
  const analysis = analyzeNaturalLanguageRequest(
    "Hotfix Work Item 390: urgent production fix for login screen crash.",
  );

  assert.equal(analysis.kind, "HOTFIX");
  assert.equal(analysis.taskLevel, "Level 1");
});

test("request analysis extracts worker/Codex interpretation markers", () => {
  const analysis = extractWorkerInterpretationFromText(
    [
      "Codex result",
      WORKER_INTERPRETATION_START_MARKER,
      JSON.stringify({
        title: "Worker classified member filter",
        kind: "REQ",
        taskLevel: "Level 2",
        summary: "Worker interpreted the request.",
        suggestedNextAgent: "agent1",
        missingSources: ["Spec confirmation"],
        sourceWarnings: ["Not confirmed QA."],
        riskFlags: [],
        guardrails: ["Do not invent API fields."],
      }),
      WORKER_INTERPRETATION_END_MARKER,
    ].join("\n"),
    "member filter",
  );

  assert.equal(analysis?.source, "worker");
  assert.equal(analysis?.title, "Worker classified member filter");
  assert.equal(analysis?.taskLevel, "Level 2");
  assert.deepEqual(analysis?.missingSources, ["Spec confirmation"]);
});

test("request analysis blocks high-risk operation intent", () => {
  const analysis = analyzeNaturalLanguageRequest(
    "請自動 merge PR 並 deploy 到正式環境。",
  );

  assert.equal(analysis.taskLevel, "Level 3");
  assert.match(analysis.riskFlags.join("\n"), /PR state mutation/);
  assert.match(analysis.riskFlags.join("\n"), /Deploy/);
});

test("title inference keeps natural language short and readable", () => {
  assert.equal(
    inferTitle("  # 新增會員篩選條件，並保留現有查詢條件\n更多內容"),
    "新增會員篩選條件，並保留現有查詢條件",
  );
});
