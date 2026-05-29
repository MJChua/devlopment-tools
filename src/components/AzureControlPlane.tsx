"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  MessageSquarePlus,
  Eye,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AzureOverview,
  BranchClass,
  BranchSummary,
  BuildEvidence,
  LinkedWorkItem,
  PullRequestDetail,
  PullRequestReviewer,
  PullRequestSummary,
  PullRequestStatus,
  RepoRuleSource,
  WorkItemQueryResult,
} from "@/lib/azure-devops";
import {
  AZURE_PR_DESCRIPTION_LIMIT,
  AZURE_PR_COMMENT_LIMIT,
  buildAgentPacket,
  buildCreatePullRequestDescription,
  buildFailedRuleReport,
  buildMarkdownReport,
  buildPullRequestDescriptionPreview,
  buildPullRequestReadinessComment,
  evaluatePullRequestRules,
  getCreatePullRequestWarnings,
  getBuildEvidence,
  getRecommendedTargetBranch,
  ODIN_MT5_WEB_RULES,
  summarizeFindings,
  summarizeReadiness,
  summarizeStageGates,
  type RuleCheckReport,
  type RuleSeverity,
  type StageGateStatus,
} from "@/lib/repo-rule-engine";
import {
  getTestWritePolicyMessage,
  isTestWriteAllowedBranch,
  TEST_WRITE_BRANCH_PREFIX,
} from "@/lib/test-write-policy";
import {
  buildAgent0DispatchPrompt,
  createRequestIntakeRecord,
  emptyRequestIntakeForm,
  MAX_REQUEST_INTAKE_RECORDS,
  parseRequestIntakeRecords,
  REQUEST_INTAKE_STORAGE_KEY,
  REQUEST_KINDS,
  serializeRequestIntakeRecords,
  TASK_LEVELS,
  type AzureReferenceType,
  type RequestIntakeForm,
  type RequestIntakeRecord,
} from "@/lib/request-intake";

type ConnectionForm = {
  orgUrl: string;
  project: string;
  repository: string;
};

type LoadState = "idle" | "loading" | "success" | "error";
type RuleCheckMode = "delivery" | "audit";
type PrCommentPostState = {
  state: LoadState;
  message?: string;
};
type PrDescriptionUpdateState = {
  state: LoadState;
  message?: string;
};
type WorkItemLinkState = {
  state: LoadState;
  message?: string;
};
type WorkItemCandidateState = {
  state: LoadState;
  message?: string;
  candidates: LinkedWorkItem[];
  inferredIds: string[];
};
type DescriptionPreview = {
  pullRequestId: number;
  sourceBranch: string;
  content: string;
};
type CreatePrForm = {
  sourceBranch: string;
  targetBranch: string;
  title: string;
  isDraft: boolean;
  policyAcknowledged: boolean;
};
type CreatePrState = {
  state: LoadState;
  message?: string;
  pullRequestId?: number;
  webUrl?: string;
};
type WriteActivity = {
  id: string;
  operation:
    | "create-pr"
    | "update-description"
    | "post-comment"
    | "link-work-item";
  pullRequestId: number;
  status: "success";
  message: string;
  createdAt: string;
  webUrl?: string;
};
type RuleCheckHistoryEntry = {
  id: string;
  repository: string;
  mode: RuleCheckMode;
  checkedCount: number;
  blockedCount: number;
  warningCount: number;
  passedCount: number;
  gateSummary: Array<{
    label: string;
    count: number;
  }>;
  markdown: string;
  createdAt: string;
};
type PendingWriteConfirmation = {
  operation: string;
  target: string;
  risk: "low" | "medium" | "medium-high";
  sideEffect: string;
  reversibility: string;
  humanReason: string;
  payloadSummary: string[];
  confirmLabel: string;
};

type AzurePrErrorResponse = {
  error?: string;
  detailUnavailable?: boolean;
};

const DEFAULT_FORM: ConnectionForm = {
  orgUrl: "https://dev.azure.com/odin-tech",
  project: "MT5-Trading-Platform",
  repository: "odin-mt5-web",
};

const PROJECT_STORAGE_KEY = "azure-ai-control-plane.project";
const LEGACY_PAT_STORAGE_KEY = "azure-ai-control-plane.sessionPat";
const WRITE_ACTIVITY_STORAGE_KEY = "azure-ai-control-plane.writeActivity";
const RULE_CHECK_HISTORY_STORAGE_KEY = "azure-ai-control-plane.ruleCheckHistory";
const MAX_WRITE_ACTIVITY_RECORDS = 50;
const MAX_RULE_CHECK_HISTORY_RECORDS = 20;

const branchClassLabels: Record<BranchClass, string> = {
  protected: "Protected",
  feature: "Feature",
  bug: "Bug",
  "ai-training": "AI Training",
  hotfix: "Hotfix",
  other: "Other",
};

const writeOperationLabels: Record<WriteActivity["operation"], string> = {
  "create-pr": "Create PR",
  "link-work-item": "Link Work Item",
  "post-comment": "Post comment",
  "update-description": "Update description",
};

