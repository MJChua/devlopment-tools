const appUrl = process.env.CONTROL_PLANE_URL ?? "http://localhost:3000";
const pat = process.env.AZURE_DEVOPS_PAT ?? process.env.AZURE_PAT ?? "";
const defaultConfig = {
  orgUrl: process.env.AZURE_ORG_URL ?? "https://dev.azure.com/odin-tech",
  project: process.env.AZURE_PROJECT ?? "MT5-Trading-Platform",
  repository: process.env.AZURE_REPOSITORY ?? "odin-mt5-web",
};

const results = [];

await checkAppShell();
await checkLocalRepositoryScan();
await checkWorkerReadinessRecheck();
await checkWorkerStop();
await checkWorkflowRoundTrip();
await checkNoPrWorkflowRoundTrip();
await checkWritePolicyGuard();

if (pat) {
  await checkAzureOverview();
} else {
  results.push({
    name: "Azure read-only overview",
    status: "skip",
    detail: "Set AZURE_DEVOPS_PAT to include live Azure read evidence.",
  });
}

for (const result of results) {
  const prefix =
    result.status === "pass"
      ? "PASS"
      : result.status === "skip"
        ? "SKIP"
        : "FAIL";
  console.log(`${prefix} ${result.name}: ${result.detail}`);
}

const failed = results.filter((result) => result.status === "fail");
if (failed.length > 0) {
  process.exitCode = 1;
}

async function checkAppShell() {
  try {
    const response = await fetch(`${appUrl}/`);
    const text = await response.text();
    assert(
      response.ok && text.includes("Codex 任務控制台"),
      `expected app shell, got HTTP ${response.status}`,
    );
    pass("App shell", `HTTP ${response.status}`);
  } catch (error) {
    fail("App shell", formatError(error));
  }
}

async function checkWorkflowRoundTrip() {
  const suffix = Date.now();
  const workerId = `smoke-worker-${suffix}`;
  let token = "";
  let requestId = "";
  const interpretationOutput = [
    "CONTROL_PLANE_INTERPRETATION_START",
    JSON.stringify({
      title: "Smoke interpreted request",
      kind: "REQ",
      taskLevel: "Level 1",
      summary: "Worker/Codex interpreted the smoke request.",
      suggestedNextAgent: "agent1",
      missingSources: ["Spec / business rule confirmation"],
      sourceWarnings: ["Smoke interpretation is not confirmed source evidence."],
      riskFlags: [],
      guardrails: ["Do not invent requirements."],
    }),
    "CONTROL_PLANE_INTERPRETATION_END",
  ].join("\n");

  try {
    const workerResponse = await postJson("/api/workers", {
      workerId,
      displayName: "Smoke Worker",
      repoPath: process.cwd(),
      autoCommitAndPr: true,
      azurePat: "pat_must_not_be_returned_or_stored",
      commandTemplate: [
        "node -e",
        JSON.stringify(
          "console.log(process.env.SMOKE_INTERPRETATION_OUTPUT)",
        ),
      ].join(" "),
    });
    token = workerResponse.worker.token;
    assert(token, "worker token was not returned");
    assert(
      workerResponse.worker.autoCommitAndPr === true,
      "worker auto commit / PR preference was not persisted",
    );
    assert(
      !JSON.stringify(workerResponse.worker).includes("pat_must_not_be_returned_or_stored"),
      "worker response leaked Azure PAT",
    );
    await reportWorkerReady(workerId, token);

    const requestResponse = await postJson("/api/requests", {
      kind: "REQ",
      title: `Smoke workflow ${suffix}`,
      detail: "Verify request to worker round trip without Azure writes.",
      taskLevel: "Level 2",
      owner: "smoke",
      assignedWorkerId: workerId,
      azureReferenceType: "none",
      azureReferenceId: "",
    });
    requestId = requestResponse.request.requestId;

    await postJson(`/api/requests/${requestId}/dispatch`, {
      actor: "smoke",
    });

    const pollResponse = await fetch(`${appUrl}/api/workers/poll`, {
      headers: workerHeaders(workerId, token),
    });
    const pollBody = await pollResponse.json();
    assert(pollResponse.ok && pollBody.run, "worker did not receive a run");

    await completeWorkerRun(workerId, token, pollBody.run, {
      commandOutput: interpretationOutput,
      artifact: "# Smoke Artifact\n\nCompleted.",
    });

    const detailResponse = await fetch(`${appUrl}/api/requests/${requestId}`);
    const detail = await detailResponse.json();
    assert(
      detailResponse.ok &&
        detail.detail.request.status === "source_check" &&
        detail.detail.runs.length === 2 &&
        detail.detail.runs.some(
          (run) => run.agentRole === "agent1" && run.status === "queued",
        ) &&
        detail.detail.request.interpretation.source === "worker",
      "workflow detail did not auto-dispatch Agent1 after worker completion",
    );

    pass("Workflow worker round trip", `${requestId} completed Agent0 and queued Agent1`);
  } catch (error) {
    fail("Workflow worker round trip", formatError(error));
  }
}

