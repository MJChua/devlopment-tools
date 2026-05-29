import {
  getTestWritePolicyMessage,
  isTestWriteAllowedBranch,
  normalizeBranchName,
} from "@/lib/test-write-policy";
import {
  buildWorkItemFilterQuery,
  hasWorkItemStructuredFilters,
  normalizeWorkItemIteration,
  type AzureClassificationNodeRaw,
  type WorkItemIteration,
  type WorkItemQueryInput,
} from "./azure-work-items";

export type AzureProjectConfig = {
  orgUrl: string;
  project: string;
  repository: string;
};

export type AzureCredentials = {
  pat: string;
};

type AzureListResponse<T> = {
  count?: number;
  value?: T[];
};

type AzureRequestOptions = {
  query?: Record<string, string>;
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  contentType?: string;
};

export type AzureRepository = {
  id: string;
  name: string;
  project?: {
    id?: string;
    name?: string;
  };
  url?: string;
  defaultBranch?: string;
  webUrl?: string;
  remoteUrl?: string;
};

type AzureRef = {
  name: string;
  objectId: string;
};

type AzureGitItem = {
  path?: string;
  objectId?: string;
  commitId?: string;
  content?: string;
  url?: string;
};

export type BranchClass =
  | "protected"
  | "feature"
  | "bug"
  | "ai-training"
  | "hotfix"
  | "other";

export type BranchSummary = {
  name: string;
  objectId: string;
  className: BranchClass;
  isProtected: boolean;
};

type AzureIdentityRef = {
  displayName?: string;
  uniqueName?: string;
};

type AzureWorkItemRaw = {
  id: number;
  url?: string;
  fields?: Record<string, unknown>;
  _links?: {
    html?: {
      href?: string;
    };
  };
};

type AzureWiqlResult = {
  workItems?: Array<{
    id: number;
    url?: string;
  }>;
};

type AzurePullRequestRaw = {
  pullRequestId: number;
  codeReviewId?: number;
  status: string;
  title: string;
  description?: string;
  sourceRefName: string;
  targetRefName: string;
  createdBy?: AzureIdentityRef;
  creationDate?: string;
  closedDate?: string;
  mergeStatus?: string;
  isDraft?: boolean;
  url?: string;
  lastMergeSourceCommit?: {
    commitId?: string;
  };
};

export type LinkedWorkItem = {
  id: string;
  url: string;
  webUrl: string;
  title?: string;
  type?: string;
  state?: string;
  assignedTo?: string;
  areaPath?: string;
  iterationPath?: string;
  tags?: string;
};

export type BuildSummary = {
  id: number;
  buildNumber: string;
  status?: string;
  result?: string;
  queueTime?: string;
  finishTime?: string;
  url?: string;
  webUrl?: string;
};

export type BuildEvidence = {
  source: "branch-build" | "commit-build" | "pr-status";
  state: string;
  label: string;
  url?: string;
};

export type PullRequestStatus = {
  id?: number;
  state?: string;
  description?: string;
  context?: {
    name?: string;
    genre?: string;
  };
  creationDate?: string;
  updatedDate?: string;
  targetUrl?: string;
};

type AzurePullRequestReviewerRaw = AzureIdentityRef & {
  id?: string;
  vote?: number;
  isRequired?: boolean;
  hasDeclined?: boolean;
  isFlagged?: boolean;
  reviewerUrl?: string;
  imageUrl?: string;
};

export type PullRequestReviewer = {
  id?: string;
  displayName: string;
  uniqueName?: string;
  vote: number;
  voteLabel: string;
  isRequired: boolean;
  hasDeclined: boolean;
  isFlagged: boolean;
  reviewerUrl?: string;
  imageUrl?: string;
};

export type PullRequestThread = {
  id: number;
  status?: string;
  publishedDate?: string;
  lastUpdatedDate?: string;
};

export type PullRequestWorkItemLinkResult = {
  pullRequestId: number;
  workItemId: string;
  alreadyLinked: boolean;
  linkedWorkItems: LinkedWorkItem[];
};

export type WorkItemQueryResult = {
  queryText: string;
  inferredIds: string[];
  isTruncated: boolean;
  workItems: LinkedWorkItem[];
};

export type PullRequestDescriptionUpdate = {
  pullRequestId: number;
  title: string;
  status: string;
  description: string;
  webUrl: string;
};

export type CreatePullRequestInput = {
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  isDraft: boolean;
};

export type PullRequestCreateResult = {
  pullRequestId: number;
  title: string;
  status: string;
  sourceBranch: string;
  targetBranch: string;
  description: string;
  webUrl: string;
};

export type PullRequestSummary = {
  id: number;
  title: string;
  description: string;
  webUrl: string;
  status: string;
  sourceBranch: string;
  targetBranch: string;
  createdBy: string;
  creationDate?: string;
  mergeStatus?: string;
  isDraft: boolean;
  linkedWorkItems: LinkedWorkItem[];
  latestBuild?: BuildSummary;
  buildEvidence: BuildEvidence[];
  buildEvidenceSourcesChecked: string[];
  statuses: PullRequestStatus[];
  reviewers: PullRequestReviewer[];
  diagnostics: string[];
};

