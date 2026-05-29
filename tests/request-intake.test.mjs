import assert from "node:assert/strict";
import test from "node:test";

const {
  buildAgent0DispatchPrompt,
  createRequestId,
  createRequestIntakeRecord,
  parseRequestIntakeRecords,
  serializeRequestIntakeRecords,
  slugifyRequestTitle,
} = await import("../src/lib/request-intake.ts");

test("creates stable request ids from kind, local timestamp, and slug", () => {
  const createdAt = new Date(2026, 4, 25, 14, 30);

  assert.equal(
    createRequestId("REQ", "Member Filter", createdAt),
    "REQ-202605251430-member-filter",
  );
});

test("slug fallback keeps request ids valid when title has no ascii token", () => {
  assert.equal(slugifyRequestTitle("會員查詢"), "request");
});

test("local record parsing falls back safely and drops non-record fields", () => {
  const record = createRequestIntakeRecord(
    {
      kind: "BUG",
      title: "Build status bug",
      detail: "Build status should show missing evidence clearly.",
      taskLevel: "Level 1",
      azureReferenceType: "work-item",
      azureReferenceId: "795",
    },
    new Date(2026, 4, 25, 15, 5),
  );
  const serialized = JSON.stringify([{ ...record, pat: "secret-token" }]);

  assert.deepEqual(parseRequestIntakeRecords("not-json"), []);
  assert.deepEqual(parseRequestIntakeRecords(JSON.stringify({ record })), []);

  const parsed = parseRequestIntakeRecords(serialized);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].requestId, "BUG-202605251505-build-status-bug");
  assert.equal(Object.hasOwn(parsed[0], "pat"), false);
});

test("serialization caps records and excludes unexpected fields", () => {
  const records = Array.from({ length: 22 }, (_, index) => ({
    kind: "REQ",
    title: `Request ${index}`,
    detail: `Detail ${index}`,
    taskLevel: "Level 2",
    azureReferenceType: "none",
    azureReferenceId: "",
    requestId: `REQ-2026052514${String(index).padStart(2, "0")}-request-${index}`,
    createdAt: new Date(2026, 4, 25, 14, index).toISOString(),
    pat: "secret-token",
  }));

  const parsed = JSON.parse(serializeRequestIntakeRecords(records));
  assert.equal(parsed.length, 20);
  assert.equal(Object.hasOwn(parsed[0], "pat"), false);
});

test("Agent0 prompt includes intake context and stop rules", () => {
  const record = createRequestIntakeRecord(
    {
      kind: "REQ",
      title: "Member filter",
      detail: "Add a member search filter.",
      taskLevel: "Level 2",
      azureReferenceType: "pr",
      azureReferenceId: "390",
    },
    new Date(2026, 4, 25, 16, 45),
  );
  const prompt = buildAgent0DispatchPrompt(record);

  assert.match(prompt, /Request ID: REQ-202605251645-member-filter/);
  assert.match(prompt, /Task Level: Level 2/);
  assert.match(prompt, /Azure PR #390/);
  assert.match(prompt, /Add a member search filter\./);
  assert.match(prompt, /not confirmed Spec, Figma, Swagger\/API, QA/);
  assert.match(prompt, /stop and report it/);
});

test("Agent0 prompt maps Azure Work Item reference to 單號", () => {
  const record = createRequestIntakeRecord(
    {
      kind: "BUG",
      title: "Member filter bug",
      detail: "Fix member filter.",
      taskLevel: "Level 1",
      azureReferenceType: "work-item",
      azureReferenceId: "795",
    },
    new Date(2026, 4, 25, 16, 50),
  );
  const prompt = buildAgent0DispatchPrompt(record);

  assert.match(prompt, /Azure 單號: 795/);
});