async function checkNoPrWorkflowRoundTrip() {
  const suffix = Date.now();
  const workerId = `smoke-no-pr-worker-${suffix}`;

  try {
    const workerResponse = await postJson("/api/workers", {
      workerId,
      displayName: "Smoke No PR Worker",
      repoPath: process.cwd(),
      commandTemplate: "echo ok",
    });
    const token = workerResponse.worker.token;
    await reportWorkerReady(workerId, token);

    const requestResponse = await postJson("/api/requests", {
      kind: "REQ",
      title: `Smoke no PR workflow ${suffix}`,
      detail: "Verify no-PR delivery runs through review and completes.",
      taskLevel: "Level 1",
      owner: "smoke",
      assignedWorkerId: workerId,
      repoPath: process.cwd(),
      deliveryMode: "no_pr",
      azureReferenceType: "none",
      azureReferenceId: "",
    });
    const requestId = requestResponse.request.requestId;

    await postJson(`/api/requests/${requestId}/dispatch`, {
      actor: "smoke",
    });

    for (const agentRole of ["agent0", "agent1", "agent2", "agent3"]) {
      const run = await pollWorkerForRun(workerId, token, agentRole);
      await completeWorkerRun(workerId, token, run, {
        commandOutput:
          agentRole === "agent0"
            ? buildSmokeInterpretationOutput()
            : `${agentRole} completed`,
        artifact: buildSmokeAgentArtifact(agentRole),
      });
    }

    const detailResponse = await fetch(`${appUrl}/api/requests/${requestId}`);
    const detail = await detailResponse.json();
    assert(
      detailResponse.ok &&
        detail.detail.request.deliveryMode === "no_pr" &&
        detail.detail.request.status === "delivered" &&
        detail.detail.runs.length === 4,
      "no-PR workflow did not deliver after Agent3",
    );

    pass("No-PR workflow delivery", `${requestId} delivered without PR`);
  } catch (error) {
    fail("No-PR workflow delivery", formatError(error));
  }
}

function buildSmokeAgentArtifact(agentRole) {
  if (agentRole === "agent1") {
    return [
      "# Source Check Report",
      "",
      "## Confirmed Requirements",
      "- Complete the smoke no-PR workflow request.",
      "",
      "## Confirmed Scope",
      "- Exercise workflow dispatch and delivery state transitions.",
      "",
      "## Allowed Files",
      "- none; smoke does not modify repository files.",
      "",
      "## Non-Scope",
      "- No Azure writes, package changes, deployment, or source edits.",
      "",
      "## Do Not Touch",
      "- Repository files.",
      "",
      "## Can Proceed",
      "yes",
      "",
      "## Task Package For Agent2",
      "- Return a smoke Implementation Result without modifying files.",
    ].join("\n");
  }

  if (agentRole === "agent2") {
    return [
      "# Implementation Result",
      "",
      "## Changed Files",
      "- none.",
      "",
      "## Commands Run",
      "- smoke workflow continuation.",
      "",
      "## Verification Result",
      "- pass.",
      "",
      "## Scope Compliance",
      "- No file was added, deleted, or modified.",
      "",
      "## Human Decisions",
      "- none.",
    ].join("\n");
  }

  return `# ${agentRole} Artifact\n\nCompleted.`;
}