export function AzureControlPlane() {
  const writeConfirmationResolverRef = useRef<
    ((confirmed: boolean) => void) | null
  >(null);
  const [form, setForm] = useState<ConnectionForm>(DEFAULT_FORM);
  const [patInput, setPatInput] = useState("");
  const [azurePat, setAzurePat] = useState("");
  const [overview, setOverview] = useState<AzureOverview | null>(null);
  const [overviewState, setOverviewState] = useState<LoadState>("idle");
  const [overviewError, setOverviewError] = useState("");
  const [selectedPrId, setSelectedPrId] = useState<number | null>(null);
  const [prDetail, setPrDetail] = useState<PullRequestDetail | null>(null);
  const [prState, setPrState] = useState<LoadState>("idle");
  const [prError, setPrError] = useState("");
  const [ruleChecks, setRuleChecks] = useState<RuleCheckReport[]>([]);
  const [ruleCheckMode, setRuleCheckMode] =
    useState<RuleCheckMode>("delivery");
  const [ruleCheckState, setRuleCheckState] = useState<LoadState>("idle");
  const [ruleCheckError, setRuleCheckError] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [commentCopyId, setCommentCopyId] = useState<number | null>(null);
  const [agentPacketCopyId, setAgentPacketCopyId] = useState<number | null>(
    null,
  );
  const [commentPostStates, setCommentPostStates] = useState<
    Record<number, PrCommentPostState>
  >({});
  const [descriptionPreview, setDescriptionPreview] =
    useState<DescriptionPreview | null>(null);
  const [descriptionCopyState, setDescriptionCopyState] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const [descriptionUpdateStates, setDescriptionUpdateStates] = useState<
    Record<number, PrDescriptionUpdateState>
  >({});
  const [workItemLinkInputs, setWorkItemLinkInputs] = useState<
    Record<number, string>
  >({});
  const [workItemLinkStates, setWorkItemLinkStates] = useState<
    Record<number, WorkItemLinkState>
  >({});
  const [workItemCandidateStates, setWorkItemCandidateStates] = useState<
    Record<number, WorkItemCandidateState>
  >({});
  const [createPrForm, setCreatePrForm] = useState<CreatePrForm>(
    emptyCreatePrForm(),
  );
  const [createPrState, setCreatePrState] = useState<CreatePrState>({
    state: "idle",
  });
  const [writeActivities, setWriteActivities] = useState<WriteActivity[]>([]);
  const [ruleCheckHistory, setRuleCheckHistory] = useState<
    RuleCheckHistoryEntry[]
  >([]);
  const [requestIntakeForm, setRequestIntakeForm] =
    useState<RequestIntakeForm>(emptyRequestIntakeForm());
  const [requestIntakeRecords, setRequestIntakeRecords] = useState<
    RequestIntakeRecord[]
  >([]);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [requestPromptCopyState, setRequestPromptCopyState] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const [clientReady, setClientReady] = useState(false);
  const [historyCopyId, setHistoryCopyId] = useState<string | null>(null);
  const [pendingWriteConfirmation, setPendingWriteConfirmation] =
    useState<PendingWriteConfirmation | null>(null);

  const branchesByClass = useMemo(() => {
    const grouped: Record<BranchClass, BranchSummary[]> = {
      protected: [],
      feature: [],
      bug: [],
      "ai-training": [],
      hotfix: [],
      other: [],
    };

    for (const branch of overview?.branches ?? []) {
      grouped[branch.className].push(branch);
    }

    return grouped;
  }, [overview]);

  const activePullRequests = useMemo(
    () =>
      (overview?.pullRequests ?? []).filter(
        (pullRequest) => pullRequest.status === "active",
      ),
    [overview],
  );

  const selectedRequest = useMemo(
    () =>
      requestIntakeRecords.find(
        (record) => record.requestId === selectedRequestId,
      ) ??
      requestIntakeRecords[0] ??
      null,
    [requestIntakeRecords, selectedRequestId],
  );

  useEffect(() => {
    setForm(loadInitialForm());
    setWriteActivities(loadInitialWriteActivities());
    setRuleCheckHistory(loadInitialRuleCheckHistory());
    const loadedRequestIntakeRecords = loadInitialRequestIntakeRecords();
    setRequestIntakeRecords(loadedRequestIntakeRecords);
    setSelectedRequestId(loadedRequestIntakeRecords[0]?.requestId ?? "");
    setClientReady(true);
  }, []);

  function updateForm(field: keyof ConnectionForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function changeRuleCheckMode(mode: RuleCheckMode) {
    setRuleCheckMode(mode);
    setRuleChecks([]);
    setRuleCheckState("idle");
    setRuleCheckError("");
    setCopyState("idle");
    setCommentCopyId(null);
    setAgentPacketCopyId(null);
    setCommentPostStates({});
    setDescriptionPreview(null);
    setDescriptionCopyState("idle");
    setDescriptionUpdateStates({});
    setWorkItemLinkInputs({});
    setWorkItemLinkStates({});
    setWorkItemCandidateStates({});
  }

  function updateCreatePrSource(sourceBranch: string) {
    const targetBranch = getRecommendedTargetBranch(sourceBranch);
    setCreatePrForm((current) => ({
      ...current,
      sourceBranch,
      targetBranch,
      title: buildDefaultPullRequestTitle(sourceBranch),
      policyAcknowledged: false,
    }));
    setCreatePrState({ state: "idle" });
  }

  function updateCreatePrTarget(targetBranch: string) {
    setCreatePrForm((current) => ({
      ...current,
      targetBranch,
      policyAcknowledged: false,
    }));
    setCreatePrState({ state: "idle" });
  }

  function recordWriteActivity(
    activity: Omit<WriteActivity, "createdAt" | "id" | "status">,
  ) {
    setWriteActivities((current) => {
      const nextActivity: WriteActivity = {
        ...activity,
        id: `${activity.operation}-${activity.pullRequestId}-${Date.now()}`,
        status: "success",
        createdAt: new Date().toISOString(),
      };
      const next = [nextActivity, ...current].slice(
        0,
        MAX_WRITE_ACTIVITY_RECORDS,
      );
      saveWriteActivities(next);
      return next;
    });
  }

  function clearWriteActivities() {
    setWriteActivities([]);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(WRITE_ACTIVITY_STORAGE_KEY);
    }
  }

  function recordRuleCheckHistory(
    mode: RuleCheckMode,
    reports: RuleCheckReport[],
  ) {
    if (reports.length === 0) {
      return;
    }

    const counts = summarizeRuleCheckCounts(reports);
    const nextEntry: RuleCheckHistoryEntry = {
      id: `rule-check-${mode}-${Date.now()}`,
      repository: form.repository,
      mode,
      checkedCount: reports.length,
      blockedCount: counts.blocked,
      warningCount: counts.warning,
      passedCount: counts.passed,
      gateSummary: summarizeStageGates(reports).map(({ label, count }) => ({
        label,
        count,
      })),
      markdown: buildMarkdownReport(reports),
      createdAt: new Date().toISOString(),
    };

    setRuleCheckHistory((current) => {
      const next = [nextEntry, ...current].slice(
        0,
        MAX_RULE_CHECK_HISTORY_RECORDS,
      );
      saveRuleCheckHistory(next);
      return next;
    });
  }

  function clearRuleCheckHistory() {
    setRuleCheckHistory([]);
    setHistoryCopyId(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(RULE_CHECK_HISTORY_STORAGE_KEY);
    }
  }

  async function copyRuleCheckHistory(entry: RuleCheckHistoryEntry) {
    try {
      await navigator.clipboard.writeText(entry.markdown);
      setHistoryCopyId(entry.id);
      window.setTimeout(() => setHistoryCopyId(null), 2000);
    } catch {
      setHistoryCopyId(null);
    }
  }

  function updateRequestIntakeForm<Field extends keyof RequestIntakeForm>(
    field: Field,
    value: RequestIntakeForm[Field],
  ) {
    setRequestIntakeForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "azureReferenceType" ? { azureReferenceId: "" } : {}),
    }));
    setRequestPromptCopyState("idle");
  }

  function createRequestIntake() {
    const record = createRequestIntakeRecord(requestIntakeForm);
    if (!record.title || !record.detail) {
      return;
    }

    setRequestIntakeRecords((current) => {
      const next = [record, ...current].slice(0, MAX_REQUEST_INTAKE_RECORDS);
      saveRequestIntakeRecords(next);
      return next;
    });
    setSelectedRequestId(record.requestId);
    setRequestPromptCopyState("idle");
  }

  function clearRequestIntakeRecords() {
    setRequestIntakeRecords([]);
    setSelectedRequestId("");
    setRequestPromptCopyState("idle");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(REQUEST_INTAKE_STORAGE_KEY);
    }
  }

  async function copyAgent0DispatchPrompt(record: RequestIntakeRecord) {
    try {
      await navigator.clipboard.writeText(buildAgent0DispatchPrompt(record));
      setRequestPromptCopyState("copied");
      window.setTimeout(() => setRequestPromptCopyState("idle"), 2000);
    } catch {
      setRequestPromptCopyState("error");
    }
  }

  function requestWriteConfirmation(details: PendingWriteConfirmation) {
    writeConfirmationResolverRef.current?.(false);
    setPendingWriteConfirmation(details);

    return new Promise<boolean>((resolve) => {
      writeConfirmationResolverRef.current = resolve;
    });
  }

  function resolveWriteConfirmation(confirmed: boolean) {
    writeConfirmationResolverRef.current?.(confirmed);
    writeConfirmationResolverRef.current = null;
    setPendingWriteConfirmation(null);
  }

  async function createPullRequest() {
    const existingPullRequest = findExistingActivePullRequest(
      activePullRequests,
      createPrForm,
    );

    if (existingPullRequest) {
      setCreatePrState({
        state: "error",
        message: `Active PR #${existingPullRequest.id} already exists for ${createPrForm.sourceBranch} -> ${createPrForm.targetBranch}.`,
        pullRequestId: existingPullRequest.id,
      });
      return;
    }

    if (!isTestWriteAllowedBranch(createPrForm.sourceBranch)) {
      setCreatePrState({
        state: "error",
        message: getTestWritePolicyMessage(createPrForm.sourceBranch),
      });
      return;
    }

    const policyWarnings = getCreatePullRequestWarnings(createPrForm);
    if (policyWarnings.length > 0 && !createPrForm.policyAcknowledged) {
      setCreatePrState({
        state: "error",
        message:
          "Branch policy warnings require explicit acknowledgement before creating a PR.",
      });
      return;
    }

    if (!azurePat) {
      setCreatePrState({
        state: "error",
        message: "Reconnect with a write-capable PAT before creating a PR.",
      });
      return;
    }

    const description = buildCreatePullRequestDescription(createPrForm);
    if (description.length > AZURE_PR_DESCRIPTION_LIMIT) {
      setCreatePrState({
        state: "error",
        message: `Azure PR descriptions are limited to ${AZURE_PR_DESCRIPTION_LIMIT} characters.`,
      });
      return;
    }

    const confirmed = await requestWriteConfirmation({
      operation: createPrForm.isDraft
        ? "Create draft pull request"
        : "Create pull request",
      target: `${createPrForm.sourceBranch} -> ${createPrForm.targetBranch}`,
      risk: "medium-high",
      sideEffect:
        "Creates a new Azure pull request and adds it to the team's PR queue.",
      reversibility:
        "The PR can be abandoned later, but abandon is a separate high-risk operation and is not part of the MVP.",
      humanReason:
        "A human must confirm the branch, target, draft state, and branch policy acknowledgement before a new PR is created.",
      payloadSummary: [
        `Source branch: ${createPrForm.sourceBranch}`,
        `Target branch: ${createPrForm.targetBranch}`,
        `Title: ${createPrForm.title}`,
        `Draft: ${createPrForm.isDraft ? "yes" : "no"}`,
        `Description length: ${description.length} / ${AZURE_PR_DESCRIPTION_LIMIT}`,
      ],
      confirmLabel: "Create Azure PR",
    });

    if (!confirmed) {
      return;
    }

    setCreatePrState({
      state: "loading",
      message: "Creating Azure PR...",
    });

    try {
      const response = await fetch("/api/azure/pr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...toAzureRequest(form, azurePat),
          pullRequest: {
            sourceBranch: createPrForm.sourceBranch,
            targetBranch: createPrForm.targetBranch,
            title: createPrForm.title,
            isDraft: createPrForm.isDraft,
            policyAcknowledged: createPrForm.policyAcknowledged,
            description,
          },
          confirmWrite: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to create pull request.");
      }

      setCreatePrState({
        state: "success",
        message: `Created Azure PR #${data.pullRequestId}. Refresh Azure data to load rule checks.`,
        pullRequestId: data.pullRequestId,
        webUrl: data.webUrl,
      });
      recordWriteActivity({
        operation: "create-pr",
        pullRequestId: data.pullRequestId,
        message: `Created draft PR from ${createPrForm.sourceBranch} to ${createPrForm.targetBranch}.`,
        webUrl: data.webUrl,
      });
    } catch (error) {
      setCreatePrState({
        state: "error",
        message: formatClientError(error),
      });
    }
  }

  async function updatePullRequestDescriptionPreview() {
    if (!descriptionPreview) {
      return;
    }

    if (!azurePat) {
      setDescriptionUpdateStates((current) => ({
        ...current,
        [descriptionPreview.pullRequestId]: {
          state: "error",
          message: "Reconnect with a write-capable PAT before updating.",
        },
      }));
      return;
    }

    if (!isTestWriteAllowedBranch(descriptionPreview.sourceBranch)) {
      setDescriptionUpdateStates((current) => ({
        ...current,
        [descriptionPreview.pullRequestId]: {
          state: "error",
          message: getTestWritePolicyMessage(descriptionPreview.sourceBranch),
        },
      }));
      return;
    }

    if (descriptionPreview.content.length > AZURE_PR_DESCRIPTION_LIMIT) {
      setDescriptionUpdateStates((current) => ({
        ...current,
        [descriptionPreview.pullRequestId]: {
          state: "error",
          message: `Azure PR descriptions are limited to ${AZURE_PR_DESCRIPTION_LIMIT} characters.`,
        },
      }));
      return;
    }

    const confirmed = await requestWriteConfirmation({
      operation: "Update pull request description",
      target: `PR #${descriptionPreview.pullRequestId}`,
      risk: "medium",
      sideEffect:
        "Updates the Azure PR description with the previewed control-plane marker block.",
      reversibility:
        "The marker block can be updated again, but the Azure PR description history remains changed.",
      humanReason:
        "A human must confirm the target PR and previewed description before the App changes PR metadata.",
      payloadSummary: [
        `PR: #${descriptionPreview.pullRequestId}`,
        `Description length: ${descriptionPreview.content.length} / ${AZURE_PR_DESCRIPTION_LIMIT}`,
        "Scope: marker-bounded control-plane description block",
      ],
      confirmLabel: "Update Description",
    });

    if (!confirmed) {
      return;
    }

    setDescriptionUpdateStates((current) => ({
      ...current,
      [descriptionPreview.pullRequestId]: {
        state: "loading",
        message: "Updating PR description...",
      },
    }));

    try {
      const response = await fetch(
        `/api/azure/pr/${descriptionPreview.pullRequestId}/description`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...toAzureRequest(form, azurePat),
            description: descriptionPreview.content,
            confirmWrite: true,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to update PR description.");
      }

      setDescriptionUpdateStates((current) => ({
        ...current,
        [descriptionPreview.pullRequestId]: {
          state: "success",
          message: `Updated Azure PR #${data.pullRequestId ?? descriptionPreview.pullRequestId} description.`,
        },
      }));
      recordWriteActivity({
        operation: "update-description",
        pullRequestId: data.pullRequestId ?? descriptionPreview.pullRequestId,
        message: "Updated PR description with control-plane marker block.",
        webUrl:
          data.webUrl ??
          findPullRequestWebUrl(overview, descriptionPreview.pullRequestId),
      });
    } catch (error) {
      setDescriptionUpdateStates((current) => ({
        ...current,
        [descriptionPreview.pullRequestId]: {
          state: "error",
          message: formatClientError(error),
        },
      }));
    }
  }

  async function postPullRequestReadinessComment(report: RuleCheckReport) {
    if (!azurePat) {
      setCommentPostStates((current) => ({
        ...current,
        [report.pullRequestId]: {
          state: "error",
          message: "Reconnect with a write-capable PAT before posting.",
        },
      }));
      return;
    }

    if (!isTestWriteAllowedBranch(report.sourceBranch)) {
      setCommentPostStates((current) => ({
        ...current,
        [report.pullRequestId]: {
          state: "error",
          message: getTestWritePolicyMessage(report.sourceBranch),
        },
      }));
      return;
    }

    if (!report.stageGate.deliveryGate) {
      setCommentPostStates((current) => ({
        ...current,
        [report.pullRequestId]: {
          state: "error",
          message: "Historical PRs are copy-only and are not posted by the App.",
        },
      }));
      return;
    }

    const comment = buildPullRequestReadinessComment(report);
    if (comment.length > AZURE_PR_COMMENT_LIMIT) {
      setCommentPostStates((current) => ({
        ...current,
        [report.pullRequestId]: {
          state: "error",
          message: `Azure PR comments are limited to ${AZURE_PR_COMMENT_LIMIT} characters.`,
        },
      }));
      return;
    }

    const confirmed = await requestWriteConfirmation({
      operation: "Post readiness comment",
      target: `PR #${report.pullRequestId}`,
      risk: "low",
      sideEffect: "Adds a new comment thread to the Azure pull request.",
      reversibility:
        "The comment can be superseded by another comment, but the audit trail remains visible.",
      humanReason:
        "A human must confirm that the readiness result should be published to the team-visible PR conversation.",
      payloadSummary: [
        `PR: #${report.pullRequestId}`,
        `Stage gate: ${report.stageGate.label}`,
        `Readiness: ${report.readiness.label}`,
        `Blockers: ${report.readiness.blockers.length}`,
        `Human decisions: ${report.readiness.humanDecisions.length}`,
        `Comment length: ${comment.length} / ${AZURE_PR_COMMENT_LIMIT}`,
      ],
      confirmLabel: "Post Comment",
    });

    if (!confirmed) {
      return;
    }

    setCommentPostStates((current) => ({
      ...current,
      [report.pullRequestId]: {
        state: "loading",
        message: "Posting readiness comment...",
      },
    }));

    try {
      const response = await fetch(
        `/api/azure/pr/${report.pullRequestId}/comment`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...toAzureRequest(form, azurePat),
            comment: {
              content: comment,
            },
            confirmWrite: true,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to post PR comment.");
      }

      setCommentPostStates((current) => ({
        ...current,
        [report.pullRequestId]: {
          state: "success",
          message: `Posted Azure PR comment thread #${data.id ?? "unknown"}.`,
        },
      }));
      recordWriteActivity({
        operation: "post-comment",
        pullRequestId: report.pullRequestId,
        message: `Posted readiness comment thread #${data.id ?? "unknown"}.`,
        webUrl: findPullRequestWebUrl(overview, report.pullRequestId),
      });
    } catch (error) {
      setCommentPostStates((current) => ({
        ...current,
        [report.pullRequestId]: {
          state: "error",
          message: formatClientError(error),
        },
      }));
    }
  }

  async function linkWorkItemToPullRequest(pullRequestId: number) {
    const workItemId = workItemLinkInputs[pullRequestId]?.trim();
    const sourceBranch = findSourceBranchForPullRequest(
      overview,
      ruleChecks,
      pullRequestId,
    );

    if (!azurePat) {
      setWorkItemLinkStates((current) => ({
        ...current,
        [pullRequestId]: {
          state: "error",
          message: "Reconnect with a Work Items write-capable PAT before linking.",
        },
      }));
      return;
    }

    if (!sourceBranch || !isTestWriteAllowedBranch(sourceBranch)) {
      setWorkItemLinkStates((current) => ({
        ...current,
        [pullRequestId]: {
          state: "error",
          message: sourceBranch
            ? getTestWritePolicyMessage(sourceBranch)
            : "Cannot determine PR source branch; link write is blocked.",
        },
      }));
      return;
    }

    if (!workItemId || !/^\d+$/.test(workItemId)) {
      setWorkItemLinkStates((current) => ({
        ...current,
        [pullRequestId]: {
          state: "error",
          message: "Enter an Azure Boards Work Item ID.",
        },
      }));
      return;
    }

    setWorkItemLinkStates((current) => ({
      ...current,
      [pullRequestId]: {
        state: "loading",
        message: `Reading Work Item #${workItemId}...`,
      },
    }));

    let workItem: LinkedWorkItem;

    try {
      const response = await fetch(`/api/azure/work-item/${workItemId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toAzureRequest(form, azurePat)),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to read Work Item.");
      }

      workItem = data as LinkedWorkItem;
    } catch (error) {
      setWorkItemLinkStates((current) => ({
        ...current,
        [pullRequestId]: {
          state: "error",
          message: formatClientError(error),
        },
      }));
      return;
    }

    const confirmed = await requestWriteConfirmation({
      operation: "Link Work Item to pull request",
      target: `PR #${pullRequestId} <- ${formatWorkItemLabel(workItem)}`,
      risk: "medium",
      sideEffect:
        "Adds an Azure Boards Work Item relation to the pull request artifact.",
      reversibility:
        "The relation can be removed later in Azure Boards, but that removal is not part of the MVP.",
      humanReason:
        "A human must confirm the Work Item ID is the correct requirement, bug, or task for this PR.",
      payloadSummary: [
        `PR: #${pullRequestId}`,
        `Work Item: ${formatWorkItemLabel(workItem)}`,
        ...buildWorkItemPayloadSummary(workItem),
        "Scope: link existing Work Item to existing active PR",
      ],
      confirmLabel: "Link Work Item",
    });

    if (!confirmed) {
      setWorkItemLinkStates((current) => ({
        ...current,
        [pullRequestId]: {
          state: "idle",
          message: `Loaded ${formatWorkItemLabel(workItem)}. Link canceled.`,
        },
      }));
      return;
    }

    setWorkItemLinkStates((current) => ({
      ...current,
      [pullRequestId]: {
        state: "loading",
        message: "Linking Work Item...",
      },
    }));

    try {
      const response = await fetch(`/api/azure/pr/${pullRequestId}/work-item`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...toAzureRequest(form, azurePat),
          workItemId,
          confirmWrite: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to link Work Item.");
      }

      setWorkItemLinkStates((current) => ({
        ...current,
        [pullRequestId]: {
          state: "success",
          message: data.alreadyLinked
            ? `Work Item #${workItemId} was already linked to PR #${pullRequestId}.`
            : `Linked Work Item #${workItemId} to PR #${pullRequestId}. Refresh Azure data and rerun Delivery Gate.`,
        },
      }));
      setWorkItemLinkInputs((current) => ({
        ...current,
        [pullRequestId]: "",
      }));
      recordWriteActivity({
        operation: "link-work-item",
        pullRequestId,
        message: `Linked Work Item #${workItemId} to PR #${pullRequestId}.`,
        webUrl: findPullRequestWebUrl(overview, pullRequestId),
      });
    } catch (error) {
      setWorkItemLinkStates((current) => ({
        ...current,
        [pullRequestId]: {
          state: "error",
          message: formatClientError(error),
        },
      }));
    }
  }

  async function searchWorkItemCandidates(report: RuleCheckReport) {
    if (!azurePat) {
      setWorkItemCandidateStates((current) => ({
        ...current,
        [report.pullRequestId]: {
          state: "error",
          message: "Reconnect with a Work Items read-capable PAT before searching.",
          candidates: [],
          inferredIds: [],
        },
      }));
      return;
    }

    setWorkItemCandidateStates((current) => ({
      ...current,
      [report.pullRequestId]: {
        state: "loading",
        message: "Searching Azure Boards Work Items...",
        candidates: current[report.pullRequestId]?.candidates ?? [],
        inferredIds: current[report.pullRequestId]?.inferredIds ?? [],
      },
    }));

    try {
      const response = await fetch("/api/azure/work-items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...toAzureRequest(form, azurePat),
          searchText: buildWorkItemCandidateSearchText(report),
          top: 8,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to search Work Items.");
      }

      const result = data as WorkItemQueryResult;
      setWorkItemCandidateStates((current) => ({
        ...current,
        [report.pullRequestId]: {
          state: "success",
          message:
            result.workItems.length > 0
              ? `Found ${result.workItems.length} candidate Work Item(s).`
              : "No candidate Work Items were returned.",
          candidates: result.workItems,
          inferredIds: result.inferredIds,
        },
      }));
    } catch (error) {
      setWorkItemCandidateStates((current) => ({
        ...current,
        [report.pullRequestId]: {
          state: "error",
          message: formatClientError(error),
          candidates: current[report.pullRequestId]?.candidates ?? [],
          inferredIds: current[report.pullRequestId]?.inferredIds ?? [],
        },
      }));
    }
  }

  async function loadOverview() {
    const token = patInput.trim() || azurePat;

    setOverviewState("loading");
    setOverviewError("");
    setPrDetail(null);
    setSelectedPrId(null);
    setRuleChecks([]);
    setRuleCheckState("idle");
    setRuleCheckError("");
    setCommentCopyId(null);
    setCommentPostStates({});
    setDescriptionPreview(null);
    setDescriptionCopyState("idle");
    setDescriptionUpdateStates({});
    setWorkItemLinkInputs({});
    setWorkItemLinkStates({});
    setWorkItemCandidateStates({});
    setPatInput("");

    if (!token) {
      setOverviewState("error");
      setOverviewError("Personal Access Token is required.");
      return;
    }

    window.localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({
        orgUrl: form.orgUrl,
        project: form.project,
        repository: form.repository,
      }),
    );

    try {
      const response = await fetch("/api/azure/overview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toAzureRequest(form, token)),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load Azure overview.");
      }

      const loadedOverview = data as AzureOverview;
      setOverview(loadedOverview);
      setAzurePat(token);
      setOverviewState("success");
      setCreatePrForm(buildInitialCreatePrForm(loadedOverview));
      setCreatePrState({ state: "idle" });
    } catch (error) {
      setOverviewState("error");
      setOverviewError(formatClientError(error));
    }
  }

  async function inspectPullRequest(pullRequest: PullRequestSummary) {
    if (!azurePat) {
      setPrState("error");
      setPrError("Reconnect with a PAT before inspecting PR details.");
      return;
    }

    setSelectedPrId(pullRequest.id);
    setPrState("loading");
    setPrError("");

    try {
      const response = await fetch(`/api/azure/pr/${pullRequest.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toAzureRequest(form, azurePat)),
      });

      const data = await response.json();

      if (!response.ok || isPrErrorResponse(data)) {
        throw new Error(data.error ?? "Failed to inspect pull request.");
      }

      setPrDetail(data as PullRequestDetail);
      setPrState("success");
    } catch (error) {
      setPrState("error");
      setPrError(formatClientError(error));
    }
  }

  async function runRuleChecks() {
    if (!overview) {
      return;
    }

    if (!azurePat) {
      setRuleCheckState("error");
      setRuleCheckError("Reconnect with a PAT before running rule checks.");
      return;
    }

    setRuleCheckState("loading");
    setRuleCheckError("");
    setWorkItemCandidateStates({});

    try {
      const targetPullRequests =
        ruleCheckMode === "delivery"
          ? activePullRequests
          : overview.pullRequests;

      if (targetPullRequests.length === 0) {
        setRuleChecks([]);
        setRuleCheckState("success");
        return;
      }

      const reports = await mapWithConcurrency(
        targetPullRequests,
        4,
        async (pullRequest) => {
          const response = await fetch(`/api/azure/pr/${pullRequest.id}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(toAzureRequest(form, azurePat)),
          });

          const data = await response.json();

          if (!response.ok || isPrErrorResponse(data)) {
            return buildFailedRuleReport(
              pullRequest,
              data.error ?? "Failed to inspect pull request.",
            );
          }

          return evaluatePullRequestRules(
            pullRequest,
            data as PullRequestDetail,
          );
        },
      );

      setRuleChecks(reports);
      recordRuleCheckHistory(ruleCheckMode, reports);
      setRuleCheckState("success");
    } catch (error) {
      setRuleCheckState("error");
      setRuleCheckError(formatClientError(error));
    }
  }

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white px-3 py-1 text-sm text-[var(--muted)]">
              <ShieldCheck size={16} />
              Guarded Azure DevOps integration
            </div>
            <h1 className="text-3xl font-semibold tracking-normal">
              AI Development Control Plane
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Connect to Azure Repos, inspect branches, pull requests, linked
              Work Items, build status, and PR file changes. Azure writes are
              limited to explicit human-confirmed PR comments, PR descriptions,
              PR creation, and Work Item links.
            </p>
          </div>
          <StatusPill state={overviewState} />
        </header>

        <section className="grid gap-5 lg:grid-cols-[380px_1fr]">
          <ConnectionPanel
            form={form}
            state={overviewState}
            error={overviewError}
            patInput={patInput}
            hasToken={Boolean(azurePat)}
            onChange={updateForm}
            onPatChange={setPatInput}
            onDisconnect={() => {
              setAzurePat("");
              setPatInput("");
              setOverview(null);
              setOverviewState("idle");
              setOverviewError("");
              setPrDetail(null);
              setSelectedPrId(null);
              setRuleChecks([]);
              setRuleCheckState("idle");
              setRuleCheckError("");
              setCommentCopyId(null);
              setAgentPacketCopyId(null);
              setCommentPostStates({});
              setDescriptionPreview(null);
              setDescriptionCopyState("idle");
              setDescriptionUpdateStates({});
              setWorkItemLinkInputs({});
              setWorkItemLinkStates({});
              setWorkItemCandidateStates({});
              setCreatePrForm(emptyCreatePrForm());
              setCreatePrState({ state: "idle" });
              resolveWriteConfirmation(false);
            }}
            onSubmit={loadOverview}
          />

          <div className="flex flex-col gap-5">
            <ReadOnlyBoundary />
            <ControlPlaneReadinessPanel
              overview={overview}
              ruleChecks={ruleChecks}
              ruleCheckHistory={clientReady ? ruleCheckHistory : []}
              writeActivities={clientReady ? writeActivities : []}
            />
            <WriteActivityLog
              activities={clientReady ? writeActivities : []}
              onClear={clearWriteActivities}
            />
            <RuleCheckHistoryPanel
              copiedId={historyCopyId}
              entries={clientReady ? ruleCheckHistory : []}
              onClear={clearRuleCheckHistory}
              onCopy={copyRuleCheckHistory}
            />

            {overview ? (
              <>
                <RepositoryOverview overview={overview} />
                <BranchOverview branchesByClass={branchesByClass} />
                <GitFlowPolicyPanel />
                <RepoRuleSourcesPanel sources={overview.ruleSources} />
                <RequestIntakePanel
                  activeRequest={selectedRequest}
                  copyState={requestPromptCopyState}
                  form={requestIntakeForm}
                  overview={overview}
                  records={clientReady ? requestIntakeRecords : []}
                  selectedRequestId={selectedRequestId}
                  onChange={updateRequestIntakeForm}
                  onClear={clearRequestIntakeRecords}
                  onCopy={copyAgent0DispatchPrompt}
                  onCreate={createRequestIntake}
                  onSelect={(requestId) => {
                    setSelectedRequestId(requestId);
                    setRequestPromptCopyState("idle");
                  }}
                />
                <CreatePullRequestPanel
                  activePullRequests={activePullRequests}
                  branches={overview.branches}
                  form={createPrForm}
                  state={createPrState}
                  onCreate={createPullRequest}
                  onDraftChange={(isDraft) =>
                    setCreatePrForm((current) => ({ ...current, isDraft }))
                  }
                  onPolicyAcknowledgedChange={(policyAcknowledged) => {
                    setCreatePrForm((current) => ({
                      ...current,
                      policyAcknowledged,
                    }));
                    setCreatePrState({ state: "idle" });
                  }}
                  onSourceChange={updateCreatePrSource}
                  onTargetChange={updateCreatePrTarget}
                  onTitleChange={(title) => {
                    setCreatePrForm((current) => ({ ...current, title }));
                    setCreatePrState({ state: "idle" });
                  }}
                />
                <PullRequestTable
                  pullRequests={overview.pullRequests}
                  activeCount={activePullRequests.length}
                  selectedPrId={selectedPrId}
                  onInspect={inspectPullRequest}
                />
                <RuleCheckPanel
                  state={ruleCheckState}
                  error={ruleCheckError}
                  reports={ruleChecks}
                  mode={ruleCheckMode}
                  activeCount={activePullRequests.length}
                  totalCount={overview.pullRequests.length}
                  copyState={copyState}
                  commentCopyId={commentCopyId}
                  agentPacketCopyId={agentPacketCopyId}
                  commentPostStates={commentPostStates}
                  workItemLinkInputs={workItemLinkInputs}
                  workItemLinkStates={workItemLinkStates}
                  workItemCandidateStates={workItemCandidateStates}
                  descriptionPreview={descriptionPreview}
                  descriptionCopyState={descriptionCopyState}
                  descriptionUpdateState={
                    descriptionPreview
                      ? descriptionUpdateStates[
                          descriptionPreview.pullRequestId
                        ]
                      : undefined
                  }
                  onModeChange={changeRuleCheckMode}
                  onRun={runRuleChecks}
                  onPreviewDescription={(report) => {
                    setDescriptionPreview({
                      pullRequestId: report.pullRequestId,
                      sourceBranch: report.sourceBranch,
                      content: buildPullRequestDescriptionPreview(report),
                    });
                    setDescriptionCopyState("idle");
                    setDescriptionUpdateStates((current) => ({
                      ...current,
                      [report.pullRequestId]: { state: "idle" },
                    }));
                  }}
                  onCloseDescriptionPreview={() => {
                    setDescriptionPreview(null);
                    setDescriptionCopyState("idle");
                  }}
                  onCopyDescriptionPreview={async () => {
                    if (!descriptionPreview) {
                      return;
                    }

                    try {
                      await navigator.clipboard.writeText(
                        descriptionPreview.content,
                      );
                      setDescriptionCopyState("copied");
                      window.setTimeout(
                        () => setDescriptionCopyState("idle"),
                        2000,
                      );
                    } catch {
                      setDescriptionCopyState("error");
                    }
                  }}
                  onUpdateDescriptionPreview={updatePullRequestDescriptionPreview}
                  onPostPrComment={postPullRequestReadinessComment}
                  onWorkItemInputChange={(pullRequestId, value) =>
                    setWorkItemLinkInputs((current) => ({
                      ...current,
                      [pullRequestId]: value,
                    }))
                  }
                  onSearchWorkItems={searchWorkItemCandidates}
                  onUseWorkItemCandidate={(pullRequestId, workItemId) =>
                    setWorkItemLinkInputs((current) => ({
                      ...current,
                      [pullRequestId]: workItemId,
                    }))
                  }
                  onLinkWorkItem={linkWorkItemToPullRequest}
                  onCopyPrComment={async (report) => {
                    try {
                      await navigator.clipboard.writeText(
                        buildPullRequestReadinessComment(report),
                      );
                      setCommentCopyId(report.pullRequestId);
                      window.setTimeout(() => setCommentCopyId(null), 2000);
                    } catch {
                      setCommentCopyId(null);
                    }
                  }}
                  onCopyAgentPacket={async (report) => {
                    try {
                      await navigator.clipboard.writeText(
                        buildAgentPacket(report, selectedRequest ?? undefined),
                      );
                      setAgentPacketCopyId(report.pullRequestId);
                      window.setTimeout(() => setAgentPacketCopyId(null), 2000);
                    } catch {
                      setAgentPacketCopyId(null);
                    }
                  }}
                  onCopy={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        buildMarkdownReport(ruleChecks),
                      );
                      setCopyState("copied");
                      window.setTimeout(() => setCopyState("idle"), 2000);
                    } catch {
                      setCopyState("error");
                    }
                  }}
                />
                <PullRequestDetailPanel
                  state={prState}
                  error={prError}
                  detail={prDetail}
                  selectedPrId={selectedPrId}
                />
              </>
            ) : (
              <EmptyState />
            )}
          </div>
        </section>
      </div>
      <GuardedWriteConfirmationModal
        confirmation={pendingWriteConfirmation}
        onCancel={() => resolveWriteConfirmation(false)}
        onConfirm={() => resolveWriteConfirmation(true)}
      />
    </main>
  );
}