type PullRequestIteration = {
  id: number;
  description?: string;
  createdDate?: string;
};

type PullRequestChange = {
  changeType?: string;
  item?: {
    path?: string;
    gitObjectType?: string;
    objectId?: string;
    originalObjectId?: string;
  };
};

export type PullRequestFileChange = {
  path: string;
  changeType: string;
  objectType?: string;
  objectId?: string;
};

export type PullRequestDetail = {
  pullRequestId: number;
  title: string;
  status: string;
  sourceBranch: string;
  targetBranch: string;
  isDraft: boolean;
  webUrl: string;
  description: string;
  latestIterationId?: number;
  changes: PullRequestFileChange[];
  linkedWorkItems: LinkedWorkItem[];
  latestBuild?: BuildSummary;
  buildEvidence: BuildEvidence[];
  buildEvidenceSourcesChecked: string[];
  statuses: PullRequestStatus[];
  reviewers: PullRequestReviewer[];
  diagnostics: string[];
};

export type AzureOverview = {
  repository: AzureRepository;
  branches: BranchSummary[];
  pullRequests: PullRequestSummary[];
  protectedBranches: Record<string, boolean>;
  ruleSources: RepoRuleSource[];
  diagnostics: string[];
};

export type RepoRuleSource = {
  path: string;
  status: "present" | "missing" | "error";
  branch: string;
  webUrl: string;
  excerpt?: string;
  objectId?: string;
  diagnostic?: string;
};

export class AzureDevOpsError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AzureDevOpsError";
    this.status = status;
  }
}

const API_VERSION = "7.1";
const PROTECTED_BRANCHES = new Set(["main", "release", "develop"]);
const BUILD_EVIDENCE_SOURCES_CHECKED = [
  "branch latest build",
  "source commit build",
  "PR statuses",
];
const REPO_RULE_SOURCE_BRANCH = "develop";
const REPO_RULE_SOURCE_PATHS = [
  "/AGENTS.md",
  "/docs/ai/incoming-docs/wiki-pages/git-branch-strategy.md",
  "/docs/ai/incoming-docs/wiki-pages/pull-request-guidelines.md",
  "/docs/ai/incoming-docs/wiki-pages/automated-testing-and-cicd-guidelines.md",
];
const WORK_ITEM_DETAIL_FIELDS = [
  "System.Id",
  "System.Title",
  "System.WorkItemType",
  "System.State",
  "System.AssignedTo",
  "System.AreaPath",
  "System.IterationPath",
  "System.Tags",
];

export class AzureDevOpsClient {
  private readonly orgUrl: string;
  private readonly project: string;
  private readonly repositoryName: string;
  private readonly pat: string;

  constructor(config: AzureProjectConfig, credentials: AzureCredentials) {
    this.orgUrl = normalizeOrgUrl(config.orgUrl);
    this.project = config.project.trim();
    this.repositoryName = config.repository.trim();
    this.pat = credentials.pat.trim();
  }

  async getOverview(): Promise<AzureOverview> {
    const repository = await this.getRepository();
    const [branches, pullRequests, ruleSources] = await Promise.all([
      this.getBranches(repository.id),
      this.getPullRequests(repository.id),
      this.getRepoRuleSources(repository.id),
    ]);

    const enrichedPullRequests = await Promise.all(
      pullRequests.slice(0, 30).map((pullRequest) =>
        this.enrichPullRequest(repository.id, pullRequest),
      ),
    );

    return {
      repository,
      branches,
      pullRequests: enrichedPullRequests,
      protectedBranches: {
        develop: branches.some((branch) => branch.name === "develop"),
        main: branches.some((branch) => branch.name === "main"),
        release: branches.some((branch) => branch.name === "release"),
      },
      ruleSources,
      diagnostics: [],
    };
  }