async function checkLocalRepositoryScan() {
  const suffix = Date.now();
  const workerId = `smoke-repo-worker-${suffix}`;

  try {
    const workerResponse = await postJson("/api/workers", {
      workerId,
      displayName: "Smoke Repo Worker",
      repoPath: "",
      commandTemplate: "",
    });
    const token = workerResponse.worker.token;

    const reportResponse = await fetch(`${appUrl}/api/workers/repositories`, {
      method: "POST",
      headers: {
        ...workerHeaders(workerId, token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repositories: [
          {
            name: "smoke-repo",
            path: process.cwd(),
            source: "smoke",
          },
        ],
        codexReady: true,
        codexStatus: "ready",
        codexError: "",
        codexDiagnosticCode: "ready",
        codexExecutablePath: "smoke-codex",
        codexCheckedAt: new Date().toISOString(),
      }),
    });
    const reportBody = await reportResponse.json();
    assert(
      reportResponse.ok,
      `repository report HTTP ${reportResponse.status}: ${
        reportBody.error ?? "request failed"
      }`,
    );

    const response = await fetch(
      `${appUrl}/api/workers/repositories?workerId=${encodeURIComponent(workerId)}`,
    );
    const body = await response.json();
    assert(response.ok, `repository list HTTP ${response.status}`);
    assert(
      Array.isArray(body.repositories) &&
        body.repositories.some((repository) => repository.name === "smoke-repo"),
      "worker-reported repository was not returned",
    );
    pass(
      "Worker repository report",
      `${body.repositories.length} worker-reported candidate(s) returned`,
    );
  } catch (error) {
    fail("Worker repository report", formatError(error));
  }
}

async function checkWorkerReadinessRecheck() {
  const suffix = Date.now();
  const workerId = `smoke-readiness-worker-${suffix}`;

  try {
    const workerResponse = await postJson("/api/workers", {
      workerId,
      displayName: "Smoke Readiness Worker",
      repoPath: "",
      commandTemplate: "",
    });
    const token = workerResponse.worker.token;

    const requestResponse = await fetch(
      `${appUrl}/api/workers/${encodeURIComponent(workerId)}/readiness`,
      { method: "POST" },
    );
    const requestBody = await requestResponse.json();
    assert(
      requestResponse.ok,
      `readiness request HTTP ${requestResponse.status}: ${
        requestBody.error ?? "request failed"
      }`,
    );

    const pollResponse = await fetch(`${appUrl}/api/workers/poll`, {
      headers: workerHeaders(workerId, token),
    });
    const pollBody = await pollResponse.json();
    assert(
      pollResponse.ok && pollBody.recheckReadiness === true && !pollBody.run,
      `expected readiness-only poll, got HTTP ${pollResponse.status}: ${JSON.stringify(
        pollBody,
      )}`,
    );

    pass("Worker readiness recheck", "readiness-only poll requested");
  } catch (error) {
    fail("Worker readiness recheck", formatError(error));
  }
}