function ConnectionPanel({
  form,
  state,
  error,
  patInput,
  hasToken,
  onChange,
  onPatChange,
  onDisconnect,
  onSubmit,
}: {
  form: ConnectionForm;
  state: LoadState;
  error: string;
  patInput: string;
  hasToken: boolean;
  onChange: (field: keyof ConnectionForm, value: string) => void;
  onPatChange: (value: string) => void;
  onDisconnect: () => void;
  onSubmit: () => void;
}) {
  const loading = state === "loading";

  return (
    <aside className="h-fit rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <GitBranch size={18} />
        <h2 className="text-lg font-semibold">Project Connection</h2>
      </div>

      <div className="grid gap-3">
        <TextField
          label="Azure organization URL"
          value={form.orgUrl}
          placeholder="https://dev.azure.com/odin-tech"
          onChange={(value) => onChange("orgUrl", value)}
        />
        <TextField
          label="Project"
          value={form.project}
          placeholder="MT5-Trading-Platform"
          onChange={(value) => onChange("project", value)}
        />
        <TextField
          label="Repository"
          value={form.repository}
          placeholder="odin-mt5-web"
          onChange={(value) => onChange("repository", value)}
        />
        <TextField
          label="Personal Access Token"
          value={patInput}
          placeholder="Azure DevOps PAT"
          type="password"
          autoComplete="off"
          onChange={onPatChange}
        />
      </div>

      <div className="mt-4 grid gap-2">
        <button
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--blue)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
          type="button"
          disabled={loading}
          onClick={onSubmit}
          title="Connect to Azure DevOps using guarded REST API calls"
        >
          {loading ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <Search size={18} />
          )}
          {loading
            ? "Connecting"
            : hasToken && !patInput
              ? "Refresh Azure"
              : "Connect Azure"}
        </button>

        {hasToken ? (
          <button
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--red)] hover:text-[var(--red)]"
            type="button"
            onClick={onDisconnect}
            title="Clear the in-memory PAT and loaded Azure data"
          >
            <XCircle size={18} />
            Disconnect / Clear Token
          </button>
        ) : null}
      </div>

      <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
        Project settings are stored in local storage. The PAT is never written
        to local storage or session storage; after connect it is cleared from
        the input and kept only in this page&apos;s memory.
      </p>

      <PatScopeGuide />

      {error ? <ErrorNotice className="mt-4" message={error} /> : null}
    </aside>
  );
}

function PatScopeGuide() {
  return (
    <div className="mt-4 rounded-md border border-[var(--line)] bg-white p-3">
      <div className="text-sm font-semibold">PAT Scopes</div>
      <div className="mt-2 grid gap-2 text-xs leading-5 text-[var(--muted)]">
        <div>
          <span className="font-semibold text-[var(--foreground)]">
            Read checks:
          </span>{" "}
          Code Read, Pull Requests Read, Work Items Read, Build Read.
        </div>
        <div>
          <span className="font-semibold text-[var(--foreground)]">
            Guarded writes:
          </span>{" "}
          Pull Requests Read &amp; write is required only for create PR, PR
          description update, or PR comment posting. Work Items Read &amp;
          write is required only for linking an existing Work Item to a PR.
        </div>
        <div>
          The MVP does not need Build execute, Release, Test Management,
          Packaging, deploy, merge, or branch policy mutation scopes.
        </div>
      </div>
    </div>
  );
}

