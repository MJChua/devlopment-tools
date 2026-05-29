import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const { createWorkflowRequestFromInput, buildWorkflowAgentPacket } = await import(
  "../src/lib/control-plane-workflow.ts"
);
const { scanRepoCandidatesForAgent1 } = await import(
  "../src/lib/repo-candidate-scan.ts"
);

test("repo candidate scan finds multi-app topbar/header hints for Agent1 packet", async () => {
  const root = path.join(tmpdir(), `repo-candidate-scan-${Date.now()}`);
  await mkdir(path.join(root, "apps", "admin-agent-web", "src", "components"), {
    recursive: true,
  });
  await mkdir(path.join(root, "apps", "admin-hq-web", "src", "components"), {
    recursive: true,
  });
  await mkdir(path.join(root, "apps", "trader-web", "src", "views"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "apps", "admin-agent-web", "package.json"),
    JSON.stringify({ name: "@odin/admin-agent-web" }),
  );
  await writeFile(
    path.join(root, "apps", "admin-agent-web", "src", "components", "AgentTopBar.vue"),
    "<template><button>logout</button></template>",
  );
  await writeFile(
    path.join(root, "apps", "admin-hq-web", "src", "components", "HqTopBar.vue"),
    "<template><button>logout</button></template>",
  );
  await writeFile(
    path.join(root, "apps", "trader-web", "src", "views", "TraderShell.vue"),
    "<template><header>menu</header></template>",
  );

  const request = createWorkflowRequestFromInput(
    {
      detail: "Add MJ to the top menu bar.",
      assignedWorkerId: "worker",
      repoPath: root,
      azureReferenceType: "none",
      azureReferenceId: "",
    },
    new Date(2026, 4, 29, 12, 0),
  );
  const scan = scanRepoCandidatesForAgent1(request);
  const packet = buildWorkflowAgentPacket(request, "agent1", [], [], {
    repoCandidateScan: scan,
  });

  assert(scan);
  scan.apps[0].label = "mutated cache consumer";
  const cachedScan = scanRepoCandidatesForAgent1(request);

  assert(cachedScan);
  assert.notEqual(cachedScan.apps[0].label, "mutated cache consumer");
  assert.match(packet, /Pre-Scanned Repo Candidates/);
  assert.match(packet, /apps\/admin-agent-web/);
  assert.match(packet, /AgentTopBar\.vue/);
  assert.match(packet, /HqTopBar\.vue/);
  assert.match(packet, /TraderShell\.vue/);
});