async function checkWorkerStop() {
  const suffix = Date.now();
  const workerId = `smoke-stop-worker-${suffix}`;
  const blockedWorkerId = `smoke-stop-blocked-worker-${suffix}`;

  try {
    const workerResponse = await postJson("/api/workers", {
      workerId,
      displayName: "Smoke Stop Worker",
      repoPath: "",
      commandTemplate: "",
    });
    const token = workerResponse.worker.token;

    const stopResponse = await fetch(
      `${appUrl}/api/workers/${encodeURIComponent(workerId)}/stop`,
      { method: "POST" },
    );
    const stopped = await stopResponse.json();
    assert(stopResponse.ok, `stop worker HTTP ${stopResponse.status}`);
    assert(
      stopped.worker?.status === "disabled",
      "stopped worker was not disabled",
    );

    const pollResponse = await fetch(`${appUrl}/api/workers/poll`, {
      headers: workerHeaders(workerId, token),
    });
    const pollBody = await pollResponse.json();
    assert(
      pollResponse.status === 401 &&
        pollBody.error === "Worker connection was stopped.",
      `expected stopped worker poll HTTP 401, got HTTP ${pollResponse.status}: ${
        pollBody.error ?? "(no error)"
      }`,
    );

    const blockedWorkerResponse = await postJson("/api/workers", {
      workerId: blockedWorkerId,
      displayName: "Smoke Stop Blocked Worker",
      repoPath: "",
      commandTemplate: "",
    });
    const blockedToken = blockedWorkerResponse.worker.token;
    await reportWorkerReady(blockedWorkerId, blockedToken);
    const requestResponse = await postJson("/api/requests", {
      kind: "REQ",
      title: `Smoke stop blocked ${suffix}`,
      detail: "Verify a queued worker run prevents stopping the worker.",
      taskLevel: "Level 2",
      owner: "smoke",
      assignedWorkerId: blockedWorkerId,
      repoPath: process.cwd(),
      azureReferenceType: "none",
      azureReferenceId: "",
    });
    await postJson(`/api/requests/${requestResponse.request.requestId}/dispatch`, {
      actor: "smoke",
    });
    const blockedStopResponse = await fetch(
      `${appUrl}/api/workers/${encodeURIComponent(blockedWorkerId)}/stop`,
      { method: "POST" },
    );
    const blockedStopBody = await blockedStopResponse.json();
    assert(
      blockedStopResponse.status === 409,
      `expected active run stop HTTP 409, got HTTP ${blockedStopResponse.status}: ${
        blockedStopBody.error ?? "(no error)"
      }`,
    );

    pass(
      "Worker stop guard",
      "stopped worker token was revoked and queued runs block stop",
    );
  } catch (error) {
    fail("Worker stop guard", formatError(error));
  }
}

async function checkWritePolicyGuard() {
  try {
    const response = await fetch(`${appUrl}/api/azure/pr`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pullRequest: {
          sourceBranch: "bug/775",
          targetBranch: "develop",
          title: "smoke write policy guard",
          description: [
            "<!-- azure-ai-control-plane:readiness-description:start -->",
            "## AI Development Control Plane",
            "",
            "- Stage gate: Pending rule check",
            "<!-- azure-ai-control-plane:readiness-description:end -->",
          ].join("\n"),
          isDraft: true,
        },
        confirmWrite: true,
      }),
    });
    const body = await response.json();
    assert(
      response.status === 400 &&
        body.error ===
          'Testing-stage Azure writes are limited to AITraining/ branches. "bug/775" is read-only.',
      `expected write policy HTTP 400, got HTTP ${response.status}: ${
        body.error ?? "(no error)"
      }`,
    );
    pass(
      "Testing-stage write policy guard",
      "non-AITraining source was blocked before PAT validation",
    );
  } catch (error) {
    fail("Testing-stage write policy guard", formatError(error));
  }
}

