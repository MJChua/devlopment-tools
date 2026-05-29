import assert from "node:assert/strict";
import test from "node:test";

const {
  appendRequestInputTemplate,
  getRequestTemplateCompletenessHints,
  normalizeRequestInputTemplateId,
  recommendRequestInputTemplateId,
} = await import("../src/lib/request-templates.ts");

test("request templates append without overwriting free text", () => {
  const detail = appendRequestInputTemplate("先保留使用者原始描述。", "ui_visual");

  assert.match(detail, /先保留使用者原始描述/);
  assert.match(detail, /## 小幅 UI\/視覺修正/);
  assert.match(detail, /目標 app\/page\/component\/URL/);
});

test("template completeness hints guide UI-only gaps without blocking", () => {
  const hints = getRequestTemplateCompletenessHints({
    detail: "## 小幅 UI/視覺修正\n- 目前畫面：截圖如下",
    evidenceMode: "ui_only",
    templateId: "ui_visual",
  });

  assert.equal(hints.length, 2);
  assert.match(hints[0], /目標 app\/page\/component\/URL/);
  assert.match(hints[1], /預期視覺結果/);

  const completeHints = getRequestTemplateCompletenessHints({
    detail: [
      "## 小幅 UI/視覺修正",
      "- 目標 app/page/component/URL：admin首頁 Header",
      "- 預期結果：角色文字顯示 Admin",
    ].join("\n"),
    evidenceMode: "ui_only",
    templateId: "ui_visual",
  });

  assert.deepEqual(completeHints, []);
});

test("template id normalizer and recommendation stay conservative", () => {
  assert.equal(normalizeRequestInputTemplateId("bad"), "freeform");
  assert.equal(recommendRequestInputTemplateId("ui_only"), "ui_visual");
  assert.equal(recommendRequestInputTemplateId("standard"), "freeform");
});
