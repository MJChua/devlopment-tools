export type AzureClassificationNodeRaw = {
  id?: number;
  identifier?: string;
  name?: string;
  path?: string;
  structureType?: string;
  hasChildren?: boolean;
  attributes?: {
    startDate?: string;
    finishDate?: string;
  };
  children?: AzureClassificationNodeRaw[];
  url?: string;
};

export type WorkItemIteration = {
  id: string;
  name: string;
  path: string;
  sourcePath?: string;
  startDate?: string;
  finishDate?: string;
  children: WorkItemIteration[];
};

export type WorkItemQueryInput = {
  searchText?: string;
  iterationPath?: string;
  state?: string;
  type?: string;
  assignedTo?: string;
  top?: number;
};

export function hasWorkItemStructuredFilters(input: WorkItemQueryInput) {
  return Boolean(
    input.iterationPath?.trim() ||
      input.state?.trim() ||
      input.type?.trim() ||
      input.assignedTo?.trim(),
  );
}

export function buildWorkItemFilterQuery(input: WorkItemQueryInput = {}) {
  const conditions = ["[System.TeamProject] = @project"];
  const iterationPath = normalizeIterationPath(input.iterationPath ?? "");
  const state = input.state?.trim();
  const type = input.type?.trim();
  const assignedTo = input.assignedTo?.trim();

  if (iterationPath) {
    conditions.push(
      `[System.IterationPath] UNDER '${escapeWiqlString(iterationPath)}'`,
    );
  }

  if (state) {
    conditions.push(`[System.State] = '${escapeWiqlString(state)}'`);
  }

  if (type) {
    conditions.push(`[System.WorkItemType] = '${escapeWiqlString(type)}'`);
  }

  if (assignedTo) {
    conditions.push(`[System.AssignedTo] = '${escapeWiqlString(assignedTo)}'`);
  }

  return `
SELECT [System.Id]
FROM WorkItems
WHERE ${conditions.join("\n  AND ")}
ORDER BY [System.ChangedDate] DESC
`.trim();
}

export function normalizeWorkItemIteration(
  node: AzureClassificationNodeRaw,
): WorkItemIteration {
  const name = asString(node.name) ?? "Iterations";
  const sourcePath = normalizeLeadingSlashes(asString(node.path) ?? name);
  const path = normalizeIterationPath(sourcePath);
  const children = (node.children ?? []).map(normalizeWorkItemIteration);

  return {
    id: String(node.identifier ?? node.id ?? path),
    name,
    path,
    sourcePath,
    startDate: asString(node.attributes?.startDate),
    finishDate: asString(node.attributes?.finishDate),
    children,
  };
}

function escapeWiqlString(value: string) {
  return value.replace(/'/g, "''");
}

function normalizeIterationPath(path: string) {
  const normalized = normalizeLeadingSlashes(path);
  const segments = normalized.split("\\");

  if (
    segments.length > 2 &&
    ["iteration", "iterations"].includes(segments[1].toLowerCase())
  ) {
    return [segments[0], ...segments.slice(2)].join("\\");
  }

  return normalized;
}

function normalizeLeadingSlashes(path: string) {
  return path.trim().replace(/^\\+/, "");
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return undefined;
}