async function checkAzureOverview() {
  try {
    const response = await fetch(`${appUrl}/api/azure/overview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        config: defaultConfig,
        credentials: {
          pat,
        },
      }),
    });
    const body = await response.json();

    assert(
      response.ok,
      `expected Azure overview HTTP 200, got HTTP ${response.status}`,
    );
    const branchNames = new Set((body.branches ?? []).map((branch) => branch.name));
    for (const branch of ["develop", "main", "release"]) {
      assert(branchNames.has(branch), `missing protected branch ${branch}`);
    }
    assert(Array.isArray(body.pullRequests), "pullRequests must be an array");

    const reviewerEvidenceCount = body.pullRequests.filter(
      (pullRequest) =>
        Array.isArray(pullRequest.reviewers) &&
        pullRequest.reviewers.length > 0,
    ).length;
    const workItemEvidenceCount = body.pullRequests.filter(
      (pullRequest) =>
        Array.isArray(pullRequest.linkedWorkItems) &&
        pullRequest.linkedWorkItems.length > 0,
    ).length;

    pass(
      "Azure read-only overview",
      [
        `${body.repository?.name ?? defaultConfig.repository}`,
        `${body.branches?.length ?? 0} branch(es)`,
        `${body.pullRequests.length} PR(s)`,
        `${reviewerEvidenceCount} PR(s) with reviewer evidence`,
        `${workItemEvidenceCount} PR(s) with Work Item evidence`,
      ].join(", "),
    );
  } catch (error) {
    fail("Azure read-only overview", formatError(error));
  }
}

async function postJson(pathname, body) {
  const response = await fetch(`${appUrl}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();

  assert(response.ok, `HTTP ${response.status}: ${data.error ?? "request failed"}`);
  return data;
}

async function reportWorkerReady(workerId, token) {
  const response = await fetch(`${appUrl}/api/workers/repositories`, {
    method: "POST",
    headers: {
      ...workerHeaders(workerId, token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      repositories: [
        {
          name: "smoke-repo",
          path: process.cwd(),
          source: "smoke",
        },
      ],
      codexReady: true,
      codexStatus: "ready",
      codexError: "",
      codexDiagnosticCode: "ready",
      codexExecutablePath: "smoke-codex",
      codexCheckedAt: new Date().toISOString(),
    }),
  });
  const data = await response.json();

  assert(response.ok, `ready report HTTP ${response.status}: ${data.error ?? "request failed"}`);
}

async function pollWorkerForRun(workerId, token, expectedAgentRole) {
  const response = await fetch(`${appUrl}/api/workers/poll`, {
    headers: workerHeaders(workerId, token),
  });
  const body = await response.json();

  assert(
    response.ok && body.run?.agentRole === expectedAgentRole,
    `expected ${expectedAgentRole} run, got HTTP ${response.status}: ${JSON.stringify(body)}`,
  );
  return body.run;
}

async function completeWorkerRun(workerId, token, run, options = {}) {
  const response = await fetch(`${appUrl}/api/workers/runs/${run.runId}/complete`, {
    method: "POST",
    headers: {
      ...workerHeaders(workerId, token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: "completed",
      commandOutput: options.commandOutput ?? `${run.agentRole} completed`,
      diffSummary: options.diffSummary ?? "no diff",
      artifact: options.artifact ?? `# ${run.agentRole} Artifact\n\nCompleted.`,
    }),
  });
  const body = await response.json();

  assert(
    response.ok,
    `complete ${run.agentRole} HTTP ${response.status}: ${
      body.error ?? "request failed"
    }`,
  );
}

function buildSmokeInterpretationOutput() {
  return [
    "CONTROL_PLANE_INTERPRETATION_START",
    JSON.stringify({
      title: "Smoke no-PR interpreted request",
      kind: "REQ",
      taskLevel: "Level 1",
      summary: "Worker/Codex interpreted the smoke no-PR request.",
      suggestedNextAgent: "agent1",
      missingSources: ["Spec / business rule confirmation"],
      sourceWarnings: ["Smoke interpretation is not confirmed source evidence."],
      riskFlags: [],
      guardrails: ["Do not invent requirements."],
    }),
    "CONTROL_PLANE_INTERPRETATION_END",
  ].join("\n");
}

function workerHeaders(workerId, token) {
  return {
    authorization: `Bearer ${token}`,
    "x-worker-id": workerId,
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function pass(name, detail) {
  results.push({ name, detail, status: "pass" });
}

function fail(name, detail) {
  results.push({ name, detail, status: "fail" });
}

function formatError(error) {
  return error instanceof Error ? error.message : "Unknown error";
}