function ErrorNotice({
  className = "",
  message,
}: {
  className?: string;
  message: string;
}) {
  const classification = classifyControlPlaneError(message);

  return (
    <div
      className={`rounded-md border ${classification.borderClass} ${classification.backgroundClass} p-3 text-sm ${classification.textClass} ${className}`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 shrink-0" size={16} />
        <div className="min-w-0">
          <div className="font-semibold">{classification.title}</div>
          <p className="mt-1 leading-5">{classification.action}</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold">
              Technical detail
            </summary>
            <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-white/70 p-2 text-xs leading-5">
              {message}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}

function DiagnosticSummary({ message }: { message: string }) {
  const classification = classifyControlPlaneError(message);

  return (
    <div className="rounded border border-white bg-white/70 p-2">
      <div className="font-semibold">{classification.title}</div>
      <div className="mt-1 text-xs leading-5">{classification.action}</div>
      <div className="mt-1 break-words text-xs opacity-80">{message}</div>
    </div>
  );
}

function TextField({
  label,
  value,
  placeholder,
  type = "text",
  autoComplete,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  type?: "text" | "password";
  autoComplete?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <input
        className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none transition focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-soft)]"
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ReadOnlyBoundary() {
  return (
    <section className="rounded-lg border border-[var(--green)] bg-[var(--green-soft)] p-4 text-sm text-[#0f5132]">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 shrink-0" size={20} />
        <div>
          <h2 className="font-semibold">Guarded write boundary</h2>
          <p className="mt-1 leading-6">
            This MVP reads Azure DevOps evidence and only writes PR comments,
            PR descriptions, new PRs, or Work Item links after explicit
            confirmation. It does not create branches, update Work Item fields,
            approve reviews, merge, or deploy.
          </p>
        </div>
      </div>
    </section>
  );
}

function ControlPlaneReadinessPanel({
  overview,
  ruleChecks,
  ruleCheckHistory,
  writeActivities,
}: {
  overview: AzureOverview | null;
  ruleChecks: RuleCheckReport[];
  ruleCheckHistory: RuleCheckHistoryEntry[];
  writeActivities: WriteActivity[];
}) {
  const items = buildControlPlaneReadinessItems(
    overview,
    ruleChecks,
    ruleCheckHistory,
    writeActivities,
  );

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">MVP Control Plane Readiness</h2>
          <p className="text-sm text-[var(--muted)]">
            Self-checks the minimum evidence needed for Azure repo governance,
            rule-aware PR inspection, and audited handoff.
          </p>
        </div>
        <ShieldCheck size={20} />
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {items.map((item) => (
          <div
            className="rounded-md border border-[var(--line)] bg-white p-3 text-sm"
            key={item.label}
          >
            <div className="flex items-start gap-2">
              <ReadinessStatusIcon status={item.status} />
              <div>
                <div className="font-semibold">{item.label}</div>
                <div className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  {item.detail}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReadinessStatusIcon({
  status,
}: {
  status: "ready" | "pending" | "attention";
}) {
  if (status === "ready") {
    return <CheckCircle2 className="mt-0.5 shrink-0 text-[var(--green)]" size={16} />;
  }

  if (status === "attention") {
    return (
      <AlertTriangle
        className="mt-0.5 shrink-0 text-[var(--amber)]"
        size={16}
      />
    );
  }

  return <Search className="mt-0.5 shrink-0 text-[var(--muted)]" size={16} />;
}

function GuardedWriteConfirmationModal({
  confirmation,
  onCancel,
  onConfirm,
}: {
  confirmation: PendingWriteConfirmation | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!confirmation) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section
        aria-modal="true"
        className="w-full max-w-2xl rounded-lg border border-[var(--line)] bg-white p-5 shadow-xl"
        role="dialog"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 shrink-0 text-[var(--amber)]"
            size={22}
          />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">
              Confirm Azure Write Operation
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
              This action changes Azure DevOps state and requires explicit
              human confirmation.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm">
          <WriteConfirmationRow label="Operation" value={confirmation.operation} />
          <WriteConfirmationRow label="Target" value={confirmation.target} />
          <WriteConfirmationRow label="Risk" value={confirmation.risk} />
          <WriteConfirmationRow
            label="Side effect"
            value={confirmation.sideEffect}
          />
          <WriteConfirmationRow
            label="Reversibility"
            value={confirmation.reversibility}
          />
          <WriteConfirmationRow
            label="Human reason"
            value={confirmation.humanReason}
          />
        </div>

        <div className="mt-4 rounded-md border border-[var(--line)] bg-[var(--panel)] p-3">
          <div className="text-sm font-semibold">Payload Summary</div>
          <ul className="mt-2 grid gap-1 text-xs leading-5 text-[var(--muted)]">
            {confirmation.payloadSummary.map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            className="inline-flex items-center justify-center rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--red)] hover:text-[var(--red)]"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="inline-flex items-center justify-center rounded-md bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            type="button"
            onClick={onConfirm}
          >
            {confirmation.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function WriteConfirmationRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid gap-1 rounded-md border border-[var(--line)] bg-[var(--panel)] p-3 sm:grid-cols-[140px_1fr]">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
      <div className="text-sm leading-6">{value}</div>
    </div>
  );
}

function WriteActivityLog({
  activities,
  onClear,
}: {
  activities: WriteActivity[];
  onClear: () => void;
}) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Write Activity</h2>
          <p className="text-sm text-[var(--muted)]">
            Local record of Azure write operations performed through this page.
            PAT and payload content are not stored.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activities.length > 0 ? (
            <button
              className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--red)] hover:text-[var(--red)]"
              type="button"
              onClick={onClear}
              title="Clear local write activity records"
            >
              <XCircle size={14} />
              Clear
            </button>
          ) : null}
          <ShieldCheck size={20} />
        </div>
      </div>

      {activities.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed border-[var(--line-strong)] p-3 text-sm text-[var(--muted)]">
          No Azure writes recorded on this device.
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          {activities.map((activity) => (
            <div
              className="rounded-md border border-[var(--line)] bg-white p-3 text-sm"
              key={activity.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">
                  {writeOperationLabels[activity.operation]} on PR #
                  {activity.pullRequestId}
                </div>
                <span className="rounded-full bg-[var(--green-soft)] px-2 py-1 text-xs font-semibold text-[var(--green)]">
                  {activity.status}
                </span>
              </div>
              <div className="mt-1 text-xs leading-5 text-[var(--muted)]">
                {activity.message}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                <span>{formatActivityTime(activity.createdAt)}</span>
                {activity.webUrl ? (
                  <a
                    className="inline-flex items-center gap-1 font-semibold text-[var(--blue)] hover:underline"
                    href={activity.webUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open PR <ExternalLink size={12} />
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RuleCheckHistoryPanel({
  copiedId,
  entries,
  onClear,
  onCopy,
}: {
  copiedId: string | null;
  entries: RuleCheckHistoryEntry[];
  onClear: () => void;
  onCopy: (entry: RuleCheckHistoryEntry) => void;
}) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Rule Check History</h2>
          <p className="text-sm text-[var(--muted)]">
            Local audit trail of Delivery Gate and Historical Audit runs. Azure
            credentials are not stored.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {entries.length > 0 ? (
            <button
              className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--red)] hover:text-[var(--red)]"
              type="button"
              onClick={onClear}
              title="Clear local rule check history"
            >
              <XCircle size={14} />
              Clear
            </button>
          ) : null}
          <Search size={20} />
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed border-[var(--line-strong)] p-3 text-sm text-[var(--muted)]">
          No rule check runs recorded on this device.
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          {entries.map((entry) => (
            <div
              className="rounded-md border border-[var(--line)] bg-white p-3 text-sm"
              key={entry.id}
            >
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="font-semibold">
                    {entry.mode === "delivery"
                      ? "Delivery Gate"
                      : "Historical Audit"}{" "}
                    on {entry.repository}
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    {formatActivityTime(entry.createdAt)}
                  </div>
                </div>
                <button
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--blue)] hover:text-[var(--blue)]"
                  type="button"
                  onClick={() => onCopy(entry)}
                  title="Copy this saved rule check report"
                >
                  <Clipboard size={14} />
                  {copiedId === entry.id ? "Copied" : "Copy report"}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-white px-2 py-1 font-semibold text-[var(--muted)]">
                  Checked: {entry.checkedCount}
                </span>
                <span className="rounded-full bg-[var(--red-soft)] px-2 py-1 font-semibold text-[var(--red)]">
                  Blocked: {entry.blockedCount}
                </span>
                <span className="rounded-full bg-[var(--amber-soft)] px-2 py-1 font-semibold text-[var(--amber)]">
                  Warnings: {entry.warningCount}
                </span>
                <span className="rounded-full bg-[var(--green-soft)] px-2 py-1 font-semibold text-[var(--green)]">
                  Passed: {entry.passedCount}
                </span>
              </div>
              {entry.gateSummary.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                  {entry.gateSummary.map((item) => (
                    <span
                      className="rounded-full border border-[var(--line)] px-2 py-1"
                      key={`${entry.id}-${item.label}`}
                    >
                      {item.label}: {item.count}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RepositoryOverview({ overview }: { overview: AzureOverview }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Repository" value={overview.repository.name} />
      <MetricCard
        label="Branches"
        value={String(overview.branches.length)}
      />
      <MetricCard
        label="Pull Requests"
        value={String(overview.pullRequests.length)}
      />
      <MetricCard
        label="Protected Ready"
        value={
          Object.values(overview.protectedBranches).every(Boolean)
            ? "Yes"
            : "Check"
        }
      />
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
      <div className="mt-2 truncate text-xl font-semibold">{value}</div>
    </div>
  );
}

function BranchOverview({
  branchesByClass,
}: {
  branchesByClass: Record<BranchClass, BranchSummary[]>;
}) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Branches</h2>
          <p className="text-sm text-[var(--muted)]">
            Expected classes: protected, feature, bug, hotfix.
          </p>
        </div>
        <GitBranch size={20} />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {(Object.keys(branchesByClass) as BranchClass[]).map((className) => (
          <div
            className="min-w-0 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3"
            key={className}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                {branchClassLabels[className]}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-[var(--muted)]">
                {branchesByClass[className].length}
              </span>
            </div>
            <div className="mt-3 grid gap-2">
              {branchesByClass[className].slice(0, 6).map((branch) => (
                <code
                  className="truncate rounded bg-white px-2 py-1 text-xs text-[var(--foreground)]"
                  key={branch.name}
                  title={branch.name}
                >
                  {branch.name}
                </code>
              ))}
              {branchesByClass[className].length === 0 ? (
                <span className="text-xs text-[var(--muted)]">No branches</span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function GitFlowPolicyPanel() {
  const branchClasses: BranchClass[] = [
    "feature",
    "bug",
    "ai-training",
    "hotfix",
    "other",
  ];

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">GitFlow Policy</h2>
          <p className="text-sm text-[var(--muted)]">
            Branch target rules used by Create PR and Delivery Gate.
          </p>
        </div>
        <GitBranch size={20} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {branchClasses.map((className) => {
          const targets = ODIN_MT5_WEB_RULES.branchTargets[className] ?? [];
          const pending =
            ODIN_MT5_WEB_RULES.pendingBranchTargetClasses[className];
          return (
            <div
              className="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3 text-sm"
              key={className}
            >
              <div className="font-semibold">{branchClassLabels[className]}</div>
              {targets.length > 0 ? (
                <div className="mt-2 text-xs leading-5 text-[var(--muted)]">
                  Target:{" "}
                  {targets.map((target) => (
                    <code className="rounded bg-white px-1 py-0.5" key={target}>
                      {target}
                    </code>
                  ))}
                </div>
              ) : pending ? (
                <div className="mt-2 rounded border border-[var(--amber)] bg-[var(--amber-soft)] p-2 text-xs leading-5 text-[var(--amber)]">
                  {pending}
                </div>
              ) : (
                <div className="mt-2 text-xs leading-5 text-[var(--muted)]">
                  Requires manual GitFlow confirmation before PR creation.
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
        {ODIN_MT5_WEB_RULES.protectedBranches.map((branch) => (
          <span
            className="rounded-full border border-[var(--line)] bg-white px-2 py-1"
            key={branch}
          >
            protected: {branch}
          </span>
        ))}
      </div>
    </section>
  );
}

function RepoRuleSourcesPanel({ sources }: { sources: RepoRuleSource[] }) {
  const presentCount = sources.filter((source) => source.status === "present")
    .length;

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Repo Rule Sources</h2>
          <p className="text-sm text-[var(--muted)]">
            Loaded {presentCount} / {sources.length} rule files from Azure
            Repos develop branch.
          </p>
        </div>
        <ShieldCheck size={20} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {sources.map((source) => (
          <div
            className="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3"
            key={source.path}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <a
                className="inline-flex min-w-0 items-center gap-1 text-[var(--blue)] hover:underline"
                href={source.webUrl}
                rel="noreferrer"
                target="_blank"
                title="Open this rule source in Azure Repos"
              >
                <code className="truncate text-xs" title={source.path}>
                  {source.path}
                </code>
                <ExternalLink className="shrink-0" size={11} />
              </a>
              <RuleSourceStatusBadge status={source.status} />
            </div>
            <div className="mt-2 text-xs text-[var(--muted)]">
              branch: {source.branch}
            </div>
            {source.excerpt ? (
              <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs leading-5">
                {source.excerpt}
              </pre>
            ) : (
              <div className="mt-2 rounded bg-white p-2 text-xs leading-5 text-[var(--muted)]">
                {source.diagnostic ?? "No excerpt available."}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function RuleSourceStatusBadge({
  status,
}: {
  status: RepoRuleSource["status"];
}) {
  const style =
    status === "present"
      ? "bg-[var(--green-soft)] text-[var(--green)]"
      : status === "missing"
        ? "bg-[var(--amber-soft)] text-[var(--amber)]"
        : "bg-[var(--red-soft)] text-[var(--red)]";

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${style}`}>
      {status}
    </span>
  );
}

function RequestIntakePanel({
  activeRequest,
  copyState,
  form,
  overview,
  records,
  selectedRequestId,
  onChange,
  onClear,
  onCopy,
  onCreate,
  onSelect,
}: {
  activeRequest: RequestIntakeRecord | null;
  copyState: "idle" | "copied" | "error";
  form: RequestIntakeForm;
  overview: AzureOverview;
  records: RequestIntakeRecord[];
  selectedRequestId: string;
  onChange: <Field extends keyof RequestIntakeForm>(
    field: Field,
    value: RequestIntakeForm[Field],
  ) => void;
  onClear: () => void;
  onCopy: (record: RequestIntakeRecord) => void;
  onCreate: () => void;
  onSelect: (requestId: string) => void;
}) {
  const prompt = activeRequest ? buildAgent0DispatchPrompt(activeRequest) : "";
  const canCreate = Boolean(form.title.trim() && form.detail.trim());
  const selectedPrReference =
    form.azureReferenceType === "pr" ? form.azureReferenceId : "";

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Request Intake</h2>
          <p className="text-sm text-[var(--muted)]">
            Capture the user&apos;s request as local intake evidence and generate an
            Agent0 dispatch prompt without writing Azure DevOps state.
          </p>
        </div>
        <Clipboard size={20} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Request kind
              <select
                className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none transition focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-soft)]"
                value={form.kind}
                onChange={(event) =>
                  onChange(
                    "kind",
                    event.target.value as RequestIntakeForm["kind"],
                  )
                }
              >
                {REQUEST_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5 text-sm font-medium">
              Task Level
              <select
                className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none transition focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-soft)]"
                value={form.taskLevel}
                onChange={(event) =>
                  onChange(
                    "taskLevel",
                    event.target.value as RequestIntakeForm["taskLevel"],
                  )
                }
              >
                {TASK_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <TextField
            label="Request title"
            placeholder="member-filter"
            value={form.title}
            onChange={(value) => onChange("title", value)}
          />

          <label className="grid gap-1.5 text-sm font-medium">
            Request detail
            <textarea
              className="min-h-36 resize-y rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-soft)]"
              placeholder="Describe the request, bug, refactor, documentation task, or operation task."
              value={form.detail}
              onChange={(event) => onChange("detail", event.target.value)}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Optional Azure reference
              <select
                className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none transition focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-soft)]"
                value={form.azureReferenceType}
                onChange={(event) =>
                  onChange(
                    "azureReferenceType",
                    event.target.value as AzureReferenceType,
                  )
                }
              >
                <option value="none">None</option>
                <option value="pr">Pull Request</option>
                <option value="work-item">Work Item</option>
              </select>
            </label>

            {form.azureReferenceType === "pr" ? (
              <label className="grid gap-1.5 text-sm font-medium">
                Pull Request
                <select
                  className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none transition focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-soft)]"
                  value={selectedPrReference}
                  onChange={(event) =>
                    onChange("azureReferenceId", event.target.value)
                  }
                >
                  <option value="">Select PR</option>
                  {overview.pullRequests.map((pullRequest) => (
                    <option
                      key={pullRequest.id}
                      value={String(pullRequest.id)}
                    >
                      #{pullRequest.id} {pullRequest.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : form.azureReferenceType === "work-item" ? (
              <TextField
                label="Work Item ID"
                placeholder="795"
                value={form.azureReferenceId}
                onChange={(value) => onChange("azureReferenceId", value)}
              />
            ) : (
              <div className="rounded-md border border-[var(--line)] bg-white p-3 text-xs leading-5 text-[var(--muted)]">
                No Azure reference is required for local intake.
              </div>
            )}
          </div>

          <div className="rounded-md border border-[var(--amber)] bg-[var(--amber-soft)] p-3 text-xs leading-5 text-[var(--amber)]">
            Request detail is intake evidence only. It is not confirmed Spec,
            Figma, Swagger/API, QA, or implementation scope.
          </div>

          <button
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            type="button"
            disabled={!canCreate}
            onClick={onCreate}
            title="Create a local Request ID and Agent0 dispatch prompt"
          >
            <Clipboard size={16} />
            Generate Request ID
          </button>
        </div>

        <div className="grid gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="grid flex-1 gap-1.5 text-sm font-medium">
              Local request record
              <select
                className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none transition focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-soft)]"
                value={selectedRequestId}
                onChange={(event) => onSelect(event.target.value)}
              >
                {records.length === 0 ? (
                  <option value="">No local request records</option>
                ) : null}
                {records.map((record) => (
                  <option key={record.requestId} value={record.requestId}>
                    {record.requestId}
                  </option>
                ))}
              </select>
            </label>

            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--blue)] hover:text-[var(--blue)] disabled:opacity-60"
              type="button"
              disabled={!activeRequest}
              onClick={() => activeRequest && onCopy(activeRequest)}
              title="Copy the Agent0 dispatch prompt"
            >
              <Clipboard size={14} />
              {copyState === "copied" ? "Copied" : "Copy Agent0 Prompt"}
            </button>

            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--red)] hover:text-[var(--red)] disabled:opacity-60"
              type="button"
              disabled={records.length === 0}
              onClick={onClear}
              title="Clear local request records only"
            >
              <XCircle size={14} />
              Clear
            </button>
          </div>

          {copyState === "error" ? (
            <div className="rounded border border-[var(--red)] bg-[var(--red-soft)] p-2 text-xs text-[var(--red)]">
              Could not copy Agent0 prompt.
            </div>
          ) : null}

          {activeRequest ? (
            <div className="rounded-md border border-[var(--line)] bg-white p-3">
              <div className="mb-2 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                <span className="rounded-full bg-[var(--panel)] px-2 py-1">
                  {activeRequest.kind}
                </span>
                <span className="rounded-full bg-[var(--panel)] px-2 py-1">
                  {activeRequest.taskLevel}
                </span>
                <span className="rounded-full bg-[var(--panel)] px-2 py-1">
                  local only
                </span>
              </div>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-[var(--line)] bg-[var(--panel)] p-3 text-xs leading-5">
                {prompt}
              </pre>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-[var(--line-strong)] p-4 text-sm text-[var(--muted)]">
              Generate a local Request ID to preview an Agent0 dispatch prompt.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CreatePullRequestPanel({
  activePullRequests,
  branches,
  form,
  state,
  onCreate,
  onDraftChange,
  onPolicyAcknowledgedChange,
  onSourceChange,
  onTargetChange,
  onTitleChange,
}: {
  activePullRequests: PullRequestSummary[];
  branches: BranchSummary[];
  form: CreatePrForm;
  state: CreatePrState;
  onCreate: () => void;
  onDraftChange: (isDraft: boolean) => void;
  onPolicyAcknowledgedChange: (acknowledged: boolean) => void;
  onSourceChange: (sourceBranch: string) => void;
  onTargetChange: (targetBranch: string) => void;
  onTitleChange: (title: string) => void;
}) {
  const sourceBranches = branches.filter(
    (branch) => !branch.isProtected && isTestWriteAllowedBranch(branch.name),
  );
  const targetBranches = branches.filter((branch) => branch.isProtected);
  const description = buildCreatePullRequestDescription(form);
  const warnings = getCreatePullRequestWarnings(form);
  const existingPullRequest = findExistingActivePullRequest(
    activePullRequests,
    form,
  );
  const disabled =
    state.state === "loading" ||
    !form.sourceBranch ||
    !isTestWriteAllowedBranch(form.sourceBranch) ||
    !form.targetBranch ||
    !form.title.trim() ||
    Boolean(existingPullRequest) ||
    (warnings.length > 0 && !form.policyAcknowledged) ||
    description.length > AZURE_PR_DESCRIPTION_LIMIT;

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Create Pull Request</h2>
          <p className="text-sm text-[var(--muted)]">
            Create an Azure PR from an existing branch using the repo GitFlow
            target recommendation and a control-plane description block.
          </p>
        </div>
        <GitPullRequest size={20} />
      </div>

      <div className="mb-3 rounded-md border border-[var(--blue)] bg-[var(--blue-soft)] p-3 text-xs leading-5 text-[var(--blue)]">
        Testing-stage write policy: Create PR is limited to{" "}
        <code>{TEST_WRITE_BRANCH_PREFIX}*</code>. Other branches remain
        read-only in this App.
      </div>

      {sourceBranches.length === 0 || targetBranches.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--line-strong)] p-4 text-sm text-[var(--muted)]">
          A writable {TEST_WRITE_BRANCH_PREFIX} source branch and protected
          target branch must be loaded before the App can create a PR.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm font-medium">
              Source branch
              <select
                className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none transition focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-soft)]"
                value={form.sourceBranch}
                onChange={(event) => onSourceChange(event.target.value)}
              >
                {sourceBranches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5 text-sm font-medium">
              Target branch
              <select
                className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none transition focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-soft)]"
                value={form.targetBranch}
                onChange={(event) => onTargetChange(event.target.value)}
              >
                {targetBranches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>

            <TextField
              label="PR title"
              value={form.title}
              placeholder="feature/member-filter"
              onChange={onTitleChange}
            />

            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                checked={form.isDraft}
                className="h-4 w-4"
                type="checkbox"
                onChange={(event) => onDraftChange(event.target.checked)}
              />
              Create as draft PR
            </label>

            {warnings.length > 0 ? (
              <div className="rounded-md border border-[var(--amber)] bg-[var(--amber-soft)] p-3 text-xs leading-5 text-[var(--amber)]">
                <div>
                  {warnings.map((warning) => (
                    <div key={warning}>- {warning}</div>
                  ))}
                </div>
                <label className="mt-2 flex items-center gap-2 font-semibold">
                  <input
                    checked={form.policyAcknowledged}
                    className="h-4 w-4"
                    type="checkbox"
                    onChange={(event) =>
                      onPolicyAcknowledgedChange(event.target.checked)
                    }
                  />
                  I acknowledge this branch policy warning
                </label>
              </div>
            ) : null}

            {existingPullRequest ? (
              <div className="rounded-md border border-[var(--red)] bg-[var(--red-soft)] p-3 text-xs leading-5 text-[var(--red)]">
                Active PR #{existingPullRequest.id} already exists for{" "}
                <code>{form.sourceBranch}</code> to{" "}
                <code>{form.targetBranch}</code>. Inspect or update the
                existing PR instead of creating a duplicate.
              </div>
            ) : null}

            <button
              className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              type="button"
              disabled={disabled}
              onClick={onCreate}
              title="Create this pull request in Azure DevOps"
            >
              {state.state === "loading" ? (
                <Loader2 className="animate-spin" size={17} />
              ) : (
                <GitPullRequest size={17} />
              )}
              {state.state === "loading" ? "Creating" : "Create Azure PR"}
            </button>

            {state.message ? (
              <div
                className={`rounded border p-2 text-xs ${
                  state.state === "error"
                    ? "border-[var(--red)] bg-[var(--red-soft)] text-[var(--red)]"
                    : "border-[var(--line)] bg-white text-[var(--muted)]"
                }`}
              >
                <div>{state.message}</div>
                {state.state === "success" && state.webUrl ? (
                  <a
                    className="mt-2 inline-flex items-center gap-1 font-semibold text-[var(--blue)] hover:underline"
                    href={state.webUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open created PR <ExternalLink size={12} />
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>

          <div>
            <div
              className={`mb-2 text-xs ${
                description.length > AZURE_PR_DESCRIPTION_LIMIT
                  ? "text-[var(--red)]"
                  : "text-[var(--muted)]"
              }`}
            >
              Description preview: {description.length} /{" "}
              {AZURE_PR_DESCRIPTION_LIMIT} characters
            </div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-[var(--line)] bg-white p-3 text-xs leading-5">
              {description}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}

function PullRequestTable({
  pullRequests,
  activeCount,
  selectedPrId,
  onInspect,
}: {
  pullRequests: PullRequestSummary[];
  activeCount: number;
  selectedPrId: number | null;
  onInspect: (pullRequest: PullRequestSummary) => void;
}) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Pull Requests</h2>
          <p className="text-sm text-[var(--muted)]">
            {activeCount} active PRs. Work Item and build status are read per PR
            where Azure permissions allow it.
          </p>
        </div>
        <GitPullRequest size={20} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="py-2 pr-3">PR</th>
              <th className="py-2 pr-3">Title</th>
              <th className="py-2 pr-3">Branches</th>
              <th className="py-2 pr-3">Work Item</th>
              <th className="py-2 pr-3">Reviewers</th>
              <th className="py-2 pr-3">Build</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {pullRequests.map((pullRequest) => (
              <tr
                className="border-b border-[var(--line)] align-top last:border-0"
                key={pullRequest.id}
              >
                <td className="py-3 pr-3">
                  <a
                    className="inline-flex items-center gap-1 font-semibold text-[var(--blue)] hover:underline"
                    href={pullRequest.webUrl}
                    rel="noreferrer"
                    target="_blank"
                    title="Open this pull request in Azure DevOps"
                  >
                    #{pullRequest.id}
                    <ExternalLink size={12} />
                  </a>
                </td>
                <td className="max-w-[300px] py-3 pr-3">
                  <div className="font-medium">{pullRequest.title}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    {pullRequest.createdBy}
                  </div>
                </td>
                <td className="py-3 pr-3">
                  <div className="grid gap-1">
                    <code className="text-xs">{pullRequest.sourceBranch}</code>
                    <span className="text-xs text-[var(--muted)]">
                      to {pullRequest.targetBranch}
                    </span>
                  </div>
                </td>
                <td className="py-3 pr-3">
                  <WorkItemStatus items={pullRequest.linkedWorkItems} />
                </td>
                <td className="py-3 pr-3">
                  <ReviewerSummary reviewers={pullRequest.reviewers} />
                </td>
                <td className="py-3 pr-3">
                  <BuildStatus
                    evidence={pullRequest.buildEvidence}
                    sourcesChecked={pullRequest.buildEvidenceSourcesChecked}
                  />
                </td>
                <td className="py-3 pr-3">
                  <span className="rounded-full bg-[var(--blue-soft)] px-2 py-1 text-xs font-semibold text-[var(--blue)]">
                    {pullRequest.status}
                  </span>
                  {pullRequest.isDraft ? (
                    <span className="ml-2 rounded-full bg-[var(--amber-soft)] px-2 py-1 text-xs font-semibold text-[var(--amber)]">
                      draft
                    </span>
                  ) : null}
                </td>
                <td className="py-3 text-right">
                  <button
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:border-[var(--blue)] hover:text-[var(--blue)]"
                    type="button"
                    onClick={() => onInspect(pullRequest)}
                    title="Inspect the latest PR iteration file changes"
                  >
                    {selectedPrId === pullRequest.id ? (
                      <RefreshCw size={15} />
                    ) : (
                      <Eye size={15} />
                    )}
                    Inspect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pullRequests.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--line-strong)] p-6 text-center text-sm text-[var(--muted)]">
          No pull requests returned for this repository.
        </div>
      ) : null}
    </section>
  );
}

function PullRequestDetailPanel({
  state,
  error,
  detail,
  selectedPrId,
}: {
  state: LoadState;
  error: string;
  detail: PullRequestDetail | null;
  selectedPrId: number | null;
}) {
  if (!selectedPrId) {
    return null;
  }

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">PR #{selectedPrId} Diff</h2>
          <p className="text-sm text-[var(--muted)]">
            Latest iteration file changes, linked Work Items, and branch build
            status.
          </p>
        </div>
        {state === "loading" ? <Loader2 className="animate-spin" size={20} /> : null}
      </div>

      {state === "error" ? <ErrorNotice message={error} /> : null}

      {detail ? (
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard
              label="Changed Files"
              value={String(detail.changes.length)}
            />
            <MetricCard
              label="Linked Work Items"
              value={String(detail.linkedWorkItems.length)}
            />
            <MetricCard
              label="Latest Build"
              value={getBuildEvidence(detail.buildEvidence).label}
            />
          </div>

          <LinkedWorkItemsPanel items={detail.linkedWorkItems} />
          <ReviewersPanel reviewers={detail.reviewers} />
          <BuildEvidencePanel
            evidence={detail.buildEvidence}
            sourcesChecked={detail.buildEvidenceSourcesChecked}
          />
          <PullRequestStatusesPanel statuses={detail.statuses} />

          {detail.diagnostics.length > 0 ? (
            <div className="rounded-md border border-[var(--amber)] bg-[var(--amber-soft)] p-3 text-sm text-[var(--amber)]">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <AlertTriangle size={16} />
                Partial read diagnostics
              </div>
              <ul className="grid gap-2">
                {detail.diagnostics.map((diagnostic) => (
                  <li key={diagnostic}>
                    <DiagnosticSummary message={diagnostic} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-md border border-[var(--line)]">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="bg-[var(--panel-strong)]">
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-3 py-2">Change</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Path</th>
                </tr>
              </thead>
              <tbody>
                {detail.changes.map((change, index) => (
                  <tr
                    className="border-t border-[var(--line)]"
                    key={`${change.path}-${index}`}
                  >
                    <td className="px-3 py-2">{change.changeType}</td>
                    <td className="px-3 py-2">{change.objectType ?? "file"}</td>
                    <td className="px-3 py-2">
                      <code className="text-xs">{change.path}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RuleCheckPanel({
  state,
  error,
  reports,
  mode,
  activeCount,
  totalCount,
  copyState,
  commentCopyId,
  agentPacketCopyId,
  commentPostStates,
  workItemLinkInputs,
  workItemLinkStates,
  workItemCandidateStates,
  descriptionPreview,
  descriptionCopyState,
  descriptionUpdateState,
  onModeChange,
  onRun,
  onPreviewDescription,
  onCloseDescriptionPreview,
  onCopyDescriptionPreview,
  onUpdateDescriptionPreview,
  onPostPrComment,
  onWorkItemInputChange,
  onSearchWorkItems,
  onUseWorkItemCandidate,
  onLinkWorkItem,
  onCopyPrComment,
  onCopyAgentPacket,
  onCopy,
}: {
  state: LoadState;
  error: string;
  reports: RuleCheckReport[];
  mode: RuleCheckMode;
  activeCount: number;
  totalCount: number;
  copyState: "idle" | "copied" | "error";
  commentCopyId: number | null;
  agentPacketCopyId: number | null;
  commentPostStates: Record<number, PrCommentPostState>;
  workItemLinkInputs: Record<number, string>;
  workItemLinkStates: Record<number, WorkItemLinkState>;
  workItemCandidateStates: Record<number, WorkItemCandidateState>;
  descriptionPreview: DescriptionPreview | null;
  descriptionCopyState: "idle" | "copied" | "error";
  descriptionUpdateState?: PrDescriptionUpdateState;
  onModeChange: (mode: RuleCheckMode) => void;
  onRun: () => void;
  onPreviewDescription: (report: RuleCheckReport) => void;
  onCloseDescriptionPreview: () => void;
  onCopyDescriptionPreview: () => void;
  onUpdateDescriptionPreview: () => void;
  onPostPrComment: (report: RuleCheckReport) => void;
  onWorkItemInputChange: (pullRequestId: number, value: string) => void;
  onSearchWorkItems: (report: RuleCheckReport) => void;
  onUseWorkItemCandidate: (pullRequestId: number, workItemId: string) => void;
  onLinkWorkItem: (pullRequestId: number) => void;
  onCopyPrComment: (report: RuleCheckReport) => void;
  onCopyAgentPacket: (report: RuleCheckReport) => void;
  onCopy: () => void;
}) {
  const summary = reports.reduce(
    (accumulator, report) => {
      accumulator[report.status] += 1;
      return accumulator;
    },
    { blocked: 0, warning: 0, passed: 0 },
  );
  const stageGateSummary = summarizeStageGates(reports);
  const readinessSummary = summarizeReadiness(reports);
  const reasonSummary = summarizeFindings(reports);
  const runLabel =
    mode === "delivery" ? "Run Delivery Gate" : "Run Historical Audit";
  const runDisabled =
    state === "loading" || (mode === "delivery" && activeCount === 0);

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Repo Rule Checks</h2>
          <p className="text-sm text-[var(--muted)]">
            Inspect PR changed files and evaluate Odin branch, Work Item, build,
            docs, contract, i18n, env, and review-policy gates.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-md border border-[var(--line)] bg-white p-1">
            <button
              className={`rounded px-3 py-1.5 text-sm font-semibold ${
                mode === "delivery"
                  ? "bg-[var(--foreground)] text-white"
                  : "text-[var(--muted)]"
              }`}
              type="button"
              onClick={() => onModeChange("delivery")}
              title="Check active pull requests as current delivery gates"
            >
              Delivery ({activeCount})
            </button>
            <button
              className={`rounded px-3 py-1.5 text-sm font-semibold ${
                mode === "audit"
                  ? "bg-[var(--foreground)] text-white"
                  : "text-[var(--muted)]"
              }`}
              type="button"
              onClick={() => onModeChange("audit")}
              title="Audit all loaded pull requests as historical evidence"
            >
              Audit ({totalCount})
            </button>
          </div>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--blue)] hover:text-[var(--blue)]"
            type="button"
            disabled={reports.length === 0}
            onClick={onCopy}
            title="Copy the current rule check report as Markdown"
          >
            <Clipboard size={17} />
            {copyState === "copied"
              ? "Copied"
              : copyState === "error"
                ? "Copy Failed"
                : "Copy Markdown"}
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            type="button"
            disabled={runDisabled}
            onClick={onRun}
            title={
              mode === "delivery" && activeCount === 0
                ? "No active pull requests to check"
                : mode === "delivery"
                ? "Fetch active PR details and evaluate current delivery gates"
                : "Fetch loaded PR details and evaluate historical compliance"
            }
          >
            {state === "loading" ? (
              <Loader2 className="animate-spin" size={17} />
            ) : (
              <ShieldCheck size={17} />
            )}
            {state === "loading" ? "Checking" : runLabel}
          </button>
        </div>
      </div>

      {error ? <ErrorNotice className="mb-4" message={error} /> : null}

      {reports.length > 0 ? (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-4">
            {stageGateSummary.map((item) => (
              <MetricCard
                key={item.status}
                label={item.label}
                value={String(item.count)}
              />
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              label="Compliance blocked"
              value={String(summary.blocked)}
            />
            <MetricCard
              label="Compliance warnings"
              value={String(summary.warning)}
            />
            <MetricCard
              label="Compliance passed"
              value={String(summary.passed)}
            />
          </div>

          <div className="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 className="text-sm font-semibold">PR Readiness</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Converts Azure evidence and repo rules into blockers, review
                  items, human decisions, and required verification.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded bg-white px-3 py-2">
                  <div className="font-semibold">
                    {readinessSummary.blockers}
                  </div>
                  <div className="text-[var(--muted)]">blockers</div>
                </div>
                <div className="rounded bg-white px-3 py-2">
                  <div className="font-semibold">
                    {readinessSummary.reviewItems}
                  </div>
                  <div className="text-[var(--muted)]">review</div>
                </div>
                <div className="rounded bg-white px-3 py-2">
                  <div className="font-semibold">
                    {readinessSummary.humanDecisions}
                  </div>
                  <div className="text-[var(--muted)]">decision</div>
                </div>
              </div>
            </div>

            {readinessSummary.requiredVerification.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {readinessSummary.requiredVerification.map((command) => (
                  <code
                    className="rounded-full bg-white px-2 py-1 text-xs"
                    key={command}
                  >
                    {command}
                  </code>
                ))}
              </div>
            ) : null}
          </div>

          <ActionQueuePanel reports={reports} />

          <div className="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">
            <h3 className="text-sm font-semibold">Finding Summary</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {reasonSummary.map((item) => (
                <span
                  className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[var(--muted)]"
                  key={item.title}
                >
                  {item.title}: {item.count}
                </span>
              ))}
            </div>
          </div>

          <DescriptionPreviewPanel
            copyState={descriptionCopyState}
            updateState={descriptionUpdateState}
            preview={descriptionPreview}
            onClose={onCloseDescriptionPreview}
            onCopy={onCopyDescriptionPreview}
            onUpdate={onUpdateDescriptionPreview}
          />

          <div className="grid gap-3">
            {reports.map((report) => {
              const writeAllowed = isTestWriteAllowedBranch(
                report.sourceBranch,
              );
              const readOnlyReason = writeAllowed
                ? undefined
                : getTestWritePolicyMessage(report.sourceBranch);

              return (
              <article
                className="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3"
                key={report.pullRequestId}
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-white px-2 py-1 text-xs">
                        #{report.pullRequestId}
                      </code>
                      <StageGateBadge status={report.stageGate.status} />
                      <RuleStatusBadge status={report.status} />
                    </div>
                    <h3 className="mt-2 truncate font-semibold">
                      {report.title}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      <code>{report.sourceBranch}</code> to{" "}
                      <code>{report.targetBranch}</code> -{" "}
                      {report.pullRequestStatus} - {report.stageGate.detail}
                    </p>
                  </div>
                  <PrCommentActions
                    agentPacketCopied={
                      agentPacketCopyId === report.pullRequestId
                    }
                    copied={commentCopyId === report.pullRequestId}
                    postState={commentPostStates[report.pullRequestId]}
                    report={report}
                    readOnlyReason={readOnlyReason}
                    writeAllowed={writeAllowed}
                    onCopyAgentPacket={onCopyAgentPacket}
                    onCopy={onCopyPrComment}
                    onPreviewDescription={onPreviewDescription}
                    onPost={onPostPrComment}
                  />
                </div>
                <PrCommentPostMessage
                  postState={commentPostStates[report.pullRequestId]}
                />
                {report.stageGate.deliveryGate ? (
                  <WorkItemLinkForm
                    candidates={
                      workItemCandidateStates[report.pullRequestId] ?? {
                        state: "idle",
                        candidates: [],
                        inferredIds: [],
                      }
                    }
                    state={workItemLinkStates[report.pullRequestId]}
                    value={workItemLinkInputs[report.pullRequestId] ?? ""}
                    readOnlyReason={readOnlyReason}
                    writeAllowed={writeAllowed}
                    onChange={(value) =>
                      onWorkItemInputChange(report.pullRequestId, value)
                    }
                    onSearch={() => onSearchWorkItems(report)}
                    onSubmit={() => onLinkWorkItem(report.pullRequestId)}
                    onUseCandidate={(workItemId) =>
                      onUseWorkItemCandidate(report.pullRequestId, workItemId)
                    }
                  />
                ) : null}

                <div className="mt-3 rounded border border-white bg-white p-2 text-sm">
                  <div className="font-semibold">
                    Readiness: {report.readiness.label}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    {report.readiness.summary}
                  </p>
                  {report.readiness.blockers.length > 0 ? (
                    <ReadinessList
                      items={report.readiness.blockers}
                      label="Blockers"
                    />
                  ) : null}
                  {report.readiness.reviewItems.length > 0 ? (
                    <ReadinessList
                      items={report.readiness.reviewItems}
                      label="Review items"
                    />
                  ) : null}
                  {report.readiness.humanDecisions.length > 0 ? (
                    <ReadinessList
                      items={report.readiness.humanDecisions}
                      label="Human decisions"
                    />
                  ) : null}
                </div>

                <div className="mt-3 grid gap-2">
                  {report.findings.map((finding) => (
                    <div
                      className="rounded border border-white bg-white p-2 text-sm"
                      key={`${finding.title}-${finding.detail}`}
                    >
                      <div className="flex items-start gap-2">
                        <SeverityIcon severity={finding.severity} />
                        <div>
                          <div className="font-semibold">{finding.title}</div>
                          <div className="mt-0.5 text-xs leading-5 text-[var(--muted)]">
                            {finding.detail}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-[var(--line-strong)] p-5 text-center text-sm text-[var(--muted)]">
          {state === "success" && mode === "delivery" && activeCount === 0
            ? "No active PRs to gate."
            : "No rule check report yet."}
        </div>
      )}
    </section>
  );
}

function RuleStatusBadge({ status }: { status: RuleCheckReport["status"] }) {
  const style =
    status === "blocked"
      ? "bg-[var(--red-soft)] text-[var(--red)]"
      : status === "warning"
        ? "bg-[var(--amber-soft)] text-[var(--amber)]"
        : "bg-[var(--green-soft)] text-[var(--green)]";

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${style}`}>
      {status}
    </span>
  );
}

function StageGateBadge({ status }: { status: StageGateStatus }) {
  const labels: Record<StageGateStatus, string> = {
    ready: "ready",
    blocked: "blocked",
    "needs-review": "needs review",
    historical: "historical",
    "inspection-failed": "inspection failed",
  };
  const style =
    status === "blocked" || status === "inspection-failed"
      ? "bg-[var(--red-soft)] text-[var(--red)]"
      : status === "needs-review"
        ? "bg-[var(--amber-soft)] text-[var(--amber)]"
        : status === "ready"
          ? "bg-[var(--green-soft)] text-[var(--green)]"
          : "bg-white text-[var(--muted)]";

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${style}`}>
      gate: {labels[status]}
    </span>
  );
}

function ActionQueuePanel({ reports }: { reports: RuleCheckReport[] }) {
  const blockers = reports.flatMap((report) =>
    report.readiness.blockers.map((item) => ({
      pullRequestId: report.pullRequestId,
      title: report.title,
      item,
    })),
  );
  const humanDecisions = reports.flatMap((report) =>
    report.readiness.humanDecisions.map((item) => ({
      pullRequestId: report.pullRequestId,
      title: report.title,
      item,
    })),
  );
  const requiredVerification = [
    ...new Set(
      reports.flatMap((report) => report.readiness.requiredVerification),
    ),
  ];

  if (
    blockers.length === 0 &&
    humanDecisions.length === 0 &&
    requiredVerification.length === 0
  ) {
    return null;
  }

  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">
      <h3 className="text-sm font-semibold">Action Queue</h3>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
        Consolidated next actions from the current rule check result.
      </p>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <ActionQueueColumn
          emptyText="No blocking actions."
          items={blockers}
          label="Blockers"
          tone="block"
        />
        <ActionQueueColumn
          emptyText="No human decisions."
          items={humanDecisions}
          label="Human decisions"
          tone="decision"
        />
        <div className="rounded border border-white bg-white p-2">
          <div className="text-xs font-semibold text-[var(--muted)]">
            Verification
          </div>
          {requiredVerification.length === 0 ? (
            <div className="mt-2 text-xs text-[var(--muted)]">
              No required commands.
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1">
              {requiredVerification.map((command) => (
                <code
                  className="rounded-full bg-[var(--panel)] px-2 py-1 text-xs"
                  key={command}
                >
                  {command}
                </code>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionQueueColumn({
  emptyText,
  items,
  label,
  tone,
}: {
  emptyText: string;
  items: Array<{
    pullRequestId: number;
    title: string;
    item: string;
  }>;
  label: string;
  tone: "block" | "decision";
}) {
  const color =
    tone === "block" ? "text-[var(--red)]" : "text-[var(--amber)]";

  return (
    <div className="rounded border border-white bg-white p-2">
      <div className={`text-xs font-semibold ${color}`}>{label}</div>
      {items.length === 0 ? (
        <div className="mt-2 text-xs text-[var(--muted)]">{emptyText}</div>
      ) : (
        <ul className="mt-2 grid gap-2 text-xs leading-5 text-[var(--muted)]">
          {items.map((entry) => (
            <li key={`${entry.pullRequestId}-${entry.item}`}>
              <span className="font-semibold text-[var(--foreground)]">
                PR #{entry.pullRequestId}
              </span>{" "}
              {entry.item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DescriptionPreviewPanel({
  copyState,
  updateState,
  preview,
  onClose,
  onCopy,
  onUpdate,
}: {
  copyState: "idle" | "copied" | "error";
  updateState?: PrDescriptionUpdateState;
  preview: DescriptionPreview | null;
  onClose: () => void;
  onCopy: () => void;
  onUpdate: () => void;
}) {
  if (!preview) {
    return null;
  }

  const isOverLimit = preview.content.length > AZURE_PR_DESCRIPTION_LIMIT;

  return (
    <div className="rounded-md border border-[var(--blue)] bg-white p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-sm font-semibold">
            PR Description Update Preview
          </h3>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Preview for PR #{preview.pullRequestId}. This has not been written
            to Azure DevOps.
          </p>
          <p
            className={`mt-1 text-xs ${
              isOverLimit ? "text-[var(--red)]" : "text-[var(--muted)]"
            }`}
          >
            {preview.content.length} / {AZURE_PR_DESCRIPTION_LIMIT} characters
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--blue)] hover:text-[var(--blue)]"
            type="button"
            onClick={onCopy}
            title="Copy this PR description preview"
          >
            <Clipboard size={14} />
            {copyState === "copied"
              ? "Copied"
              : copyState === "error"
                ? "Copy failed"
                : "Copy preview"}
          </button>
          <button
            className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--blue)] hover:text-[var(--blue)] disabled:opacity-60"
            type="button"
            disabled={isOverLimit || updateState?.state === "loading"}
            onClick={onUpdate}
            title="Update the Azure PR description with this preview"
          >
            {updateState?.state === "loading" ? (
              <Loader2 className="animate-spin" size={14} />
            ) : (
              <ShieldCheck size={14} />
            )}
            {updateState?.state === "loading"
              ? "Updating"
              : updateState?.state === "success"
                ? "Updated"
                : "Update Azure description"}
          </button>
          <button
            className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--red)] hover:text-[var(--red)]"
            type="button"
            onClick={onClose}
            title="Close this preview"
          >
            <XCircle size={14} />
            Close
          </button>
        </div>
      </div>
      {updateState?.message ? (
        <div
          className={`mt-3 rounded border p-2 text-xs ${
            updateState.state === "error"
              ? "border-[var(--red)] bg-[var(--red-soft)] text-[var(--red)]"
              : "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]"
          }`}
        >
          {updateState.message}
        </div>
      ) : null}
      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-[var(--line)] bg-[var(--panel)] p-3 text-xs leading-5 text-[var(--foreground)]">
        {preview.content}
      </pre>
    </div>
  );
}

function PrCommentActions({
  agentPacketCopied,
  copied,
  postState,
  readOnlyReason,
  report,
  writeAllowed,
  onCopyAgentPacket,
  onCopy,
  onPreviewDescription,
  onPost,
}: {
  agentPacketCopied: boolean;
  copied: boolean;
  postState?: PrCommentPostState;
  readOnlyReason?: string;
  report: RuleCheckReport;
  writeAllowed: boolean;
  onCopyAgentPacket: (report: RuleCheckReport) => void;
  onCopy: (report: RuleCheckReport) => void;
  onPreviewDescription: (report: RuleCheckReport) => void;
  onPost: (report: RuleCheckReport) => void;
}) {
  return (
    <div className="flex max-w-xl flex-wrap items-start justify-end gap-1">
      <button
        className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-white px-2 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--blue)] hover:text-[var(--blue)]"
        type="button"
        onClick={() => onCopyAgentPacket(report)}
        title="Copy a structured Agent Packet for a clean Codex handoff"
      >
        <Clipboard size={13} />
        {agentPacketCopied ? "Copied packet" : "Copy Agent Packet"}
      </button>
      <button
        className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-white px-2 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--blue)] hover:text-[var(--blue)]"
        type="button"
        onClick={() => onCopy(report)}
        title="Copy a PR-ready readiness comment"
      >
        <MessageSquarePlus size={13} />
        {copied ? "Copied comment" : "Copy PR comment"}
      </button>

      {report.stageGate.deliveryGate && writeAllowed ? (
        <>
          <button
            className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-white px-2 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--blue)] hover:text-[var(--blue)]"
            type="button"
            onClick={() => onPreviewDescription(report)}
            title="Preview a PR description update without writing to Azure"
          >
            <Clipboard size={13} />
            Preview description
          </button>
          <button
            className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-white px-2 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--blue)] hover:text-[var(--blue)] disabled:opacity-60"
            type="button"
            disabled={postState?.state === "loading"}
            onClick={() => onPost(report)}
            title="Post the readiness comment to Azure DevOps"
          >
            <MessageSquarePlus size={13} />
            {postState?.state === "loading"
              ? "Posting"
              : postState?.state === "success"
                ? "Posted"
                : "Post PR comment"}
          </button>
        </>
      ) : report.stageGate.deliveryGate ? (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-[var(--amber)] bg-[var(--amber-soft)] px-2 py-1 text-xs font-semibold text-[var(--amber)]"
          title={readOnlyReason}
        >
          <ShieldCheck size={13} />
          read-only branch
        </span>
      ) : null}

      {report.requiredVerification.map((command) => (
        <code className="rounded-full bg-white px-2 py-1 text-xs" key={command}>
          {command}
        </code>
      ))}
    </div>
  );
}

function PrCommentPostMessage({
  postState,
}: {
  postState?: PrCommentPostState;
}) {
  if (!postState?.message) {
    return null;
  }

  return (
    <div
      className={`mt-2 rounded border p-2 text-xs ${
        postState.state === "error"
          ? "border-[var(--red)] bg-[var(--red-soft)] text-[var(--red)]"
          : "border-[var(--line)] bg-white text-[var(--muted)]"
      }`}
    >
      {postState.message}
    </div>
  );
}

function WorkItemLinkForm({
  candidates,
  readOnlyReason,
  state,
  value,
  writeAllowed,
  onChange,
  onSearch,
  onSubmit,
  onUseCandidate,
}: {
  candidates: WorkItemCandidateState;
  readOnlyReason?: string;
  state?: WorkItemLinkState;
  value: string;
  writeAllowed: boolean;
  onChange: (value: string) => void;
  onSearch: () => void;
  onSubmit: () => void;
  onUseCandidate: (workItemId: string) => void;
}) {
  return (
    <div className="mt-2 rounded-md border border-[var(--line)] bg-white p-2">
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <label className="grid flex-1 gap-1 text-xs font-semibold text-[var(--muted)]">
          Link existing Azure Work Item
          <input
            className="h-9 rounded-md border border-[var(--line)] bg-white px-3 text-sm font-normal text-[var(--foreground)] outline-none transition focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-soft)]"
            inputMode="numeric"
            placeholder="Work Item ID"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
        <button
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--blue)] hover:text-[var(--blue)] disabled:opacity-60"
          type="button"
          disabled={candidates.state === "loading"}
          onClick={onSearch}
          title="Search Azure Boards for candidate Work Items using this PR context"
        >
          {candidates.state === "loading" ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <Search size={14} />
          )}
          Find candidates
        </button>
        <button
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--blue)] hover:text-[var(--blue)] disabled:opacity-60"
          type="button"
          disabled={!writeAllowed || state?.state === "loading"}
          onClick={onSubmit}
          title={
            writeAllowed
              ? "Link an existing Azure Boards Work Item to this PR"
              : readOnlyReason
          }
        >
          {state?.state === "loading" ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <ShieldCheck size={14} />
          )}
          Link Work Item
        </button>
      </div>
      {!writeAllowed ? (
        <div className="mt-2 rounded border border-[var(--amber)] bg-[var(--amber-soft)] p-2 text-xs text-[var(--amber)]">
          {readOnlyReason}
        </div>
      ) : null}
      {state?.message ? (
        <div
          className={`mt-2 rounded border p-2 text-xs ${
            state.state === "error"
              ? "border-[var(--red)] bg-[var(--red-soft)] text-[var(--red)]"
              : "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]"
          }`}
        >
          {state.message}
        </div>
      ) : null}
      <WorkItemCandidateList
        state={candidates}
        onUseCandidate={onUseCandidate}
      />
    </div>
  );
}

function WorkItemCandidateList({
  state,
  onUseCandidate,
}: {
  state: WorkItemCandidateState;
  onUseCandidate: (workItemId: string) => void;
}) {
  if (state.state === "idle" && state.candidates.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 rounded border border-[var(--line)] bg-[var(--panel)] p-2">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs font-semibold text-[var(--muted)]">
          Candidate Work Items
        </div>
        {state.inferredIds.length > 0 ? (
          <div className="text-xs text-[var(--muted)]">
            inferred: {state.inferredIds.join(", ")}
          </div>
        ) : null}
      </div>
      {state.message ? (
        <div
          className={`mt-2 rounded border p-2 text-xs ${
            state.state === "error"
              ? "border-[var(--red)] bg-[var(--red-soft)] text-[var(--red)]"
              : "border-white bg-white text-[var(--muted)]"
          }`}
        >
          {state.message}
        </div>
      ) : null}
      {state.candidates.length > 0 ? (
        <div className="mt-2 grid gap-2">
          {state.candidates.map((item) => (
            <div
              className="rounded border border-white bg-white p-2 text-xs"
              key={item.id}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <a
                  className="inline-flex min-w-0 items-center gap-1 font-semibold text-[var(--blue)] hover:underline"
                  href={item.webUrl}
                  rel="noreferrer"
                  target="_blank"
                  title={formatWorkItemLabel(item)}
                >
                  <span className="truncate">{formatWorkItemLabel(item)}</span>
                  <ExternalLink className="shrink-0" size={11} />
                </a>
                <button
                  className="inline-flex items-center justify-center gap-1 rounded-md border border-[var(--line)] px-2 py-1 font-semibold text-[var(--muted)] transition hover:border-[var(--blue)] hover:text-[var(--blue)]"
                  type="button"
                  onClick={() => onUseCandidate(item.id)}
                  title="Fill this Work Item ID into the link form"
                >
                  Use #{item.id}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1 text-[var(--muted)]">
                {item.type ? (
                  <span className="rounded-full bg-[var(--panel)] px-2 py-1">
                    Type: {item.type}
                  </span>
                ) : null}
                {item.state ? (
                  <span className="rounded-full bg-[var(--panel)] px-2 py-1">
                    State: {item.state}
                  </span>
                ) : null}
                {item.assignedTo ? (
                  <span className="rounded-full bg-[var(--panel)] px-2 py-1">
                    Owner: {item.assignedTo}
                  </span>
                ) : null}
                {item.iterationPath ? (
                  <span className="rounded-full bg-[var(--panel)] px-2 py-1">
                    Iteration: {item.iterationPath}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReadinessList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mt-2">
      <div className="text-xs font-semibold text-[var(--muted)]">{label}</div>
      <ul className="mt-1 grid gap-1 text-xs leading-5 text-[var(--muted)]">
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}

function SeverityIcon({ severity }: { severity: RuleSeverity }) {
  if (severity === "block") {
    return <XCircle className="mt-0.5 shrink-0 text-[var(--red)]" size={16} />;
  }

  if (severity === "warning") {
    return (
      <AlertTriangle
        className="mt-0.5 shrink-0 text-[var(--amber)]"
        size={16}
      />
    );
  }

  return (
    <CheckCircle2 className="mt-0.5 shrink-0 text-[var(--green)]" size={16} />
  );
}

function formatWorkItemLabel(item: LinkedWorkItem) {
  const prefix = item.type ? `${item.type} #${item.id}` : `Work Item #${item.id}`;
  return item.title ? `${prefix}: ${item.title}` : prefix;
}

function formatShortWorkItemLabel(item: LinkedWorkItem) {
  return item.title ? `#${item.id} ${item.title}` : `#${item.id}`;
}

function buildWorkItemPayloadSummary(item: LinkedWorkItem) {
  return [
    item.type ? `Type: ${item.type}` : null,
    item.state ? `State: ${item.state}` : null,
    item.assignedTo ? `Assigned to: ${item.assignedTo}` : null,
    item.iterationPath ? `Iteration: ${item.iterationPath}` : null,
  ].filter((value): value is string => Boolean(value));
}

function buildWorkItemCandidateSearchText(report: RuleCheckReport) {
  return [report.sourceBranch, report.title, report.existingDescription]
    .filter(Boolean)
    .join(" ");
}

function WorkItemStatus({ items }: { items: LinkedWorkItem[] }) {
  if (items.length > 0) {
    return (
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <a
            className="inline-flex max-w-[220px] items-center gap-1 rounded-full bg-[var(--green-soft)] px-2 py-1 text-xs font-semibold text-[var(--green)] hover:underline"
            href={item.webUrl}
            key={item.id}
            rel="noreferrer"
            target="_blank"
            title={formatWorkItemLabel(item)}
          >
            <CheckCircle2 size={14} />
            <span className="truncate">{formatShortWorkItemLabel(item)}</span>
            <ExternalLink size={11} />
          </a>
        ))}
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--red-soft)] px-2 py-1 text-xs font-semibold text-[var(--red)]">
      <XCircle size={14} />
      Missing
    </span>
  );
}

function ReviewerSummary({
  reviewers,
}: {
  reviewers: PullRequestReviewer[];
}) {
  if (reviewers.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--amber-soft)] px-2 py-1 text-xs font-semibold text-[var(--amber)]">
        <AlertTriangle size={14} />
        Unread
      </span>
    );
  }

  const requiredCount = reviewers.filter((reviewer) => reviewer.isRequired).length;
  const approvedCount = reviewers.filter((reviewer) => reviewer.vote >= 5).length;
  const rejectedCount = reviewers.filter((reviewer) => reviewer.vote <= -10).length;

  return (
    <div className="flex flex-wrap gap-1">
      <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-[var(--muted)]">
        {reviewers.length} total
      </span>
      {requiredCount > 0 ? (
        <span className="rounded-full bg-[var(--blue-soft)] px-2 py-1 text-xs font-semibold text-[var(--blue)]">
          {requiredCount} required
        </span>
      ) : null}
      {approvedCount > 0 ? (
        <span className="rounded-full bg-[var(--green-soft)] px-2 py-1 text-xs font-semibold text-[var(--green)]">
          {approvedCount} approved
        </span>
      ) : null}
      {rejectedCount > 0 ? (
        <span className="rounded-full bg-[var(--red-soft)] px-2 py-1 text-xs font-semibold text-[var(--red)]">
          {rejectedCount} rejected
        </span>
      ) : null}
    </div>
  );
}

function LinkedWorkItemsPanel({ items }: { items: LinkedWorkItem[] }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-3 text-sm">
      <div className="font-semibold">Linked Work Items</div>
      {items.length === 0 ? (
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          No linked Work Items were returned by Azure DevOps.
        </p>
      ) : (
        <div className="mt-2 grid gap-2">
          {items.map((item) => (
            <div
              className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-2"
              key={item.id}
            >
              <a
                className="inline-flex min-w-0 items-center gap-1 font-semibold text-[var(--blue)] hover:underline"
                href={item.webUrl}
                rel="noreferrer"
                target="_blank"
                title={formatWorkItemLabel(item)}
              >
                <span className="truncate">{formatWorkItemLabel(item)}</span>
                <ExternalLink className="shrink-0" size={11} />
              </a>
              <div className="mt-2 flex flex-wrap gap-1 text-xs text-[var(--muted)]">
                {item.state ? (
                  <span className="rounded-full bg-white px-2 py-1">
                    State: {item.state}
                  </span>
                ) : null}
                {item.assignedTo ? (
                  <span className="rounded-full bg-white px-2 py-1">
                    Owner: {item.assignedTo}
                  </span>
                ) : null}
                {item.iterationPath ? (
                  <span className="rounded-full bg-white px-2 py-1">
                    Iteration: {item.iterationPath}
                  </span>
                ) : null}
                {item.areaPath ? (
                  <span className="rounded-full bg-white px-2 py-1">
                    Area: {item.areaPath}
                  </span>
                ) : null}
                {item.tags ? (
                  <span className="rounded-full bg-white px-2 py-1">
                    Tags: {item.tags}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewersPanel({
  reviewers,
}: {
  reviewers: PullRequestReviewer[];
}) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-3 text-sm">
      <div className="font-semibold">Reviewers</div>
      {reviewers.length === 0 ? (
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          No reviewers were returned by Azure DevOps.
        </p>
      ) : (
        <div className="mt-2 grid gap-2">
          {reviewers.map((reviewer) => (
            <div
              className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-2"
              key={reviewer.id ?? reviewer.displayName}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate font-semibold">
                    {reviewer.displayName}
                  </div>
                  {reviewer.uniqueName ? (
                    <div className="mt-1 truncate text-xs text-[var(--muted)]">
                      {reviewer.uniqueName}
                    </div>
                  ) : null}
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-semibold ${getReviewerVoteClass(
                    reviewer.vote,
                  )}`}
                >
                  {reviewer.voteLabel}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1 text-xs text-[var(--muted)]">
                {reviewer.isRequired ? (
                  <span className="rounded-full bg-white px-2 py-1">
                    required
                  </span>
                ) : null}
                {reviewer.hasDeclined ? (
                  <span className="rounded-full bg-[var(--red-soft)] px-2 py-1 text-[var(--red)]">
                    declined
                  </span>
                ) : null}
                {reviewer.isFlagged ? (
                  <span className="rounded-full bg-[var(--amber-soft)] px-2 py-1 text-[var(--amber)]">
                    flagged
                  </span>
                ) : null}
                <span className="rounded-full bg-white px-2 py-1">
                  vote: {reviewer.vote}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getReviewerVoteClass(vote: number) {
  if (vote >= 5) {
    return "bg-[var(--green-soft)] text-[var(--green)]";
  }

  if (vote <= -10) {
    return "bg-[var(--red-soft)] text-[var(--red)]";
  }

  if (vote < 0) {
    return "bg-[var(--amber-soft)] text-[var(--amber)]";
  }

  return "bg-white text-[var(--muted)]";
}

function BuildEvidencePanel({
  evidence,
  sourcesChecked,
}: {
  evidence: BuildEvidence[];
  sourcesChecked: string[];
}) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-3 text-sm">
      <div className="font-semibold">Build Evidence</div>
      <div className="mt-1 text-xs leading-5 text-[var(--muted)]">
        Sources checked: {sourcesChecked.join(", ")}
      </div>
      {evidence.length === 0 ? (
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          No build or PR status evidence was returned by Azure DevOps.
        </p>
      ) : (
        <div className="mt-2 grid gap-2">
          {evidence.map((item) => (
            <div
              className="rounded border border-[var(--line)] bg-[var(--panel)] p-2 text-xs"
              key={`${item.source}-${item.label}-${item.url ?? "no-url"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2 py-1 font-semibold text-[var(--muted)]">
                  {item.source}
                </span>
                <span className="font-semibold">{item.state}</span>
                {item.url ? (
                  <a
                    className="inline-flex items-center gap-1 font-semibold text-[var(--blue)] hover:underline"
                    href={item.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open evidence <ExternalLink size={11} />
                  </a>
                ) : null}
              </div>
              <div className="mt-1 leading-5 text-[var(--muted)]">
                {item.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PullRequestStatusesPanel({
  statuses,
}: {
  statuses: PullRequestStatus[];
}) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-3 text-sm">
      <div className="font-semibold">PR Status Checks</div>
      {statuses.length === 0 ? (
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          No PR status checks were returned by Azure DevOps.
        </p>
      ) : (
        <div className="mt-2 grid gap-2">
          {statuses.map((status, index) => (
            <div
              className="rounded border border-[var(--line)] bg-[var(--panel)] p-2 text-xs"
              key={`${status.context?.genre ?? "status"}-${status.context?.name ?? index}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2 py-1 font-semibold text-[var(--muted)]">
                  {status.context?.genre ?? "status"}
                </span>
                <span className="font-semibold">
                  {status.context?.name ?? "Unnamed status"}
                </span>
                <span>{status.state ?? "unknown"}</span>
                {status.targetUrl ? (
                  <a
                    className="inline-flex items-center gap-1 font-semibold text-[var(--blue)] hover:underline"
                    href={status.targetUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open status <ExternalLink size={11} />
                  </a>
                ) : null}
              </div>
              {status.description ? (
                <div className="mt-1 leading-5 text-[var(--muted)]">
                  {status.description}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BuildStatus({
  evidence,
  sourcesChecked,
}: {
  evidence?: BuildEvidence[];
  sourcesChecked?: string[];
}) {
  const resolvedEvidence = getBuildEvidence(evidence ?? []);

  if (resolvedEvidence.state === "unresolved") {
    return (
      <span
        className="text-xs text-[var(--muted)]"
        title={`Checked: ${(sourcesChecked ?? []).join(", ")}`}
      >
        Unresolved
      </span>
    );
  }

  const passed = resolvedEvidence.state === "passed";
  const className = `inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
    passed
      ? "bg-[var(--green-soft)] text-[var(--green)]"
      : "bg-[var(--amber-soft)] text-[var(--amber)]"
  }`;
  const content = (
    <>
      {passed ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
      {resolvedEvidence.label}
      {resolvedEvidence.url ? <ExternalLink size={11} /> : null}
    </>
  );

  if (resolvedEvidence.url) {
    return (
      <a
        className={`${className} hover:underline`}
        href={resolvedEvidence.url}
        rel="noreferrer"
        target="_blank"
        title="Open build or PR status evidence"
      >
        {content}
      </a>
    );
  }

  return (
    <span className={className}>{content}</span>
  );
}

function StatusPill({ state }: { state: LoadState }) {
  const label =
    state === "loading"
      ? "Connecting"
      : state === "success"
        ? "Connected"
        : state === "error"
          ? "Error"
          : "Not connected";

  return (
    <div className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--line)] bg-white px-3 text-sm font-semibold">
      {state === "loading" ? (
        <Loader2 className="animate-spin" size={16} />
      ) : state === "success" ? (
        <CheckCircle2 size={16} className="text-[var(--green)]" />
      ) : state === "error" ? (
        <XCircle size={16} className="text-[var(--red)]" />
      ) : (
        <ShieldCheck size={16} className="text-[var(--muted)]" />
      )}
      {label}
    </div>
  );
}

function EmptyState() {
  return (
    <section className="rounded-lg border border-dashed border-[var(--line-strong)] bg-white/70 p-10 text-center">
      <GitPullRequest className="mx-auto text-[var(--muted)]" size={34} />
      <h2 className="mt-3 text-lg font-semibold">Connect to Azure DevOps</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">
        Enter a PAT with read access to Code, Pull Requests, Work Items, and
        Builds. The first read will validate repo access and load branches and
        PRs.
      </p>
    </section>
  );
}

function toAzureRequest(form: ConnectionForm, pat: string) {
  return {
    config: {
      orgUrl: form.orgUrl,
      project: form.project,
      repository: form.repository,
    },
    credentials: {
      pat,
    },
  };
}

function loadInitialForm(): ConnectionForm {
  if (typeof window === "undefined") {
    return DEFAULT_FORM;
  }

  const savedProject = window.localStorage.getItem(PROJECT_STORAGE_KEY);
  window.sessionStorage.removeItem(LEGACY_PAT_STORAGE_KEY);

  if (!savedProject) {
    return DEFAULT_FORM;
  }

  try {
    const parsed = JSON.parse(savedProject) as Partial<ConnectionForm>;
    return {
      ...DEFAULT_FORM,
      ...parsed,
    };
  } catch {
    return DEFAULT_FORM;
  }
}

function loadInitialWriteActivities(): WriteActivity[] {
  if (typeof window === "undefined") {
    return [];
  }

  const savedActivities = window.localStorage.getItem(
    WRITE_ACTIVITY_STORAGE_KEY,
  );

  if (!savedActivities) {
    return [];
  }

  try {
    const parsed = JSON.parse(savedActivities);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isWriteActivity).slice(0, MAX_WRITE_ACTIVITY_RECORDS);
  } catch {
    return [];
  }
}

function saveWriteActivities(activities: WriteActivity[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    WRITE_ACTIVITY_STORAGE_KEY,
    JSON.stringify(activities),
  );
}

function loadInitialRuleCheckHistory(): RuleCheckHistoryEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  const savedHistory = window.localStorage.getItem(
    RULE_CHECK_HISTORY_STORAGE_KEY,
  );

  if (!savedHistory) {
    return [];
  }

  try {
    const parsed = JSON.parse(savedHistory);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isRuleCheckHistoryEntry)
      .slice(0, MAX_RULE_CHECK_HISTORY_RECORDS);
  } catch {
    return [];
  }
}

function saveRuleCheckHistory(entries: RuleCheckHistoryEntry[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    RULE_CHECK_HISTORY_STORAGE_KEY,
    JSON.stringify(entries),
  );
}

function loadInitialRequestIntakeRecords(): RequestIntakeRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  return parseRequestIntakeRecords(
    window.localStorage.getItem(REQUEST_INTAKE_STORAGE_KEY),
  );
}

function saveRequestIntakeRecords(records: RequestIntakeRecord[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    REQUEST_INTAKE_STORAGE_KEY,
    serializeRequestIntakeRecords(records),
  );
}

function isWriteActivity(value: unknown): value is WriteActivity {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const activity = value as Partial<WriteActivity>;
  return (
    typeof activity.id === "string" &&
    typeof activity.pullRequestId === "number" &&
    typeof activity.message === "string" &&
    typeof activity.createdAt === "string" &&
    activity.status === "success" &&
    (activity.operation === "create-pr" ||
      activity.operation === "link-work-item" ||
      activity.operation === "update-description" ||
      activity.operation === "post-comment") &&
    (activity.webUrl === undefined || typeof activity.webUrl === "string")
  );
}

function isRuleCheckHistoryEntry(
  value: unknown,
): value is RuleCheckHistoryEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const entry = value as Partial<RuleCheckHistoryEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.repository === "string" &&
    (entry.mode === "delivery" || entry.mode === "audit") &&
    typeof entry.checkedCount === "number" &&
    typeof entry.blockedCount === "number" &&
    typeof entry.warningCount === "number" &&
    typeof entry.passedCount === "number" &&
    typeof entry.markdown === "string" &&
    typeof entry.createdAt === "string" &&
    Array.isArray(entry.gateSummary) &&
    entry.gateSummary.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof item.label === "string" &&
        typeof item.count === "number",
    )
  );
}

function emptyCreatePrForm(): CreatePrForm {
  return {
    sourceBranch: "",
    targetBranch: "develop",
    title: "",
    isDraft: true,
    policyAcknowledged: false,
  };
}

function buildInitialCreatePrForm(overview: AzureOverview): CreatePrForm {
  const sourceBranch =
    overview.branches.find(
      (branch) => !branch.isProtected && isTestWriteAllowedBranch(branch.name),
    )?.name ?? "";
  const targetBranch = sourceBranch
    ? getRecommendedTargetBranch(sourceBranch)
    : "develop";

  return {
    sourceBranch,
    targetBranch,
    title: sourceBranch ? buildDefaultPullRequestTitle(sourceBranch) : "",
    isDraft: true,
    policyAcknowledged: false,
  };
}

function buildDefaultPullRequestTitle(sourceBranch: string) {
  const suffix = sourceBranch.includes("/")
    ? sourceBranch.split("/").slice(1).join("/")
    : sourceBranch;

  return suffix || sourceBranch;
}

function formatActivityTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function buildControlPlaneReadinessItems(
  overview: AzureOverview | null,
  ruleChecks: RuleCheckReport[],
  ruleCheckHistory: RuleCheckHistoryEntry[],
  writeActivities: WriteActivity[],
) {
  const presentRuleSources =
    overview?.ruleSources.filter((source) => source.status === "present")
      .length ?? 0;
  const missingRuleSources =
    overview?.ruleSources.filter((source) => source.status !== "present")
      .length ?? 0;
  const activePullRequests =
    overview?.pullRequests.filter((pullRequest) => pullRequest.status === "active")
      .length ?? 0;
  const buildEvidenceCount =
    overview?.pullRequests.filter(
      (pullRequest) => pullRequest.buildEvidence.length > 0,
    ).length ?? 0;

  return [
    {
      label: "Azure connection",
      status: overview ? "ready" : "pending",
      detail: overview
        ? `Connected to ${overview.repository.name}.`
        : "Connect Azure DevOps with a PAT to load repository evidence.",
    },
    {
      label: "Protected branches",
      status:
        overview &&
        overview.protectedBranches.develop &&
        overview.protectedBranches.main &&
        overview.protectedBranches.release
          ? "ready"
          : overview
            ? "attention"
            : "pending",
      detail: overview
        ? `develop: ${overview.protectedBranches.develop ? "yes" : "missing"}, main: ${
            overview.protectedBranches.main ? "yes" : "missing"
          }, release: ${overview.protectedBranches.release ? "yes" : "missing"}.`
        : "Protected branch evidence has not been loaded.",
    },
    {
      label: "Repo rule sources",
      status:
        overview && missingRuleSources === 0
          ? "ready"
          : overview
            ? "attention"
            : "pending",
      detail: overview
        ? `${presentRuleSources} rule source(s) present, ${missingRuleSources} missing or unreadable.`
        : "AGENTS and wiki-derived rule sources have not been loaded.",
    },
    {
      label: "PR evidence",
      status: overview
        ? overview.pullRequests.length > 0
          ? "ready"
          : "attention"
        : "pending",
      detail: overview
        ? `${overview.pullRequests.length} PR(s) loaded, ${activePullRequests} active.`
        : "Pull request list has not been loaded.",
    },
    {
      label: "Build evidence",
      status: overview
        ? buildEvidenceCount > 0
          ? "ready"
          : "attention"
        : "pending",
      detail: overview
        ? `${buildEvidenceCount} loaded PR(s) include build or status evidence.`
        : "Build evidence has not been read from Azure.",
    },
    {
      label: "Rule checks",
      status: ruleChecks.length > 0 ? "ready" : "pending",
      detail:
        ruleChecks.length > 0
          ? `${ruleChecks.length} current rule check report(s) available.`
          : "Run Delivery Gate or Historical Audit to create rule findings.",
    },
    {
      label: "Agent handoff",
      status: ruleChecks.length > 0 ? "ready" : "pending",
      detail:
        ruleChecks.length > 0
          ? "Agent Packet generation is available for checked PRs."
          : "Agent Packet generation becomes available after rule checks.",
    },
    {
      label: "Audit retention",
      status:
        ruleCheckHistory.length > 0 || writeActivities.length > 0
          ? "ready"
          : "pending",
      detail: `${ruleCheckHistory.length} rule check history item(s), ${writeActivities.length} write activity item(s).`,
    },
  ] satisfies Array<{
    label: string;
    status: "ready" | "pending" | "attention";
    detail: string;
  }>;
}

function summarizeRuleCheckCounts(reports: RuleCheckReport[]) {
  return reports.reduce(
    (counts, report) => {
      counts[report.status] += 1;
      return counts;
    },
    { blocked: 0, warning: 0, passed: 0 },
  );
}

function findExistingActivePullRequest(
  activePullRequests: PullRequestSummary[],
  form: CreatePrForm,
) {
  return activePullRequests.find(
    (pullRequest) =>
      pullRequest.sourceBranch === form.sourceBranch &&
      pullRequest.targetBranch === form.targetBranch,
  );
}

function findPullRequestWebUrl(
  overview: AzureOverview | null,
  pullRequestId: number,
) {
  return overview?.pullRequests.find(
    (pullRequest) => pullRequest.id === pullRequestId,
  )?.webUrl;
}

function findSourceBranchForPullRequest(
  overview: AzureOverview | null,
  reports: RuleCheckReport[],
  pullRequestId: number,
) {
  return (
    reports.find((report) => report.pullRequestId === pullRequestId)
      ?.sourceBranch ??
    overview?.pullRequests.find(
      (pullRequest) => pullRequest.id === pullRequestId,
    )?.sourceBranch
  );
}

function classifyControlPlaneError(message: string) {
  const normalized = message.toLowerCase();
  const amberStyle = {
    backgroundClass: "bg-[var(--amber-soft)]",
    borderClass: "border-[var(--amber)]",
    textClass: "text-[var(--amber)]",
  };
  const redStyle = {
    backgroundClass: "bg-[var(--red-soft)]",
    borderClass: "border-[var(--red)]",
    textClass: "text-[var(--red)]",
  };

  if (
    normalized.includes("missing required field(s): pat") ||
    normalized.includes("pat is required") ||
    normalized.includes("reconnect with a pat")
  ) {
    return {
      ...redStyle,
      title: "PAT missing",
      action:
        "Reconnect with an Azure DevOps PAT. The App keeps PAT only in page memory, so closing or refreshing the page may require re-entry.",
    };
  }

  if (normalized.includes("401") || normalized.includes("unauthorized")) {
    return {
      ...redStyle,
      title: "PAT authentication failed",
      action:
        "Check that the PAT is not expired, belongs to the expected Azure DevOps account, and can access this organization.",
    };
  }

  if (
    normalized.includes("403") ||
    normalized.includes("forbidden") ||
    normalized.includes("permission")
  ) {
    return {
      ...redStyle,
      title: "Azure permission scope missing",
      action:
        "Confirm the PAT has the required read scope for this operation. Read checks need Code, Pull Requests, Work Items, and Build read scopes; guarded writes need explicit write scopes.",
    };
  }

  if (
    normalized.includes("404") ||
    normalized.includes("not found") ||
    normalized.includes("was not found")
  ) {
    return {
      ...redStyle,
      title: "Azure resource not found",
      action:
        "Check the organization URL, project name, repository name, PR ID, or Work Item ID. This usually means the target does not exist or the PAT cannot see it.",
    };
  }

  if (
    normalized.includes("latest build") ||
    normalized.includes("build evidence") ||
    normalized.includes("build status")
  ) {
    return {
      ...amberStyle,
      title: "Build evidence unavailable",
      action:
        "The App could not read enough pipeline/build evidence. Check Build read scope and whether the PR or source branch has a matching build.",
    };
  }

  if (normalized.includes("reviewer")) {
    return {
      ...amberStyle,
      title: "Reviewer evidence unavailable",
      action:
        "The App could not read reviewer evidence. Check Pull Requests read scope and Azure reviewer policy visibility.",
    };
  }

  if (
    normalized.includes("work item") ||
    normalized.includes("workitems") ||
    normalized.includes("wiql")
  ) {
    return {
      ...amberStyle,
      title: "Work Item evidence unavailable",
      action:
        "The App could not read Azure Boards evidence. Check Work Items read scope and that the Work Item is in this project.",
    };
  }

  if (normalized.includes("testing-stage azure writes are limited")) {
    return {
      ...amberStyle,
      title: "Testing-stage write blocked",
      action:
        "This is expected during testing. Azure writes are limited to source branches under AITraining/*; all other branches are read-only in the App.",
    };
  }

  return {
    ...redStyle,
    title: "Control plane operation failed",
    action:
      "Review the technical detail and retry after correcting the connector, request, or Azure evidence issue.",
  };
}

function formatClientError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function isPrErrorResponse(data: unknown): data is AzurePrErrorResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    "detailUnavailable" in data &&
    Boolean((data as AzurePrErrorResponse).detailUnavailable)
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}