  async getPullRequestDetail(
    pullRequestId: number,
  ): Promise<PullRequestDetail> {
    const repository = await this.getRepository();
    const diagnostics: string[] = [];
    const pullRequest = await this.getPullRequest(repository.id, pullRequestId);

    const [
      linkedWorkItemsResult,
      latestBuild,
      commitBuild,
      statusesResult,
      reviewersResult,
    ] = await Promise.all([
        this.tryGetLinkedWorkItems(repository.id, pullRequestId),
        this.tryGetLatestBuild(repository.id, pullRequest.sourceRefName),
        this.tryGetBuildByCommit(
          repository.id,
          pullRequest.lastMergeSourceCommit?.commitId,
        ),
        this.tryGetPullRequestStatuses(repository.id, pullRequestId),
        this.tryGetPullRequestReviewers(repository.id, pullRequestId),
      ]);

    diagnostics.push(...linkedWorkItemsResult.diagnostics);
    diagnostics.push(...statusesResult.diagnostics);
    diagnostics.push(...reviewersResult.diagnostics);
    if (latestBuild.diagnostic) {
      diagnostics.push(latestBuild.diagnostic);
    }
    if (commitBuild.diagnostic) {
      diagnostics.push(commitBuild.diagnostic);
    }

    const buildEvidence = collectBuildEvidence(
      latestBuild.build,
      commitBuild.build,
      statusesResult.statuses,
    );

    const iterations = await this.request<
      AzureListResponse<PullRequestIteration>
    >(
      `/${encodeURIComponent(this.project)}/_apis/git/repositories/${repository.id}/pullRequests/${pullRequestId}/iterations`,
    );

    const latestIteration = [...(iterations.value ?? [])].sort(
      (left, right) => right.id - left.id,
    )[0];

    if (!latestIteration) {
      return {
        pullRequestId,
        title: pullRequest.title,
        status: pullRequest.status,
        sourceBranch: pullRequest.sourceRefName.replace(/^refs\/heads\//, ""),
        targetBranch: pullRequest.targetRefName.replace(/^refs\/heads\//, ""),
        isDraft: Boolean(pullRequest.isDraft),
        webUrl: this.getPullRequestWebUrl(pullRequest.pullRequestId),
        description: pullRequest.description ?? "",
        changes: [],
        linkedWorkItems: linkedWorkItemsResult.workItems,
        latestBuild: latestBuild.build,
        buildEvidence,
        buildEvidenceSourcesChecked: BUILD_EVIDENCE_SOURCES_CHECKED,
        statuses: statusesResult.statuses,
        reviewers: reviewersResult.reviewers,
        diagnostics: ["No pull request iterations were returned."],
      };
    }

    const changes = await this.request<AzureListResponse<PullRequestChange>>(
      `/${encodeURIComponent(this.project)}/_apis/git/repositories/${repository.id}/pullRequests/${pullRequestId}/iterations/${latestIteration.id}/changes`,
      { "$top": "1000" },
    );

    return {
      pullRequestId,
      title: pullRequest.title,
      status: pullRequest.status,
      sourceBranch: pullRequest.sourceRefName.replace(/^refs\/heads\//, ""),
      targetBranch: pullRequest.targetRefName.replace(/^refs\/heads\//, ""),
      isDraft: Boolean(pullRequest.isDraft),
      webUrl: this.getPullRequestWebUrl(pullRequest.pullRequestId),
      description: pullRequest.description ?? "",
      latestIterationId: latestIteration.id,
      changes: (changes.value ?? []).map((change) => ({
        path: change.item?.path ?? "(unknown path)",
        changeType: change.changeType ?? "unknown",
        objectType: change.item?.gitObjectType,
        objectId: change.item?.objectId,
      })),
      linkedWorkItems: linkedWorkItemsResult.workItems,
      latestBuild: latestBuild.build,
      buildEvidence,
      buildEvidenceSourcesChecked: BUILD_EVIDENCE_SOURCES_CHECKED,
      statuses: statusesResult.statuses,
      reviewers: reviewersResult.reviewers,
      diagnostics,
    };
  }

  async createPullRequestCommentThread(
    pullRequestId: number,
    content: string,
  ): Promise<PullRequestThread> {
    const repository = await this.getRepository();
    const currentPullRequest = await this.getPullRequest(
      repository.id,
      pullRequestId,
    );

    if (currentPullRequest.status !== "active") {
      throw new AzureDevOpsError(
        `Only active pull requests can receive control-plane comments. PR ${pullRequestId} is ${currentPullRequest.status}.`,
        400,
      );
    }

    this.assertPullRequestWriteAllowed(currentPullRequest);

    return this.request<PullRequestThread>(
      `/${encodeURIComponent(this.project)}/_apis/git/repositories/${repository.id}/pullRequests/${pullRequestId}/threads`,
      {
        method: "POST",
        body: {
          comments: [
            {
              parentCommentId: 0,
              content,
              commentType: "text",
            },
          ],
          status: "active",
        },
      },
    );
  }

  async createPullRequest(
    input: CreatePullRequestInput,
  ): Promise<PullRequestCreateResult> {
    this.assertBranchWriteAllowed(input.sourceBranch);

    const repository = await this.getRepository();
    const pullRequest = await this.request<AzurePullRequestRaw>(
      `/${encodeURIComponent(this.project)}/_apis/git/repositories/${repository.id}/pullrequests`,
      {
        method: "POST",
        body: {
          sourceRefName: toHeadRef(input.sourceBranch),
          targetRefName: toHeadRef(input.targetBranch),
          title: input.title,
          description: input.description,
          isDraft: input.isDraft,
        },
      },
    );

    return {
      pullRequestId: pullRequest.pullRequestId,
      title: pullRequest.title,
      status: pullRequest.status,
      sourceBranch: normalizeBranchName(pullRequest.sourceRefName),
      targetBranch: normalizeBranchName(pullRequest.targetRefName),
      description: pullRequest.description ?? "",
      webUrl: this.getPullRequestWebUrl(pullRequest.pullRequestId),
    };
  }

  async findActivePullRequestForBranches(
    sourceBranch: string,
    targetBranch: string,
  ): Promise<PullRequestCreateResult | null> {
    const pullRequests = await this.findActivePullRequestsForBranches(
      sourceBranch,
      targetBranch,
      1,
    );
    return pullRequests[0] ?? null;
  }

  async findActivePullRequestsForBranches(
    sourceBranch: string,
    targetBranch: string,
    top = 10,
  ): Promise<PullRequestCreateResult[]> {
    const repository = await this.getRepository();
    const response = await this.request<AzureListResponse<AzurePullRequestRaw>>(
      `/${encodeURIComponent(this.project)}/_apis/git/repositories/${repository.id}/pullrequests`,
      {
        query: {
          "searchCriteria.status": "active",
          "searchCriteria.sourceRefName": toHeadRef(sourceBranch),
          "searchCriteria.targetRefName": toHeadRef(targetBranch),
          "$top": String(Math.max(1, Math.min(Math.trunc(top), 25))),
        },
      },
    );

    return (response.value ?? []).map((pullRequest) => ({
      pullRequestId: pullRequest.pullRequestId,
      title: pullRequest.title,
      status: pullRequest.status,
      sourceBranch: normalizeBranchName(pullRequest.sourceRefName),
      targetBranch: normalizeBranchName(pullRequest.targetRefName),
      description: pullRequest.description ?? "",
      webUrl: this.getPullRequestWebUrl(pullRequest.pullRequestId),
    }));
  }

  async updatePullRequestDescription(
    pullRequestId: number,
    description: string,
  ): Promise<PullRequestDescriptionUpdate> {
    const repository = await this.getRepository();
    const currentPullRequest = await this.getPullRequest(
      repository.id,
      pullRequestId,
    );

    if (currentPullRequest.status !== "active") {
      throw new AzureDevOpsError(
        `Only active pull requests can be updated by the control plane. PR ${pullRequestId} is ${currentPullRequest.status}.`,
        400,
      );
    }

    this.assertPullRequestWriteAllowed(currentPullRequest);

    const pullRequest = await this.request<AzurePullRequestRaw>(
      `/${encodeURIComponent(this.project)}/_apis/git/repositories/${repository.id}/pullRequests/${pullRequestId}`,
      {
        method: "PATCH",
        body: { description },
      },
    );

    return {
      pullRequestId: pullRequest.pullRequestId,
      title: pullRequest.title,
      status: pullRequest.status,
      description: pullRequest.description ?? "",
      webUrl: this.getPullRequestWebUrl(pullRequest.pullRequestId),
    };
  }

  async linkWorkItemToPullRequest(
    pullRequestId: number,
    workItemId: string,
  ): Promise<PullRequestWorkItemLinkResult> {
    const repository = await this.getRepository();
    const projectId = repository.project?.id;

    if (!projectId) {
      throw new AzureDevOpsError(
        "Azure repository response did not include project id required for Work Item linking.",
        400,
      );
    }

    const currentPullRequest = await this.getPullRequest(
      repository.id,
      pullRequestId,
    );

    if (currentPullRequest.status !== "active") {
      throw new AzureDevOpsError(
        `Only active pull requests can be linked by the control plane. PR ${pullRequestId} is ${currentPullRequest.status}.`,
        400,
      );
    }

    this.assertPullRequestWriteAllowed(currentPullRequest);

    const linkedWorkItems = await this.tryGetLinkedWorkItems(
      repository.id,
      pullRequestId,
    );
    const alreadyLinked = linkedWorkItems.workItems.some(
      (item) => item.id === workItemId,
    );

    if (!alreadyLinked) {
      await this.request<unknown>(
        `/${encodeURIComponent(this.project)}/_apis/wit/workitems/${encodeURIComponent(workItemId)}`,
        {
          method: "PATCH",
          contentType: "application/json-patch+json",
          body: [
            {
              op: "add",
              path: "/relations/-",
              value: {
                rel: "ArtifactLink",
                url: this.getPullRequestArtifactUrl(
                  projectId,
                  repository.id,
                  pullRequestId,
                ),
                attributes: {
                  name: "Pull Request",
                },
              },
            },
          ],
        },
      );
    }

    const refreshedLinkedWorkItems = await this.tryGetLinkedWorkItems(
      repository.id,
      pullRequestId,
    );

    return {
      pullRequestId,
      workItemId,
      alreadyLinked,
      linkedWorkItems: refreshedLinkedWorkItems.workItems,
    };
  }

  async getWorkItemDetail(workItemId: string): Promise<LinkedWorkItem> {
    const workItem = await this.getWorkItem(workItemId);
    return mapWorkItem(workItem, this.getWorkItemWebUrl(workItemId));
  }

  async getIterationTree(): Promise<WorkItemIteration> {
    const root = await this.request<AzureClassificationNodeRaw>(
      `/${encodeURIComponent(this.project)}/_apis/wit/classificationnodes/Iterations`,
      {
        query: {
          "$depth": "20",
        },
      },
    );

    return normalizeWorkItemIteration(root);
  }

  async queryWorkItems(
    input: WorkItemQueryInput = {},
  ): Promise<WorkItemQueryResult> {
    const top = clampWorkItemTop(input.top);
    const inferredIds = extractWorkItemIds(input.searchText ?? "");
    const hasStructuredFilters = hasWorkItemStructuredFilters(input);
    const queryText =
      inferredIds.length > 0 && !hasStructuredFilters
        ? buildWorkItemIdQuery(inferredIds)
        : buildWorkItemFilterQuery(input);

    const queryResult = await this.request<AzureWiqlResult>(
      `/${encodeURIComponent(this.project)}/_apis/wit/wiql`,
      {
        method: "POST",
        query: {
          "$top": String(top),
        },
        body: {
          query: queryText,
        },
      },
    );
    const returnedIds = (queryResult.workItems ?? [])
      .map((item) => item.id)
      .filter((id) => Number.isInteger(id));
    const ids = returnedIds.slice(0, top);
    const workItems = await this.getWorkItemsBatch(ids);

    return {
      queryText,
      inferredIds,
      isTruncated: returnedIds.length >= top,
      workItems,
    };
  }

  private async getRepository(): Promise<AzureRepository> {
    const repositories = await this.request<
      AzureListResponse<AzureRepository>
    >(`/${encodeURIComponent(this.project)}/_apis/git/repositories`);

    const repository = (repositories.value ?? []).find(
      (candidate) =>
        candidate.name.toLowerCase() === this.repositoryName.toLowerCase(),
    );

    if (!repository) {
      throw new AzureDevOpsError(
        `Repository "${this.repositoryName}" was not found in project "${this.project}".`,
        404,
      );
    }

    return repository;
  }

  private assertPullRequestWriteAllowed(pullRequest: AzurePullRequestRaw) {
    this.assertBranchWriteAllowed(pullRequest.sourceRefName);
  }

  private assertBranchWriteAllowed(branchOrRef: string) {
    if (!isTestWriteAllowedBranch(branchOrRef)) {
      throw new AzureDevOpsError(getTestWritePolicyMessage(branchOrRef), 400);
    }
  }

  private async getBranches(repositoryId: string): Promise<BranchSummary[]> {
    const refs = await this.request<AzureListResponse<AzureRef>>(
      `/${encodeURIComponent(this.project)}/_apis/git/repositories/${repositoryId}/refs`,
      { filter: "heads/" },
    );

    return (refs.value ?? [])
      .map((ref) => {
        const name = ref.name.replace(/^refs\/heads\//, "");
        return {
          name,
          objectId: ref.objectId,
          className: classifyBranch(name),
          isProtected: PROTECTED_BRANCHES.has(name),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private async getRepoRuleSources(
    repositoryId: string,
  ): Promise<RepoRuleSource[]> {
    return Promise.all(
      REPO_RULE_SOURCE_PATHS.map(async (path) => {
        try {
          const item = await this.request<AzureGitItem>(
            `/${encodeURIComponent(this.project)}/_apis/git/repositories/${repositoryId}/items`,
            {
              query: {
                path,
                includeContent: "true",
                includeContentMetadata: "true",
                "$format": "json",
                "versionDescriptor.version": REPO_RULE_SOURCE_BRANCH,
                "versionDescriptor.versionType": "branch",
              },
            },
          );

          return {
            path,
            status: "present",
            branch: REPO_RULE_SOURCE_BRANCH,
            webUrl: this.getRepositoryItemWebUrl(
              path,
              REPO_RULE_SOURCE_BRANCH,
            ),
            excerpt: buildRuleSourceExcerpt(item.content ?? ""),
            objectId: item.objectId,
          };
        } catch (error) {
          const message = formatError(error);
          return {
            path,
            status: message.includes("(404)") ? "missing" : "error",
            branch: REPO_RULE_SOURCE_BRANCH,
            webUrl: this.getRepositoryItemWebUrl(
              path,
              REPO_RULE_SOURCE_BRANCH,
            ),
            diagnostic: message,
          };
        }
      }),
    );
  }

  private async getPullRequests(
    repositoryId: string,
  ): Promise<AzurePullRequestRaw[]> {
    const response = await this.request<
      AzureListResponse<AzurePullRequestRaw>
    >(
      `/${encodeURIComponent(this.project)}/_apis/git/repositories/${repositoryId}/pullrequests`,
      {
        "searchCriteria.status": "all",
        "$top": "30",
      },
    );

    return response.value ?? [];
  }

  private async getPullRequest(
    repositoryId: string,
    pullRequestId: number,
  ): Promise<AzurePullRequestRaw> {
    return this.request<AzurePullRequestRaw>(
      `/${encodeURIComponent(this.project)}/_apis/git/repositories/${repositoryId}/pullRequests/${pullRequestId}`,
    );
  }

  private async enrichPullRequest(
    repositoryId: string,
    pullRequest: AzurePullRequestRaw,
  ): Promise<PullRequestSummary> {
    const diagnostics: string[] = [];

    const [
      linkedWorkItemsResult,
      latestBuildResult,
      commitBuildResult,
      statusesResult,
      reviewersResult,
    ] = await Promise.all([
        this.tryGetLinkedWorkItems(repositoryId, pullRequest.pullRequestId),
        this.tryGetLatestBuild(repositoryId, pullRequest.sourceRefName),
        this.tryGetBuildByCommit(
          repositoryId,
          pullRequest.lastMergeSourceCommit?.commitId,
        ),
        this.tryGetPullRequestStatuses(repositoryId, pullRequest.pullRequestId),
        this.tryGetPullRequestReviewers(
          repositoryId,
          pullRequest.pullRequestId,
        ),
      ]);

    diagnostics.push(...linkedWorkItemsResult.diagnostics);
    diagnostics.push(...statusesResult.diagnostics);
    diagnostics.push(...reviewersResult.diagnostics);
    if (latestBuildResult.diagnostic) {
      diagnostics.push(latestBuildResult.diagnostic);
    }
    if (commitBuildResult.diagnostic) {
      diagnostics.push(commitBuildResult.diagnostic);
    }

    return {
      id: pullRequest.pullRequestId,
      title: pullRequest.title,
      description: pullRequest.description ?? "",
      webUrl: this.getPullRequestWebUrl(pullRequest.pullRequestId),
      status: pullRequest.status,
      sourceBranch: pullRequest.sourceRefName.replace(/^refs\/heads\//, ""),
      targetBranch: pullRequest.targetRefName.replace(/^refs\/heads\//, ""),
      createdBy:
        pullRequest.createdBy?.displayName ??
        pullRequest.createdBy?.uniqueName ??
        "Unknown",
      creationDate: pullRequest.creationDate,
      mergeStatus: pullRequest.mergeStatus,
      isDraft: Boolean(pullRequest.isDraft),
      linkedWorkItems: linkedWorkItemsResult.workItems,
      latestBuild: latestBuildResult.build,
      buildEvidence: collectBuildEvidence(
        latestBuildResult.build,
        commitBuildResult.build,
        statusesResult.statuses,
      ),
      buildEvidenceSourcesChecked: BUILD_EVIDENCE_SOURCES_CHECKED,
      statuses: statusesResult.statuses,
      reviewers: reviewersResult.reviewers,
      diagnostics,
    };
  }

  private getPullRequestWebUrl(pullRequestId: number) {
    return `${this.orgUrl}/${encodeURIComponent(
      this.project,
    )}/_git/${encodeURIComponent(this.repositoryName)}/pullrequest/${pullRequestId}`;
  }

  private getWorkItemWebUrl(workItemId: string) {
    return `${this.orgUrl}/${encodeURIComponent(
      this.project,
    )}/_workitems/edit/${encodeURIComponent(workItemId)}`;
  }

  private getRepositoryItemWebUrl(path: string, branch: string) {
    const url = new URL(
      `${this.orgUrl}/${encodeURIComponent(
        this.project,
      )}/_git/${encodeURIComponent(this.repositoryName)}`,
    );
    url.searchParams.set("path", path);
    url.searchParams.set("version", `GB${branch}`);
    return url.toString();
  }

  private getPullRequestArtifactUrl(
    projectId: string,
    repositoryId: string,
    pullRequestId: number,
  ) {
    return `vstfs:///Git/PullRequestId/${encodeURIComponent(
      projectId,
    )}%2F${encodeURIComponent(repositoryId)}%2F${pullRequestId}`;
  }

  private async tryGetLinkedWorkItems(
    repositoryId: string,
    pullRequestId: number,
  ): Promise<{ workItems: LinkedWorkItem[]; diagnostics: string[] }> {
    try {
      const response = await this.request<AzureListResponse<LinkedWorkItem>>(
        `/${encodeURIComponent(this.project)}/_apis/git/repositories/${repositoryId}/pullRequests/${pullRequestId}/workitems`,
      );
      const workItemRefs = (response.value ?? []).map((item) => ({
        ...item,
        webUrl: this.getWorkItemWebUrl(item.id),
      }));
      const detailResults = await Promise.all(
        workItemRefs.map(async (item) => {
          try {
            const detail = await this.getWorkItem(item.id);
            return {
              workItem: {
                ...item,
                ...mapWorkItem(detail, item.webUrl),
              },
              diagnostic: null,
            };
          } catch (error) {
            return {
              workItem: item,
              diagnostic: `Could not read Work Item ${item.id} details: ${formatError(error)}`,
            };
          }
        }),
      );

      return {
        workItems: detailResults.map((result) => result.workItem),
        diagnostics: detailResults
          .map((result) => result.diagnostic)
          .filter((diagnostic): diagnostic is string => Boolean(diagnostic)),
      };
    } catch (error) {
      return {
        workItems: [],
        diagnostics: [
          `Could not read linked work items for PR ${pullRequestId}: ${formatError(error)}`,
        ],
      };
    }
  }

  private async getWorkItem(workItemId: string): Promise<AzureWorkItemRaw> {
    return this.request<AzureWorkItemRaw>(
      `/${encodeURIComponent(this.project)}/_apis/wit/workitems/${encodeURIComponent(workItemId)}`,
      {
        query: {
          fields: WORK_ITEM_DETAIL_FIELDS.join(","),
        },
      },
    );
  }

  private async getWorkItemsBatch(ids: number[]): Promise<LinkedWorkItem[]> {
    if (ids.length === 0) {
      return [];
    }

    const batches = chunk(ids, 200);
    const batchResults = await Promise.all(
      batches.map(async (batch) => {
        const response = await this.request<AzureListResponse<AzureWorkItemRaw>>(
          `/${encodeURIComponent(this.project)}/_apis/wit/workitemsbatch`,
          {
            method: "POST",
            body: {
              ids: batch,
              fields: WORK_ITEM_DETAIL_FIELDS,
              errorPolicy: "Omit",
            },
          },
        );

        return response.value ?? [];
      }),
    );

    return batchResults
      .flat()
      .map((workItem) =>
        mapWorkItem(workItem, this.getWorkItemWebUrl(String(workItem.id))),
      );
  }

  private async tryGetLatestBuild(
    repositoryId: string,
    sourceRefName: string,
  ): Promise<{ build?: BuildSummary; diagnostic?: string }> {
    try {
      const response = await this.request<AzureListResponse<BuildSummary>>(
        `/${encodeURIComponent(this.project)}/_apis/build/builds`,
        {
          repositoryId,
          repositoryType: "TfsGit",
          branchName: sourceRefName,
          queryOrder: "finishTimeDescending",
          "$top": "1",
        },
      );

      return { build: response.value?.[0] };
    } catch (error) {
      return {
        diagnostic: `Could not read latest build for ${sourceRefName}: ${formatError(error)}`,
      };
    }
  }

  private async tryGetBuildByCommit(
    repositoryId: string,
    commitId: string | undefined,
  ): Promise<{ build?: BuildSummary; diagnostic?: string }> {
    if (!commitId) {
      return { diagnostic: "PR source commit id was not returned by Azure." };
    }

    try {
      const response = await this.request<AzureListResponse<BuildSummary>>(
        `/${encodeURIComponent(this.project)}/_apis/build/builds`,
        {
          repositoryId,
          repositoryType: "TfsGit",
          sourceVersion: commitId,
          queryOrder: "finishTimeDescending",
          "$top": "1",
        },
      );

      return { build: response.value?.[0] };
    } catch (error) {
      return {
        diagnostic: `Could not read build for source commit ${commitId}: ${formatError(error)}`,
      };
    }
  }

  private async tryGetPullRequestStatuses(
    repositoryId: string,
    pullRequestId: number,
  ): Promise<{ statuses: PullRequestStatus[]; diagnostics: string[] }> {
    try {
      const response = await this.request<AzureListResponse<PullRequestStatus>>(
        `/${encodeURIComponent(this.project)}/_apis/git/repositories/${repositoryId}/pullRequests/${pullRequestId}/statuses`,
      );

      return { statuses: response.value ?? [], diagnostics: [] };
    } catch (error) {
      return {
        statuses: [],
        diagnostics: [
          `Could not read PR statuses for PR ${pullRequestId}: ${formatError(error)}`,
        ],
      };
    }
  }

  private async tryGetPullRequestReviewers(
    repositoryId: string,
    pullRequestId: number,
  ): Promise<{ reviewers: PullRequestReviewer[]; diagnostics: string[] }> {
    try {
      const response = await this.request<
        AzureListResponse<AzurePullRequestReviewerRaw>
      >(
        `/${encodeURIComponent(this.project)}/_apis/git/repositories/${repositoryId}/pullRequests/${pullRequestId}/reviewers`,
      );

      return {
        reviewers: (response.value ?? []).map(mapPullRequestReviewer),
        diagnostics: [],
      };
    } catch (error) {
      return {
        reviewers: [],
        diagnostics: [
          `Could not read PR reviewers for PR ${pullRequestId}: ${formatError(error)}`,
        ],
      };
    }
  }

  private async request<T>(
    path: string,
    optionsOrQuery: AzureRequestOptions | Record<string, string> = {},
  ): Promise<T> {
    if (!this.pat) {
      throw new AzureDevOpsError("Azure DevOps PAT is required.", 401);
    }

    const options = normalizeRequestOptions(optionsOrQuery);
    const url = new URL(`${this.orgUrl}${path}`);
    url.searchParams.set("api-version", API_VERSION);

    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    let lastError: AzureDevOpsError | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          ...(options.body
            ? { "Content-Type": options.contentType ?? "application/json" }
            : {}),
          Authorization: `Basic ${Buffer.from(`:${this.pat}`).toString("base64")}`,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        cache: "no-store",
      });

      if (response.ok) {
        return response.json() as Promise<T>;
      }

      const body = await response.text();
      lastError = new AzureDevOpsError(
        `Azure DevOps request failed (${response.status}): ${body.slice(0, 500)}`,
        response.status,
      );

      if (!shouldRetryAzureStatus(response.status) || attempt === 2) {
        throw lastError;
      }

      await delay(400 * (attempt + 1));
    }

    throw lastError ?? new AzureDevOpsError("Azure DevOps request failed.", 500);
  }
}

function shouldRetryAzureStatus(status: number) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeRequestOptions(
  optionsOrQuery: AzureRequestOptions | Record<string, string>,
): AzureRequestOptions {
  if (
    "query" in optionsOrQuery ||
    "method" in optionsOrQuery ||
    "body" in optionsOrQuery
  ) {
    return optionsOrQuery;
  }

  return { query: optionsOrQuery as Record<string, string> };
}

function toHeadRef(branch: string) {
  const trimmed = branch.trim();
  if (trimmed.startsWith("refs/heads/")) {
    return trimmed;
  }

  return `refs/heads/${trimmed}`;
}

function buildRuleSourceExcerpt(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join("\n")
    .slice(0, 700);
}

function collectBuildEvidence(
  branchBuild: BuildSummary | undefined,
  commitBuild: BuildSummary | undefined,
  statuses: PullRequestStatus[],
): BuildEvidence[] {
  const evidence: BuildEvidence[] = [];

  if (branchBuild) {
    const branchBuildState = branchBuild.result ?? branchBuild.status;
    if (branchBuildState) {
    evidence.push({
      source: "branch-build",
      state: branchBuildState,
      label: `Branch build ${branchBuild.buildNumber}: ${branchBuildState}`,
      url: branchBuild.webUrl ?? branchBuild.url,
    });
    }
  }

  if (commitBuild) {
    const commitBuildState = commitBuild.result ?? commitBuild.status;
    if (commitBuildState) {
    evidence.push({
      source: "commit-build",
      state: commitBuildState,
      label: `Commit build ${commitBuild.buildNumber}: ${commitBuildState}`,
      url: commitBuild.webUrl ?? commitBuild.url,
    });
    }
  }

  for (const status of statuses) {
    const name = `${status.context?.genre ?? ""} ${status.context?.name ?? ""} ${
      status.description ?? ""
    }`.toLowerCase();

    if (
      name.includes("build") ||
      name.includes("pipeline") ||
      name.includes("policy") ||
      name.includes("ci")
    ) {
      evidence.push({
        source: "pr-status",
        state: status.state ?? "unknown",
        label: `${status.context?.name ?? status.context?.genre ?? "PR status"}: ${
          status.state ?? "unknown"
        }`,
        url: status.targetUrl,
      });
    }
  }

  return evidence;
}

function mapWorkItem(
  workItem: AzureWorkItemRaw,
  fallbackWebUrl: string,
): LinkedWorkItem {
  const fields = workItem.fields ?? {};
  return {
    id: String(workItem.id),
    url: workItem.url ?? "",
    webUrl: workItem._links?.html?.href ?? fallbackWebUrl,
    title: asString(fields["System.Title"]),
    type: asString(fields["System.WorkItemType"]),
    state: asString(fields["System.State"]),
    assignedTo: formatIdentity(fields["System.AssignedTo"]),
    areaPath: asString(fields["System.AreaPath"]),
    iterationPath: asString(fields["System.IterationPath"]),
    tags: asString(fields["System.Tags"]),
  };
}

function mapPullRequestReviewer(
  reviewer: AzurePullRequestReviewerRaw,
): PullRequestReviewer {
  const vote = reviewer.vote ?? 0;
  return {
    id: reviewer.id,
    displayName:
      reviewer.displayName ?? reviewer.uniqueName ?? reviewer.id ?? "Unknown",
    uniqueName: reviewer.uniqueName,
    vote,
    voteLabel: getReviewerVoteLabel(vote),
    isRequired: Boolean(reviewer.isRequired),
    hasDeclined: Boolean(reviewer.hasDeclined),
    isFlagged: Boolean(reviewer.isFlagged),
    reviewerUrl: reviewer.reviewerUrl,
    imageUrl: reviewer.imageUrl,
  };
}

function getReviewerVoteLabel(vote: number) {
  if (vote >= 10) {
    return "approved";
  }

  if (vote === 5) {
    return "approved with suggestions";
  }

  if (vote <= -10) {
    return "rejected";
  }

  if (vote === -5) {
    return "waiting for author";
  }

  return "no vote";
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

function formatIdentity(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "displayName" in value &&
    typeof value.displayName === "string"
  ) {
    return value.displayName;
  }

  return undefined;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function clampWorkItemTop(top: number | undefined) {
  if (!top || !Number.isFinite(top)) {
    return 1000;
  }

  return Math.min(Math.max(Math.trunc(top), 1), 1000);
}

function extractWorkItemIds(text: string) {
  return [
    ...new Set(
      [...text.matchAll(/\b\d{2,7}\b/g)]
        .map((match) => match[0])
        .filter((id) => !id.startsWith("0")),
    ),
  ].slice(0, 20);
}

function buildWorkItemIdQuery(ids: string[]) {
  return `
SELECT [System.Id]
FROM WorkItems
WHERE [System.TeamProject] = @project
  AND [System.Id] IN (${ids.join(", ")})
ORDER BY [System.ChangedDate] DESC
`.trim();
}

export function classifyBranch(name: string): BranchClass {
  if (PROTECTED_BRANCHES.has(name)) {
    return "protected";
  }

  if (name.startsWith("feature/")) {
    return "feature";
  }

  if (name.startsWith("bug/")) {
    return "bug";
  }

  if (isAiTrainingBranch(name)) {
    return "ai-training";
  }

  if (name === "hotfix" || name.startsWith("hotfix/")) {
    return "hotfix";
  }

  return "other";
}

export function normalizeOrgUrl(orgUrl: string): string {
  const trimmed = orgUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return `https://dev.azure.com/${trimmed}`;
}

export function formatError(error: unknown): string {
  if (error instanceof AzureDevOpsError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function isAiTrainingBranch(name: string) {
  const normalized = name.toLowerCase();
  return (
    normalized.startsWith("aitraining/") ||
    normalized.startsWith("ai_training/")
  );
}
