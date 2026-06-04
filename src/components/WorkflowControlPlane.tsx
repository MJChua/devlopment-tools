"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Clipboard,
  GitPullRequest,
  HelpCircle,
  Image as ImageIcon,
  Loader2,
  Plus,
  Play,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Terminal,
  Upload,
  Users,
  X,
} from "lucide-react";
import type { ChangeEvent, ClipboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ThemeControls } from "@/components/theme-controls";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { WorkItemQueryResult } from "@/lib/azure-devops";
import {
  summarizeStageGateBlockers,
  type BlockerSummary,
} from "@/lib/blocker-summary";
import {
  PACKET_SIZE_WARNING_CHARS,
  RUN_SOFT_TIMEOUT_MS,
  getPrDeliveryTraceForRequest,
  getNextAgentRole,
  type AzureReferenceEvidence,
  type ClarificationPrompt,
  type DeliveryMode,
  type PrDeliveryTrace,
  type RequestAttachment,
  type RequestEvidenceMode,
  type StageGateResult,
  type WorkerRegistration,
  type WorkerRegistrationWithToken,
  type WorkflowRequest,
  type WorkflowRequestDetail,
} from "@/lib/control-plane-workflow";
import {
  analyzeNaturalLanguageRequest,
  type RequestInterpretation,
} from "@/lib/request-analysis";
import {
  getBrowserRealtimeUrl,
  getRealtimeReconnectDelay,
  parseRealtimeMessage,
  shouldUseRealtimeFallback,
  type RealtimeConnectionStatus,
} from "@/lib/realtime";
import {
  type AzureReferenceType,
} from "@/lib/request-intake";
import type { RuntimeConfig } from "@/lib/runtime-config";

type LoadState = "idle" | "loading" | "success" | "error";
type WorkspaceTab = "new" | "process";

type WorkflowRequestForm = {
  detail: string;
  owner: string;
  assignedWorkerId: string;
  azureWorkItemId: string;
  deliveryMode: DeliveryMode | "";
};

type WorkerForm = {
  workerId: string;
  displayName: string;
  repoPath: string;
  commandTemplate: string;
  azurePat: string;
  autoCommitAndPr: boolean;
  sandboxMode: "workspace-write" | "danger-full-access";
  dangerFullAccessConfirmed: boolean;
};

type RepositoryCandidate = {
  name: string;
  path: string;
  source: string;
};

type WorkerConnectionInfo = {
  ready: boolean;
  label: string;
  detail: string;
  diagnosticCode: WorkerRegistration["codexDiagnosticCode"];
  executablePath: string;
};

type LocalLauncherState = {
  checked: boolean;
  available: boolean;
  version: string;
  expectedLauncherVersion: string;
  launcherVersionStatus: "current" | "mismatch" | "unknown";
  installMode: "scheduled-task" | "temporary-startup-folder" | "unknown";
  scheduledTaskStatus: "installed" | "access-denied" | "failed" | "unknown";
  requiresAdminInstall: boolean;
  scheduledTaskError: string;
  hasProfile: boolean;
  hasAzurePat: boolean;
  running: boolean;
  pid: number | null;
  workerStatusReason:
    | "running"
    | "pid_not_running"
    | "pid_missing"
    | "profile_missing"
    | "";
  workerVersion: string;
  workerScriptHash: string;
  workerUpdatedAt: string;
  error: string;
};

type LocalLauncherHealth = {
  ok: boolean;
  version: string;
  port: number;
  installMode?: "scheduled-task" | "temporary-startup-folder" | "unknown";
  scheduledTaskStatus?: "installed" | "access-denied" | "failed" | "unknown";
  requiresAdminInstall?: boolean;
  scheduledTaskError?: string;
};

type WorkerBootstrapManifestView = {
  workerVersion: string;
  launcherVersion?: string;
  files: Array<{ name: string; sha256: string; bytes: number }>;
  launcherFiles?: Array<{ name: string; sha256: string; bytes: number }>;
};

type LocalLauncherWorkerStatus = {
  ok: boolean;
  workerId: string;
  hasProfile: boolean;
  hasAzurePat: boolean;
  running: boolean;
  pid: number | null;
  workerStatusReason?:
    | "running"
    | "pid_not_running"
    | "pid_missing"
    | "profile_missing";
  workerVersion?: string;
  workerScriptHash?: string;
  workerUpdatedAt?: string;
};

type LauncherError = Error & { code?: string };

type RuntimeConfigState = RuntimeConfig;

type WorkItemCandidate = {
  id: string;
  webUrl?: string;
  title?: string;
  type?: string;
  state?: string;
  assignedTo?: string;
  areaPath?: string;
  iterationPath?: string;
};

type WorkItemIterationNode = {
  id: string;
  name: string;
  path: string;
  startDate?: string;
  finishDate?: string;
  children: WorkItemIterationNode[];
};

type WorkItemIterationOption = {
  id: string;
  name: string;
  path: string;
  depth: number;
  startDate?: string;
  finishDate?: string;
};

type WorkItemFilterState = {
  iterationPath: string;
  state: string;
  type: string;
  assignedTo: string;
};

type WorkItemFilterOptions = {
  states: string[];
  types: string[];
  assignees: string[];
};

type WorkerRunView = WorkflowRequestDetail["runs"][number];
type PullRequestDiscoveryMatch = {
  pullRequestId: number;
  title: string;
  status: string;
  sourceBranch: string;
  targetBranch: string;
  webUrl: string;
};
type PullRequestDiscoveryResult = {
  trace: PrDeliveryTrace;
  link?: WorkflowRequestDetail["prLinks"][number];
  matches?: PullRequestDiscoveryMatch[];
};
type PullRequestCreateResult = PullRequestDiscoveryResult & {
  created: boolean;
  pullRequest?: PullRequestDiscoveryMatch;
};
type ConnectionPulseTone = "green" | "amber" | "red";
type StagedRequestAttachment = {
  id: string;
  file: File;
  filename: string;
  contentType: string;
  sizeBytes: number;
  previewUrl: string;
};

const DEFAULT_REQUEST_FORM: WorkflowRequestForm = {
  detail: "",
  owner: "",
  assignedWorkerId: "",
  azureWorkItemId: "",
  deliveryMode: "",
};

const DEFAULT_WORKER_FORM: WorkerForm = {
  workerId: "",
  displayName: "",
  repoPath: "",
  commandTemplate: "",
  azurePat: "",
  autoCommitAndPr: false,
  sandboxMode: "workspace-write",
  dangerFullAccessConfirmed: false,
};

const DEFAULT_WORK_ITEM_FILTERS: WorkItemFilterState = {
  iterationPath: "",
  state: "",
  type: "",
  assignedTo: "",
};

const WORK_ITEM_QUERY_TOP = 1000;
const REQUEST_ATTACHMENT_LIMIT = 10;
const REQUEST_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const SUPPORTED_REQUEST_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const SELECT_ALL_VALUE = "__all__";
const REPOSITORY_PLACEHOLDER_VALUE = "__repository_placeholder__";
const SELECTED_REQUEST_STORAGE_KEY = "control-plane:selected-request-id";

const DEFAULT_AZURE_CONFIG = {
  orgUrl: "https://dev.azure.com/odin-tech",
  project: "MT5-Trading-Platform",
  repository: "odin-mt5-web",
};

const LOCAL_LAUNCHER_URL = "http://127.0.0.1:17320";
const DEFAULT_LOCAL_LAUNCHER_STATE: LocalLauncherState = {
  checked: false,
  available: false,
  version: "",
  expectedLauncherVersion: "",
  launcherVersionStatus: "unknown",
  installMode: "unknown",
  scheduledTaskStatus: "unknown",
  requiresAdminInstall: false,
  scheduledTaskError: "",
  hasProfile: false,
  hasAzurePat: false,
  running: false,
  pid: null,
  workerStatusReason: "",
  workerVersion: "",
  workerScriptHash: "",
  workerUpdatedAt: "",
  error: "",
};

export function WorkflowControlPlane() {
  const [requests, setRequests] = useState<WorkflowRequest[]>([]);
  const [workers, setWorkers] = useState<WorkerRegistration[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [detail, setDetail] = useState<WorkflowRequestDetail | null>(null);
  const [stageGate, setStageGate] = useState<StageGateResult | null>(null);
  const [requestForm, setRequestForm] =
    useState<WorkflowRequestForm>(DEFAULT_REQUEST_FORM);
  const [stagedAttachments, setStagedAttachments] = useState<
    StagedRequestAttachment[]
  >([]);
  const [workerForm, setWorkerForm] = useState<WorkerForm>(DEFAULT_WORKER_FORM);
  const [prLinkForm, setPrLinkForm] = useState({ pullRequestId: "" });
  const [prDiscoveryState, setPrDiscoveryState] = useState<LoadState>("idle");
  const [prDiscoveryMessage, setPrDiscoveryMessage] = useState("");
  const [prDiscoveryMatches, setPrDiscoveryMatches] = useState<
    PullRequestDiscoveryMatch[]
  >([]);
  const prDiscoveryKeyRef = useRef("");
  const [lastRegisteredWorker, setLastRegisteredWorker] =
    useState<WorkerRegistrationWithToken | null>(null);
  const [repoCandidates, setRepoCandidates] = useState<RepositoryCandidate[]>([]);
  const [repoScanState, setRepoScanState] = useState<LoadState>("idle");
  const [workItemCandidates, setWorkItemCandidates] = useState<
    WorkItemCandidate[]
  >([]);
  const [workItemState, setWorkItemState] = useState<LoadState>("idle");
  const [workItemIterations, setWorkItemIterations] =
    useState<WorkItemIterationNode | null>(null);
  const [workItemIterationState, setWorkItemIterationState] =
    useState<LoadState>("idle");
  const [workItemFilters, setWorkItemFilters] = useState<WorkItemFilterState>(
    DEFAULT_WORK_ITEM_FILTERS,
  );
  const [workItemTruncated, setWorkItemTruncated] = useState(false);
  const [workItemPickerOpen, setWorkItemPickerOpen] = useState(false);
  const [codexSetupState, setCodexSetupState] = useState<LoadState>("idle");
  const [launcherState, setLauncherState] = useState<LocalLauncherState>(
    DEFAULT_LOCAL_LAUNCHER_STATE,
  );
  const [launcherActionState, setLauncherActionState] =
    useState<LoadState>("idle");
  const [workerRefreshState, setWorkerRefreshState] =
    useState<LoadState>("idle");
  const [copyState, setCopyState] = useState<
    "idle" | "copied" | "selected" | "error"
  >("idle");
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigState>({
    controlPlaneUrl: "",
    source: "browser-fallback",
  });
  const [state, setState] = useState<LoadState>("idle");
  const [message, setMessage] = useState("");
  const [activeWorkspaceTab, setActiveWorkspaceTab] =
    useState<WorkspaceTab>("new");
  const [requestListCollapsed, setRequestListCollapsed] = useState(true);
  const [selectedRequestStorageReady, setSelectedRequestStorageReady] =
    useState(false);
  const [recoveryNotesByRequest, setRecoveryNotesByRequest] = useState<
    Record<string, string>
  >({});
  const [recoveryAttachmentsByRequest, setRecoveryAttachmentsByRequest] =
    useState<Record<string, StagedRequestAttachment[]>>({});
  const [recentlySubmittedRequestId, setRecentlySubmittedRequestId] =
    useState("");
  const requestDetailRef = useRef<HTMLTextAreaElement>(null);
  const progressPanelRef = useRef<HTMLElement>(null);
  const stagedAttachmentsRef = useRef<StagedRequestAttachment[]>([]);
  const recoveryAttachmentsByRequestRef = useRef<
    Record<string, StagedRequestAttachment[]>
  >({});
  const commandPreviewRef = useRef<HTMLPreElement>(null);
  const repoRefreshInFlightRef = useRef(false);
  const workflowRefreshInFlightRef = useRef(false);
  const [setupDialogRequested, setSetupDialogRequested] = useState(false);
  const [
    dismissedClarificationDialogKey,
    setDismissedClarificationDialogKey,
  ] = useState("");
  const [realtimeStatus, setRealtimeStatus] =
    useState<RealtimeConnectionStatus>("connecting");
  const selectedRequestIdRef = useRef("");
  const previousCanUseWorkflowRef = useRef(false);
  const hydratedWorkerSignatureRef = useRef("");

  const selectedRequest = useMemo(
    () =>
      (detail?.request.requestId === selectedRequestId ? detail.request : null) ??
      requests.find((request) => request.requestId === selectedRequestId) ??
      null,
    [detail, requests, selectedRequestId],
  );
  const selectedRuns =
    detail?.request.requestId === selectedRequestId ? detail.runs : [];
  const nextAgent = selectedRequest
    ? getNextAgentRole(selectedRequest, selectedRuns)
    : null;
  const openRun = selectedRuns.find(isOpenWorkerRun) ?? null;
  const latestRun = selectedRuns[selectedRuns.length - 1] ?? null;
  const clarificationDialogKey =
    selectedRequest && stageGate?.clarificationPrompt && stageGate.blockedRunId
      ? `${selectedRequest.requestId}:${stageGate.blockedRunId}`
      : "";
  const quickClarificationDialogOpen = Boolean(
    stageGate?.clarificationPrompt &&
      clarificationDialogKey &&
      dismissedClarificationDialogKey !== clarificationDialogKey &&
      stageGate.needsClarification &&
      !openRun,
  );
  const recoveryNote = selectedRequestId
    ? recoveryNotesByRequest[selectedRequestId] ?? ""
    : "";
  const recoveryAttachments = selectedRequestId
    ? recoveryAttachmentsByRequest[selectedRequestId] ?? []
    : [];
  const currentOwner = requestForm.owner.trim() || "local-user";
  const currentWorker = useMemo(
    () =>
      workers.find((worker) => worker.workerId === requestForm.assignedWorkerId) ??
      workers.find((worker) => worker.workerId === createLocalWorkerId(currentOwner)) ??
      null,
    [currentOwner, requestForm.assignedWorkerId, workers],
  );
  const connectionInfo = useMemo(
    () => getWorkerConnectionInfo(currentWorker, repoCandidates),
    [currentWorker, repoCandidates],
  );
  const selectedRepoPath = workerForm.repoPath || currentWorker?.repoPath || "";
  const selectedRepoName = useMemo(
    () =>
      getRepositoryDisplayName(selectedRepoPath, repoCandidates, currentWorker),
    [currentWorker, repoCandidates, selectedRepoPath],
  );
  const canUseWorkflow = connectionInfo.ready && Boolean(selectedRepoPath);
  const setupDialogOpen = !canUseWorkflow || setupDialogRequested;
  const launcherStatusText = formatLauncherStatus(launcherState);
  const launcherVersionMismatch =
    launcherState.launcherVersionStatus === "mismatch";
  const workerHasRecentHeartbeat = Boolean(
    currentWorker?.lastSeenAt && !isStaleTimestamp(currentWorker.lastSeenAt),
  );
  const localWorkerConnected = Boolean(
    currentWorker &&
      currentWorker.status !== "disabled" &&
      (launcherState.available
        ? launcherState.running || launcherState.hasProfile
        : workerHasRecentHeartbeat),
  );
  const hasAzureWorkItemAccess =
    Boolean(workerForm.azurePat.trim()) ||
    (launcherState.available && launcherState.hasAzurePat);
  const hasPrDiscoveryAccess = hasAzureWorkItemAccess;
  const workerHasActiveRequest = Boolean(
    currentWorker &&
      requests.some(
        (request) =>
          request.assignedWorkerId === currentWorker.workerId &&
          isActiveWorkflowStage(request.status),
      ),
  );
  const controlPlaneUrl = runtimeConfig.controlPlaneUrl;
  const launcherConnectionButtonLabel = localWorkerConnected
    ? "停止連線"
    : launcherState.available
      ? "啟動連線"
      : "安裝";
  const launcherConnectionButtonDisabled =
    launcherActionState === "loading" ||
    state === "loading" ||
    (localWorkerConnected && workerHasActiveRequest);
  const launcherConnectionButtonTitle = localWorkerConnected
    ? workerHasActiveRequest
      ? "Agent 執行中，完成後可停止"
      : "停止本機 worker 連線"
    : launcherState.available
      ? "啟動本機 worker 連線"
      : "安裝本機 Launcher";
  const launcherConnectionButtonClass = localWorkerConnected
    ? "border border-red-200 bg-white text-red-700 disabled:bg-slate-100 disabled:text-slate-400"
    : "border border-slate-900 bg-slate-900 text-white disabled:border-slate-300 disabled:bg-slate-300";
  const visibleRequests = useMemo(
    () =>
      requests.filter(
        (request) =>
          request.owner === currentOwner &&
          isRequestForSelectedRepository(request, selectedRepoPath),
      ),
    [currentOwner, requests, selectedRepoPath],
  );
  const requestListIsCollapsed =
    requestListCollapsed && Boolean(selectedRequest);
  const visibleBlockedRequestCount = visibleRequests.filter(
    (request) => request.status === "blocked",
  ).length;
  const selectedRequestIsVisible = Boolean(
    selectedRequest &&
      visibleRequests.some(
        (request) => request.requestId === selectedRequest.requestId,
      ),
  );
  const selectedRequestNeedsAttention = Boolean(
    selectedRequestIsVisible &&
      selectedRequest &&
      (isActiveWorkflowStage(selectedRequest.status) ||
        selectedRequest.status === "blocked"),
  );
  const activeVisibleRequest = useMemo(
    () => {
      if (selectedRequestNeedsAttention && selectedRequest) {
        return selectedRequest;
      }

      return (
        visibleRequests.find((request) => isActiveWorkflowStage(request.status)) ??
        visibleRequests.find((request) => request.status === "blocked") ??
        null
      );
    },
    [selectedRequest, selectedRequestNeedsAttention, visibleRequests],
  );
  const hasLauncherSecondaryControls = Boolean(
    lastRegisteredWorker ||
      workerHasActiveRequest ||
      (currentWorker && !launcherVersionMismatch),
  );
  const selectedWorker = useMemo(
    () =>
      selectedRequest
        ? workers.find(
            (worker) => worker.workerId === selectedRequest.assignedWorkerId,
          ) ?? null
        : null,
    [selectedRequest, workers],
  );
  const activeVisibleWorker = useMemo(
    () =>
      activeVisibleRequest
        ? workers.find(
            (worker) => worker.workerId === activeVisibleRequest.assignedWorkerId,
          ) ?? null
        : null,
    [activeVisibleRequest, workers],
  );
  const requestInterpretation = useMemo(() => {
    if (!requestForm.detail.trim()) {
      return null;
    }

    try {
      return analyzeNaturalLanguageRequest(requestForm.detail);
    } catch {
      return null;
    }
  }, [requestForm.detail]);
  const workItemIterationOptions = useMemo(
    () =>
      workItemIterations ? flattenWorkItemIterations(workItemIterations) : [],
    [workItemIterations],
  );
  const selectedWorkItemIteration =
    workItemIterationOptions.find(
      (iteration) => iteration.path === workItemFilters.iterationPath,
    ) ?? null;
  const workItemFilterOptions = useMemo(
    () => buildWorkItemFilterOptions(workItemCandidates),
    [workItemCandidates],
  );
  const selectedWorkItem =
    workItemCandidates.find((item) => item.id === requestForm.azureWorkItemId) ??
    null;

  useEffect(() => {
    const restoreSelectedRequest = window.setTimeout(() => {
      setSelectedRequestId(
        window.localStorage.getItem(SELECTED_REQUEST_STORAGE_KEY) ?? "",
      );
      setSelectedRequestStorageReady(true);
    }, 0);

    void loadRuntimeConfig();
    void refreshAll({ silent: true });
    void refreshLocalLauncher({ silent: true });
    return () => window.clearTimeout(restoreSelectedRequest);
    // Initial hydration only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stagedAttachmentsRef.current = stagedAttachments;
  }, [stagedAttachments]);

  useEffect(() => {
    recoveryAttachmentsByRequestRef.current = recoveryAttachmentsByRequest;
  }, [recoveryAttachmentsByRequest]);

  useEffect(
    () => () => {
      stagedAttachmentsRef.current.forEach((attachment) =>
        URL.revokeObjectURL(attachment.previewUrl),
      );
      Object.values(recoveryAttachmentsByRequestRef.current).forEach(
        (attachments) =>
          attachments.forEach((attachment) =>
            URL.revokeObjectURL(attachment.previewUrl),
          ),
      );
    },
    [],
  );

  useEffect(() => {
    if (!selectedRequestStorageReady) {
      return;
    }

    selectedRequestIdRef.current = selectedRequestId;
    if (selectedRequestId) {
      window.localStorage.setItem(SELECTED_REQUEST_STORAGE_KEY, selectedRequestId);
    } else {
      window.localStorage.removeItem(SELECTED_REQUEST_STORAGE_KEY);
    }
  }, [selectedRequestId, selectedRequestStorageReady]);

  useEffect(() => {
    if (!selectedRequestId || requests.length === 0) {
      return;
    }

    const selectedExists = requests.some(
      (request) => request.requestId === selectedRequestId,
    );
    const selectedVisible = visibleRequests.some(
      (request) => request.requestId === selectedRequestId,
    );
    if (!selectedExists || selectedVisible) {
      return;
    }

    const hiddenRequestId = selectedRequestId;
    const clearHiddenRequest = window.setTimeout(() => {
      if (selectedRequestIdRef.current !== hiddenRequestId) {
        return;
      }

      setSelectedRequestId("");
      setDetail(null);
      setStageGate(null);
    }, 0);

    return () => window.clearTimeout(clearHiddenRequest);
  }, [requests, selectedRequestId, visibleRequests]);

  useEffect(() => {
    if (!recentlySubmittedRequestId) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => setRecentlySubmittedRequestId(""),
      12000,
    );
    return () => window.clearTimeout(timeoutId);
  }, [recentlySubmittedRequestId]);

  useEffect(() => {
    if (!previousCanUseWorkflowRef.current && canUseWorkflow) {
      setSetupDialogRequested(false);
    }
    previousCanUseWorkflowRef.current = canUseWorkflow;
  }, [canUseWorkflow]);

  useEffect(() => {
    const canLoadWorkItems =
      requestForm.deliveryMode === "draft_pr" &&
      workerForm.autoCommitAndPr &&
      hasAzureWorkItemAccess;

    if (canLoadWorkItems && workItemIterationState === "idle") {
      void loadWorkItemIterations({ silent: true });
    }
    // The loader intentionally reads the latest PAT from local component state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    requestForm.deliveryMode,
    hasAzureWorkItemAccess,
    workerForm.autoCommitAndPr,
    workItemIterationState,
  ]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let reconnectAttempt = 0;
    let closedByEffect = false;

    function refreshFromRealtime() {
      void refreshAll({ silent: true });
      const requestId = selectedRequestIdRef.current;
      if (requestId) {
        void refreshSelectedRequest(requestId, { silent: true });
      }
    }

    function scheduleReconnect() {
      if (closedByEffect) {
        return;
      }

      const delay = getRealtimeReconnectDelay(reconnectAttempt);
      reconnectAttempt += 1;
      setRealtimeStatus(
        shouldUseRealtimeFallback(reconnectAttempt) ? "fallback" : "reconnecting",
      );
      reconnectTimer = window.setTimeout(connect, delay);
    }

    function connect() {
      if (closedByEffect) {
        return;
      }

      setRealtimeStatus(reconnectAttempt === 0 ? "connecting" : "reconnecting");

      try {
        socket = new WebSocket(getBrowserRealtimeUrl());
      } catch {
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        reconnectAttempt = 0;
        setRealtimeStatus("connected");
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") {
          return;
        }

        const message = parseRealtimeMessage(event.data);
        if (!message) {
          return;
        }

        if (message.type === "hello" || message.type === "state:changed") {
          refreshFromRealtime();
        }
      };
      socket.onerror = () => {
        if (socket?.readyState !== WebSocket.CLOSED) {
          socket?.close();
        }
      };
      socket.onclose = () => {
        socket = null;
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      closedByEffect = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
    // WebSocket owns routine workflow refreshes; fallback polling stays in separate effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshLocalLauncher({ silent: true });
    // Launcher status follows the selected local worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorker?.workerId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshLocalLauncher({ silent: true });
    }, 5000);

    return () => window.clearInterval(timer);
    // Keep local launcher status fresh without disturbing workflow polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorker?.workerId]);

  useEffect(() => {
    void loadRepositoryCandidates({ silent: true });
    // Repository candidates are reported by the selected local worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOwner, requestForm.assignedWorkerId]);

  useEffect(() => {
    if (selectedRequestId) {
      void refreshSelectedRequest(selectedRequestId);
    }
  }, [selectedRequestId]);

  useEffect(() => {
    const usePollingFallback =
      realtimeStatus === "fallback" || realtimeStatus === "disconnected";
    if (canUseWorkflow || !usePollingFallback) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshAll({ silent: true });
      void loadRepositoryCandidates({ silent: true });
    }, 4000);

    return () => window.clearInterval(timer);
    // Poll local worker readiness without surfacing routine refresh noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canUseWorkflow,
    currentOwner,
    currentWorker?.status,
    currentWorker?.workerId,
    realtimeStatus,
    requestForm.assignedWorkerId,
  ]);

  useEffect(() => {
    const usePollingFallback =
      realtimeStatus === "fallback" || realtimeStatus === "disconnected";
    if (!usePollingFallback) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshAll({ silent: true });
    }, 8000);

    return () => window.clearInterval(timer);
    // Fallback keeps the request list moving when the realtime channel is down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimeStatus]);

  useEffect(() => {
    const usePollingFallback =
      realtimeStatus === "fallback" || realtimeStatus === "disconnected";
    if (!selectedRequestId || !usePollingFallback) {
      return;
    }

    const timer = window.setInterval(
      () => void refreshWorkflowStatus(selectedRequestId),
      openRun ? 2500 : 8000,
    );

    return () => window.clearInterval(timer);
    // Poll selected workflow status without surfacing routine refresh noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    openRun?.runId,
    openRun?.status,
    realtimeStatus,
    selectedRequest?.status,
    selectedRequestId,
  ]);

  useEffect(() => {
    if (
      !selectedRequest ||
      selectedRequest.deliveryMode !== "draft_pr" ||
      selectedRequest.status !== "pr_ready" ||
      !hasPrDiscoveryAccess ||
      detail?.prLinks.length
    ) {
      return;
    }

    const lastTrace = selectedRequest.resumeSnapshot?.prDeliveryTrace;
    if (
      lastTrace?.discoveryStatus === "not_found" ||
      lastTrace?.discoveryStatus === "ambiguous" ||
      lastTrace?.discoveryStatus === "failed"
    ) {
      return;
    }

    const key = `${selectedRequest.requestId}:${launcherState.hasAzurePat}:${Boolean(workerForm.azurePat.trim())}`;
    if (prDiscoveryKeyRef.current === key || prDiscoveryState === "loading") {
      return;
    }

    prDiscoveryKeyRef.current = key;
    void discoverPullRequestLink({ silent: true });
    // Auto-discovery intentionally calls the current helper with current PAT/launcher state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    detail?.prLinks.length,
    hasPrDiscoveryAccess,
    launcherState.hasAzurePat,
    prDiscoveryState,
    selectedRequest?.deliveryMode,
    selectedRequest?.requestId,
    selectedRequest?.status,
    selectedRequest?.resumeSnapshot?.prDeliveryTrace?.discoveryStatus,
    workerForm.azurePat,
  ]);

  async function loadRuntimeConfig() {
    try {
      const result = await fetchJson<RuntimeConfig>("/api/runtime-config");
      setRuntimeConfig({
        controlPlaneUrl: result.controlPlaneUrl || getBrowserControlPlaneUrl(),
        source: result.controlPlaneUrl ? result.source : "browser-fallback",
      });
    } catch {
      setRuntimeConfig({
        controlPlaneUrl: getBrowserControlPlaneUrl(),
        source: "browser-fallback",
      });
    }
  }

  async function refreshLocalLauncher(options: { silent?: boolean } = {}) {
    if (!options.silent) {
      setLauncherActionState("loading");
    }

    try {
      const [health, manifest] = await Promise.all([
        fetchLauncherJson<LocalLauncherHealth>("/health"),
        fetchJson<WorkerBootstrapManifestView>(
          "/api/workers/bootstrap?file=worker-manifest.json",
        ).catch(() => null),
      ]);
      const workerId =
        currentWorker?.workerId ||
        requestForm.assignedWorkerId ||
        createLocalWorkerId(currentOwner);
      let workerStatus: LocalLauncherWorkerStatus | null = null;

      if (workerId) {
        workerStatus = await fetchLauncherJson<LocalLauncherWorkerStatus>(
          `/status?workerId=${encodeURIComponent(workerId)}`,
        ).catch(() => null);
      }

      const workerStatusReason =
        workerStatus?.workerStatusReason ||
        inferWorkerStatusReason(workerStatus);
      const expectedLauncherVersion = manifest?.launcherVersion || "";
      setLauncherState({
        checked: true,
        available: true,
        version: health.version || "",
        expectedLauncherVersion,
        launcherVersionStatus: getLauncherVersionStatus(
          health.version || "",
          expectedLauncherVersion,
        ),
        installMode: health.installMode || "unknown",
        scheduledTaskStatus: health.scheduledTaskStatus || "unknown",
        requiresAdminInstall: health.requiresAdminInstall === true,
        scheduledTaskError: health.scheduledTaskError || "",
        hasProfile: Boolean(workerStatus?.hasProfile),
        hasAzurePat: Boolean(workerStatus?.hasAzurePat),
        running: Boolean(workerStatus?.running),
        pid: workerStatus?.pid ?? null,
        workerStatusReason,
        workerVersion: workerStatus?.workerVersion || "",
        workerScriptHash: workerStatus?.workerScriptHash || "",
        workerUpdatedAt: workerStatus?.workerUpdatedAt || "",
        error: "",
      });
      if (!options.silent) {
        setLauncherActionState("success");
      }
    } catch (error) {
      setLauncherState({
        ...DEFAULT_LOCAL_LAUNCHER_STATE,
        checked: true,
        error: formatError(error),
      });
      if (!options.silent) {
        setLauncherActionState("error");
      }
    }
  }

  async function refreshAll(options: { silent?: boolean } = {}) {
    if (!options.silent) {
      setState("loading");
      setMessage("正在讀取最新狀態...");
    }

    try {
      const [requestsResult, workersResult] = await Promise.all([
        fetchJson<{ requests: WorkflowRequest[] }>("/api/requests"),
        fetchJson<{ workers: WorkerRegistration[] }>("/api/workers"),
      ]);

      setRequests(requestsResult.requests);
      setWorkers(workersResult.workers);
      const workerToHydrate = findCurrentWorkerRegistration(
        workersResult.workers,
        requestForm.assignedWorkerId,
        currentOwner,
      );
      const workerSignature = workerToHydrate
        ? getWorkerHydrationSignature(workerToHydrate)
        : "";
      if (
        workerToHydrate &&
        workerSignature !== hydratedWorkerSignatureRef.current
      ) {
        hydratedWorkerSignatureRef.current = workerSignature;
        setWorkerForm((current) =>
          hydrateWorkerFormFromRegistration(current, workerToHydrate),
        );
      }
      if (
        selectedRequestId &&
        !requestsResult.requests.some(
          (request) => request.requestId === selectedRequestId,
        )
      ) {
        setSelectedRequestId("");
      }
      if (!options.silent) {
        setState("success");
        setMessage("狀態已更新。");
      }
    } catch (error) {
      if (!options.silent) {
        setState("error");
        setMessage(formatError(error));
      }
    }
  }

  async function loadRepositoryCandidates(options: { silent?: boolean } = {}) {
    if (repoRefreshInFlightRef.current) {
      return;
    }

    repoRefreshInFlightRef.current = true;
    if (!options.silent) {
      setRepoScanState("loading");
    }

    try {
      const workerId =
        currentWorker?.workerId ||
        requestForm.assignedWorkerId ||
        createLocalWorkerId(currentOwner);
      const result = await fetchJson<{ repositories: RepositoryCandidate[] }>(
        `/api/workers/repositories?workerId=${encodeURIComponent(workerId)}`,
      );
      setRepoCandidates((current) =>
        sameRepositoryCandidates(current, result.repositories)
          ? current
          : result.repositories,
      );
      if (!options.silent) {
        setRepoScanState("success");
      }
    } catch {
      if (!options.silent) {
        setRepoScanState("error");
      }
    } finally {
      repoRefreshInFlightRef.current = false;
    }
  }

  async function fetchAzureJson<T>(
    apiPath:
      | "/api/azure/iterations"
      | "/api/azure/work-items"
      | `/api/azure/work-item/${string}`,
    payload: Record<string, unknown>,
  ) {
    const token = workerForm.azurePat.trim();
    if (token) {
      return fetchJson<T>(apiPath, {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          credentials: { pat: token },
        }),
      });
    }

    const workerId =
      currentWorker?.workerId ||
      requestForm.assignedWorkerId ||
      createLocalWorkerId(currentOwner);
    if (launcherState.available && launcherState.hasAzurePat && workerId) {
      const launcherPath = apiPath.startsWith("/api/azure/work-item/")
        ? apiPath.replace("/api/azure", "/azure")
        : apiPath === "/api/azure/iterations"
          ? "/azure/iterations"
          : "/azure/work-items";
      return fetchLauncherJson<T>(
        launcherPath,
        {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            workerId,
          }),
        },
      );
    }

    throw new Error("Azure PAT is required.");
  }

  async function fetchPullRequestDiscovery(requestId: string) {
    const payload = {
      actor: currentOwner,
      config: DEFAULT_AZURE_CONFIG,
    };
    const token = workerForm.azurePat.trim();
    if (token) {
      return fetchJson<PullRequestDiscoveryResult>(
        `/api/requests/${requestId}/pr-discover`,
        {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            credentials: { pat: token },
          }),
        },
      );
    }

    const workerId =
      currentWorker?.workerId ||
      requestForm.assignedWorkerId ||
      createLocalWorkerId(currentOwner);
    if (launcherState.available && launcherState.hasAzurePat && workerId) {
      return fetchLauncherJson<PullRequestDiscoveryResult>(
        `/requests/${encodeURIComponent(requestId)}/pr-discover`,
        {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            workerId,
          }),
        },
      );
    }

    throw new Error("Azure PAT is required.");
  }

  async function fetchPullRequestCreate(requestId: string) {
    const payload = {
      actor: currentOwner,
      config: DEFAULT_AZURE_CONFIG,
      confirmWrite: true,
    };
    const token = workerForm.azurePat.trim();
    if (token) {
      return fetchJson<PullRequestCreateResult>(
        `/api/requests/${requestId}/pr-create`,
        {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            credentials: { pat: token },
          }),
        },
      );
    }

    const workerId =
      currentWorker?.workerId ||
      requestForm.assignedWorkerId ||
      createLocalWorkerId(currentOwner);
    if (launcherState.available && launcherState.hasAzurePat && workerId) {
      return fetchLauncherJson<PullRequestCreateResult>(
        `/requests/${encodeURIComponent(requestId)}/pr-create`,
        {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            workerId,
          }),
        },
      );
    }

    throw new Error("Azure PAT is required.");
  }

  async function loadWorkItemIterations(
    options: { silent?: boolean } = {},
  ) {
    if (!hasAzureWorkItemAccess) {
      return;
    }

    if (!options.silent) {
      setMessage("正在讀取 Azure Sprint 清單...");
    }
    setWorkItemIterationState("loading");

    try {
      const result = await fetchAzureJson<{
        iterations: WorkItemIterationNode;
      }>("/api/azure/iterations", {
        config: DEFAULT_AZURE_CONFIG,
      });

      setWorkItemIterations(result.iterations);
      setWorkItemIterationState("success");
    } catch (error) {
      setWorkItemIterations(null);
      setWorkItemIterationState("error");
      setMessage(formatError(error));
    }
  }

  async function loadWorkItemCandidates(
    filters: WorkItemFilterState = workItemFilters,
  ) {
    if (!hasAzureWorkItemAccess) {
      setWorkItemCandidates([]);
      setWorkItemTruncated(false);
      return;
    }

    setWorkItemState("loading");
    try {
      const result = await fetchAzureJson<WorkItemQueryResult>(
        "/api/azure/work-items",
        {
          config: DEFAULT_AZURE_CONFIG,
          iterationPath: filters.iterationPath,
          state: filters.state,
          type: filters.type,
          assignedTo: filters.assignedTo,
          top: WORK_ITEM_QUERY_TOP,
        },
      );

      setWorkItemCandidates(result.workItems ?? []);
      setWorkItemTruncated(Boolean(result.isTruncated));
      setWorkItemState("success");
    } catch (error) {
      setWorkItemCandidates([]);
      setWorkItemTruncated(false);
      setWorkItemState("error");
      setMessage(formatError(error));
    }
  }

  function updateWorkItemFilters(next: Partial<WorkItemFilterState>) {
    const filters = { ...workItemFilters, ...next };
    setWorkItemFilters(filters);
    setRequestForm((current) => ({
      ...current,
      azureWorkItemId: "",
    }));
    void loadWorkItemCandidates(filters);
  }

  async function refreshSelectedRequest(
    requestId: string,
    options: { silent?: boolean } = {},
  ) {
    try {
      const [detailResult, stageGateResult] = await Promise.all([
        fetchJson<{ detail: WorkflowRequestDetail }>(`/api/requests/${requestId}`),
        fetchJson<{ stageGate: StageGateResult }>(
          `/api/requests/${requestId}/stage-gate`,
        ),
      ]);

      setDetail(detailResult.detail);
      setStageGate(stageGateResult.stageGate);
    } catch (error) {
      if (!options.silent) {
        setState("error");
        setMessage(formatError(error));
      }
    }
  }

  async function refreshWorkflowStatus(requestId: string) {
    if (workflowRefreshInFlightRef.current) {
      return;
    }

    workflowRefreshInFlightRef.current = true;
    try {
      await Promise.all([
        refreshAll({ silent: true }),
        refreshSelectedRequest(requestId, { silent: true }),
      ]);
    } finally {
      workflowRefreshInFlightRef.current = false;
    }
  }

  function handleRequestDetailPaste(
    event: ClipboardEvent<HTMLTextAreaElement>,
  ) {
    const imageFiles = getClipboardImageFiles(event);

    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    addRequestDetailAttachments(imageFiles);
  }

  function addRequestDetailAttachments(imageFiles: File[]) {
    const nextAttachments: StagedRequestAttachment[] = [];
    const errors: string[] = [];
    const remainingSlots =
      REQUEST_ATTACHMENT_LIMIT - stagedAttachmentsRef.current.length;

    imageFiles.slice(0, Math.max(remainingSlots, 0)).forEach((file) => {
      if (file.size > REQUEST_ATTACHMENT_MAX_BYTES) {
        errors.push(`${file.name || "pasted image"} 超過 10MB。`);
        return;
      }

      nextAttachments.push(createStagedAttachment(file));
    });

    if (imageFiles.length > remainingSlots) {
      errors.push("每個需求最多可附加 10 張圖片。");
    }

    if (nextAttachments.length > 0) {
      setStagedAttachments((current) => [...current, ...nextAttachments]);
    }

    if (errors.length > 0) {
      setState("error");
      setMessage(errors.join(" "));
    } else {
      setState("success");
      setMessage("圖片已加入需求附件。");
    }
  }

  function handleRecoveryNotePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = getClipboardImageFiles(event);

    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    addRecoveryAttachments(imageFiles);
  }

  function handleRecoveryAttachmentFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const imageFiles = Array.from(event.target.files ?? []).filter((file) =>
      SUPPORTED_REQUEST_IMAGE_TYPES.has(file.type),
    );
    event.target.value = "";
    addRecoveryAttachments(imageFiles);
  }

  function addRecoveryAttachments(imageFiles: File[]) {
    if (!selectedRequestId) {
      return;
    }

    if (imageFiles.length === 0) {
      setState("error");
      setMessage("只能補充 PNG、JPEG、WebP 或 GIF 圖片。");
      return;
    }

    const currentAttachments =
      recoveryAttachmentsByRequestRef.current[selectedRequestId] ?? [];
    const existingServerCount = detail?.attachments.length ?? 0;
    const remainingSlots =
      REQUEST_ATTACHMENT_LIMIT - existingServerCount - currentAttachments.length;
    const nextAttachments: StagedRequestAttachment[] = [];
    const errors: string[] = [];

    imageFiles.slice(0, Math.max(remainingSlots, 0)).forEach((file) => {
      if (file.size > REQUEST_ATTACHMENT_MAX_BYTES) {
        errors.push(`${file.name || "pasted image"} 超過 10MB。`);
        return;
      }

      nextAttachments.push(createStagedAttachment(file));
    });

    if (imageFiles.length > remainingSlots) {
      errors.push("每個需求最多可附加 10 張圖片。");
    }

    if (nextAttachments.length > 0) {
      setRecoveryAttachmentsByRequest((current) => ({
        ...current,
        [selectedRequestId]: [...currentAttachments, ...nextAttachments],
      }));
    }

    if (errors.length > 0) {
      setState("error");
      setMessage(errors.join(" "));
    } else {
      setState("success");
      setMessage("補件截圖已加入，送出補充後會交給同一個 Agent。");
    }
  }

  function removeStagedAttachment(attachmentId: string) {
    setStagedAttachments((current) => {
      const attachment = current.find((item) => item.id === attachmentId);
      if (attachment) {
        URL.revokeObjectURL(attachment.previewUrl);
      }

      return current.filter((item) => item.id !== attachmentId);
    });
  }

  function removeRecoveryAttachment(attachmentId: string) {
    if (!selectedRequestId) {
      return;
    }

    setRecoveryAttachmentsByRequest((current) => {
      const attachments = current[selectedRequestId] ?? [];
      const attachment = attachments.find((item) => item.id === attachmentId);
      if (attachment) {
        URL.revokeObjectURL(attachment.previewUrl);
      }

      return {
        ...current,
        [selectedRequestId]: attachments.filter((item) => item.id !== attachmentId),
      };
    });
  }

  function clearStagedAttachments() {
    stagedAttachmentsRef.current.forEach((attachment) =>
      URL.revokeObjectURL(attachment.previewUrl),
    );
    stagedAttachmentsRef.current = [];
    setStagedAttachments([]);
  }

  function clearRecoveryAttachments(requestId: string) {
    const attachments = recoveryAttachmentsByRequestRef.current[requestId] ?? [];
    attachments.forEach((attachment) =>
      URL.revokeObjectURL(attachment.previewUrl),
    );
    setRecoveryAttachmentsByRequest((current) => {
      const next = { ...current };
      delete next[requestId];
      recoveryAttachmentsByRequestRef.current = next;
      return next;
    });
  }

  function createStagedAttachment(file: File): StagedRequestAttachment {
    return {
      id: crypto.randomUUID(),
      file,
      filename: file.name || `pasted-image-${Date.now()}`,
      contentType: file.type,
      sizeBytes: file.size,
      previewUrl: URL.createObjectURL(file),
    };
  }

  function getClipboardImageFiles(event: ClipboardEvent<HTMLTextAreaElement>) {
    return Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
      .filter((file) => SUPPORTED_REQUEST_IMAGE_TYPES.has(file.type));
  }

  function setSelectedRecoveryNote(value: string) {
    if (!selectedRequestId) {
      return;
    }

    setRecoveryNotesByRequest((current) => ({
      ...current,
      [selectedRequestId]: value,
    }));
  }

  function startNewRequest() {
    clearStagedAttachments();
    setSelectedRequestId("");
    setActiveWorkspaceTab("new");
    setRequestForm((current) => ({
      ...DEFAULT_REQUEST_FORM,
      owner: current.owner,
      assignedWorkerId: current.assignedWorkerId,
    }));
    setState("success");
    setMessage("已保留目前阻擋紀錄，並清空表單可建立新需求。");
    window.setTimeout(() => requestDetailRef.current?.focus(), 0);
  }

  function startAdjustmentRequest() {
    if (!selectedRequest) {
      startNewRequest();
      return;
    }

    clearStagedAttachments();
    setSelectedRequestId("");
    setActiveWorkspaceTab("new");
    setRequestForm((current) => ({
      ...DEFAULT_REQUEST_FORM,
      owner: current.owner,
      assignedWorkerId: selectedRequest.assignedWorkerId || current.assignedWorkerId,
      azureWorkItemId:
        selectedRequest.azureReferenceType === "work-item"
          ? selectedRequest.azureReferenceId
          : "",
      deliveryMode: selectedRequest.deliveryMode,
    }));
    if (selectedRequest.repoPath) {
      setWorkerForm((current) => ({
        ...current,
        repoPath: selectedRequest.repoPath,
      }));
    }
    setState("success");
    setMessage("已另開調整需求；同一 Azure Work Item 會更新同一個 PR 分支。");
    window.setTimeout(() => requestDetailRef.current?.focus(), 0);
  }

  async function uploadRequestAttachments(requestId: string) {
    for (const attachment of stagedAttachmentsRef.current) {
      const formData = new FormData();
      formData.append("file", attachment.file, attachment.filename);
      formData.append("purpose", "intake");
      await fetchFormJson<{ attachment: RequestAttachment }>(
        `/api/requests/${requestId}/attachments`,
        formData,
      );
    }
  }

  async function uploadRecoveryAttachments(input: {
    requestId: string;
    blockedRunId: string;
    attachments: StagedRequestAttachment[];
  }) {
    const uploadedAttachments: RequestAttachment[] = [];
    for (const attachment of input.attachments) {
      const formData = new FormData();
      formData.append("file", attachment.file, attachment.filename);
      formData.append("purpose", "clarification");
      formData.append("recoveryOfRunId", input.blockedRunId);
      formData.append("actor", requestForm.owner || "control-plane");
      const result = await fetchFormJson<{ attachment: RequestAttachment }>(
        `/api/requests/${input.requestId}/attachments`,
        formData,
      );
      uploadedAttachments.push(result.attachment);
    }

    return uploadedAttachments;
  }

  function focusProgressPanel() {
    setActiveWorkspaceTab("process");
    window.setTimeout(() => {
      progressPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      progressPanelRef.current?.focus({ preventScroll: true });
    }, 0);
  }

  async function buildAzureReferenceEvidence(
    azureReference: { type: AzureReferenceType; id: string },
  ): Promise<AzureReferenceEvidence | undefined> {
    if (azureReference.type !== "work-item" || !azureReference.id) {
      return undefined;
    }

    const checkedAt = new Date().toISOString();
    const fallback = selectedWorkItem
      ? buildVerifiedWorkItemEvidence(selectedWorkItem, checkedAt)
      : null;

    if (!hasAzureWorkItemAccess) {
      return {
        status: "tracking",
        referenceType: "work-item",
        referenceId: azureReference.id,
        checkedAt,
        title: "",
        workItemType: "",
        workItemState: "",
        assignedTo: "",
        areaPath: "",
        iterationPath: "",
        webUrl: "",
        summary: "",
        error: "",
      };
    }

    try {
      const item = await fetchAzureJson<WorkItemCandidate>(
        `/api/azure/work-item/${encodeURIComponent(azureReference.id)}`,
        { config: DEFAULT_AZURE_CONFIG },
      );
      return buildVerifiedWorkItemEvidence(item, checkedAt);
    } catch (error) {
      if (fallback) {
        return fallback;
      }

      return {
        status: "unverified",
        referenceType: "work-item",
        referenceId: azureReference.id,
        checkedAt,
        title: "",
        workItemType: "",
        workItemState: "",
        assignedTo: "",
        areaPath: "",
        iterationPath: "",
        webUrl: "",
        summary: "",
        error: formatError(error),
      };
    }
  }

  async function createWorkflowRequest() {
    setState("loading");
    setMessage("正在建立需求，準備進入處理進度...");

    try {
      if (!canUseWorkflow || !currentWorker) {
        throw new Error("請先完成本機 Codex 連線並選擇本機專案。");
      }

      if (!requestForm.deliveryMode) {
        throw new Error("請先選擇交付方式。");
      }

      if (selectedRepoPath !== currentWorker.repoPath) {
        await persistWorkerRepository(currentWorker.workerId, selectedRepoPath);
      }

      const interpretation = analyzeNaturalLanguageRequest(requestForm.detail);
      const deliveryMode = requestForm.deliveryMode;
      const canUseSelectedWorkItem =
        deliveryMode === "draft_pr" &&
        workerForm.autoCommitAndPr &&
        hasAzureWorkItemAccess &&
        selectedWorkItem?.id === requestForm.azureWorkItemId &&
        !isUserStoryCandidate(selectedWorkItem);
      const azureReference = canUseSelectedWorkItem
        ? { type: "work-item" as AzureReferenceType, id: requestForm.azureWorkItemId }
        : extractAzureReferenceFromDetail(requestForm.detail);
      const azureReferenceEvidence =
        await buildAzureReferenceEvidence(azureReference);
      const assignedWorkerId = currentWorker.workerId;
      const result = await fetchJson<{ request: WorkflowRequest }>(
        "/api/requests",
        {
          method: "POST",
          body: JSON.stringify({
            detail: requestForm.detail,
            owner: currentOwner,
            assignedWorkerId,
            kind: interpretation.kind,
            title: interpretation.title,
            taskLevel: interpretation.taskLevel,
            azureReferenceType: azureReference.type,
            azureReferenceId: azureReference.id,
            azureReferenceEvidence,
            repoPath: selectedRepoPath,
            deliveryMode,
            evidenceMode: "standard",
            templateId: "freeform",
            interpretation,
          }),
        },
      );

      setSelectedRequestId(result.request.requestId);
      setRecentlySubmittedRequestId(result.request.requestId);
      focusProgressPanel();
      if (stagedAttachmentsRef.current.length > 0) {
        try {
          setMessage("正在上傳需求圖片附件...");
          await uploadRequestAttachments(result.request.requestId);
        } catch (error) {
          await Promise.all([
            refreshAll(),
            refreshSelectedRequest(result.request.requestId),
          ]);
          setState("error");
          setMessage(
            `需求 ${result.request.requestId} 已建立，但圖片上傳失敗，尚未派工：${formatError(error)}`,
          );
          return;
        }
      }

      setRequestForm((current) => ({
        ...DEFAULT_REQUEST_FORM,
        owner: current.owner,
        assignedWorkerId: current.assignedWorkerId,
      }));
      clearStagedAttachments();
      let successMessage = `已建立 ${result.request.requestId}。請先啟動本機 Codex 後再繼續。`;
      if (result.request.assignedWorkerId) {
        await fetchJson<{ run: unknown }>(
          `/api/requests/${result.request.requestId}/dispatch`,
          {
            method: "POST",
            body: JSON.stringify({
              workerId: result.request.assignedWorkerId,
              actor: currentOwner,
            }),
          },
        );
        successMessage = `已建立 ${result.request.requestId}，並交給本機 Codex 判讀。`;
      }
      await refreshAll();
      await refreshSelectedRequest(result.request.requestId);
      focusProgressPanel();
      setState("success");
      setMessage(successMessage);
    } catch (error) {
      setState("error");
      setMessage(formatError(error));
    }
  }

  async function installLocalLauncher() {
    setLauncherActionState("loading");
    const command = buildLauncherInstallCommand(controlPlaneUrl);
    const copyResult = await copyTextToClipboard(command);

    if (copyResult === "copied" || copyResult === "selected") {
      setLauncherActionState("success");
      setState("success");
      setMessage(
        launcherVersionMismatch
          ? "已複製更新指令，請在 PowerShell 執行一次後回到 App。"
          : "已複製管理員安裝指令，請貼到以系統管理員身分開啟的 PowerShell，完成後回到 App 重新檢查。",
      );
      return;
    }

    setLauncherActionState("error");
    setState("error");
    setMessage("無法複製安裝指令，請重新按安裝或檢查瀏覽器權限。");
  }

  async function registerLocalWorker() {
    if (!launcherState.available) {
      await installLocalLauncher();
      return;
    }

    setState("loading");
    setMessage("正在啟動本機背景 worker...");

    try {
      const azurePat = workerForm.azurePat.trim();
      const hasLauncherPat = launcherState.hasAzurePat;
      if (workerForm.autoCommitAndPr && !azurePat && !hasLauncherPat) {
        throw new Error("勾選自動準備 commit / draft PR 時，需要輸入 Azure PAT。");
      }
      if (
        workerForm.sandboxMode === "danger-full-access" &&
        !workerForm.dangerFullAccessConfirmed
      ) {
        throw new Error("使用 danger-full-access 前需要先確認本機高權限風險。");
      }

      const registration = buildWorkerRegistration(
        {
          ...workerForm,
          repoPath: workerForm.repoPath,
        },
        currentOwner,
      );
      const result = await fetchJson<{
        worker: WorkerRegistrationWithToken;
      }>("/api/workers", {
        method: "POST",
        body: JSON.stringify(registration),
      });

      await fetchLauncherJson("/connect", {
        method: "POST",
        body: JSON.stringify({
          controlPlaneUrl,
          worker: {
            workerId: result.worker.workerId,
            token: result.worker.token,
            repoPath: result.worker.repoPath,
            sandboxMode: result.worker.sandboxMode,
            autoCommitAndPr: result.worker.autoCommitAndPr,
          },
          azurePat,
        }),
      });

      setLastRegisteredWorker(null);
      setRequestForm((current) => ({
        ...current,
        assignedWorkerId: result.worker.workerId,
      }));
      await refreshAll();
      await refreshLocalLauncher({ silent: true });
      setSetupDialogRequested(false);
      setState("success");
      setMessage(
        azurePat || (workerForm.autoCommitAndPr && hasLauncherPat)
          ? "本機 Launcher 已保存 PAT"
          : "本機背景 worker 已啟動，刷新頁面後會由本機 Launcher 還原連線。",
      );
    } catch (error) {
      await refreshLocalLauncher({ silent: true });
      setState("error");
      const errorMessage = formatError(error);
      setMessage(
        errorMessage.includes("queued or running")
          ? "Agent 執行中，完成後可停止。"
          : errorMessage,
      );
    }
  }

  async function toggleLocalWorkerConnection() {
    if (localWorkerConnected) {
      await stopLocalWorker();
      return;
    }

    await registerLocalWorker();
  }

  async function dispatchAgent() {
    if (!selectedRequest) {
      return;
    }

    setState("loading");
    setMessage("正在派送下一步 Agent Packet...");

    try {
      await fetchJson<{ run: unknown }>(
        `/api/requests/${selectedRequest.requestId}/dispatch`,
        {
          method: "POST",
          body: JSON.stringify({
            workerId: selectedRequest.assignedWorkerId,
            actor: requestForm.owner || "control-plane",
          }),
        },
      );
      await Promise.all([
        refreshAll(),
        refreshSelectedRequest(selectedRequest.requestId),
      ]);
      setState("success");
      setMessage("已把下一步交給本機 Codex。");
    } catch (error) {
      setState("error");
      setMessage(formatError(error));
    }
  }

  async function recoverAgent(
    action: "retry_same_agent" | "clarify_and_retry",
    options: { clarification?: string; includeRecoveryAttachments?: boolean } = {},
  ) {
    if (!selectedRequest || !stageGate?.blockedRunId) {
      return;
    }

    setState("loading");
    setMessage(
      options.clarification ? "正在送出快速確認..." : "正在重跑同一個 Agent...",
    );

    try {
      const clarification =
        action === "clarify_and_retry"
          ? (options.clarification ?? recoveryNote)
          : "";
      const includeRecoveryAttachments =
        options.includeRecoveryAttachments ?? true;
      let clarificationAttachmentIds: string[] = [];
      if (
        action === "clarify_and_retry" &&
        includeRecoveryAttachments &&
        recoveryAttachments.length > 0
      ) {
        setMessage("正在上傳補件截圖...");
        const uploadedAttachments = await uploadRecoveryAttachments({
          requestId: selectedRequest.requestId,
          blockedRunId: stageGate.blockedRunId,
          attachments: recoveryAttachments,
        });
        clarificationAttachmentIds = uploadedAttachments.map(
          (attachment) => attachment.attachmentId,
        );
      }

      await fetchJson<{ run: unknown }>(
        `/api/requests/${selectedRequest.requestId}/recover`,
        {
          method: "POST",
          body: JSON.stringify({
            action,
            runId: stageGate.blockedRunId,
            clarification,
            clarificationAttachmentIds,
            actor: requestForm.owner || "control-plane",
          }),
        },
      );
      setRecoveryNotesByRequest((current) => {
        const next = { ...current };
        delete next[selectedRequest.requestId];
        return next;
      });
      clearRecoveryAttachments(selectedRequest.requestId);
      await Promise.all([
        refreshAll(),
        refreshSelectedRequest(selectedRequest.requestId),
      ]);
      setState("success");
      setMessage("已建立同一個 Agent 的恢復重跑。");
    } catch (error) {
      setState("error");
      setMessage(formatError(error));
    }
  }

  async function submitQuickClarification(clarification: string) {
    if (!clarificationDialogKey) {
      return;
    }

    setDismissedClarificationDialogKey(clarificationDialogKey);
    await recoverAgent("clarify_and_retry", {
      clarification,
      includeRecoveryAttachments: false,
    });
  }

  async function rerunAgent() {
    const hasRecoveryInput =
      recoveryNote.trim().length > 0 || recoveryAttachments.length > 0;
    await recoverAgent(
      hasRecoveryInput ? "clarify_and_retry" : "retry_same_agent",
    );
  }

  async function cancelCurrentAgentRun() {
    if (!selectedRequest || !openRun) {
      return;
    }

    setState("loading");
    setMessage("正在停止目前 Agent run...");

    try {
      await fetchJson<{ run: unknown }>(
        `/api/requests/${selectedRequest.requestId}/runs/${openRun.runId}/cancel`,
        {
          method: "POST",
          body: JSON.stringify({
            actor: requestForm.owner || "control-plane",
          }),
        },
      );
      await Promise.all([
        refreshAll(),
        refreshSelectedRequest(selectedRequest.requestId),
      ]);
      setState("success");
      setMessage("已停止目前 Agent；可重跑同一個 Agent。");
    } catch (error) {
      setState("error");
      setMessage(formatError(error));
    }
  }

  function openQuickClarificationDialog() {
    setDismissedClarificationDialogKey("");
  }

  async function syncAgentOutput() {
    if (!selectedRequest || !stageGate?.blockedRunId) {
      return;
    }

    setState("loading");
    setMessage("正在從既有 Agent 輸出重新同步 handoff...");

    try {
      await fetchJson<{ run: unknown }>(
        `/api/requests/${selectedRequest.requestId}/recover`,
        {
          method: "POST",
          body: JSON.stringify({
            action: "sync_output",
            runId: stageGate.blockedRunId,
            actor: requestForm.owner || "control-plane",
          }),
        },
      );
      await Promise.all([
        refreshAll(),
        refreshSelectedRequest(selectedRequest.requestId),
      ]);
      setState("success");
      setMessage("已從既有 Agent 輸出重新同步 handoff。");
    } catch (error) {
      setState("error");
      setMessage(formatError(error));
    }
  }

  async function recordPullRequestLink() {
    if (!selectedRequest) {
      return;
    }

    const azurePat = workerForm.azurePat.trim();
    if (!hasPrDiscoveryAccess) {
      setState("error");
      setMessage("需要 Azure PAT 才能驗證並連結 Azure PR。");
      return;
    }

    setState("loading");
    setMessage("正在驗證並連結 Azure PR...");

    try {
      const payload = {
        pullRequestId: prLinkForm.pullRequestId,
        actor: requestForm.owner || "control-plane",
        config: DEFAULT_AZURE_CONFIG,
      };
      if (azurePat) {
        await fetchJson<{ link: unknown }>(
          `/api/requests/${selectedRequest.requestId}/pr-link`,
          {
            method: "POST",
            body: JSON.stringify({
              ...payload,
              credentials: { pat: azurePat },
            }),
          },
        );
      } else {
        const workerId =
          currentWorker?.workerId ||
          requestForm.assignedWorkerId ||
          createLocalWorkerId(currentOwner);
        await fetchLauncherJson<{ link: unknown }>(
          `/requests/${encodeURIComponent(selectedRequest.requestId)}/pr-link`,
          {
            method: "POST",
            body: JSON.stringify({
              ...payload,
              workerId,
            }),
          },
        );
      }
      setPrLinkForm({ pullRequestId: "" });
      await Promise.all([
        refreshAll(),
        refreshSelectedRequest(selectedRequest.requestId),
      ]);
      setState("success");
      setMessage("Azure PR 已驗證並連結。");
    } catch (error) {
      setState("error");
      setMessage(formatError(error));
    }
  }

  async function discoverPullRequestLink(options: { silent?: boolean } = {}) {
    if (!selectedRequest) {
      return;
    }

    setPrDiscoveryState("loading");
    setPrDiscoveryMessage(
      options.silent ? "正在自動偵測 Azure PR..." : "正在偵測 Azure PR...",
    );
    setPrDiscoveryMatches([]);

    try {
      const result = await fetchPullRequestDiscovery(selectedRequest.requestId);
      setPrDiscoveryMatches(result.matches ?? []);
      if (result.trace.discoveryStatus === "found") {
        setPrDiscoveryState("success");
        setPrDiscoveryMessage(
          result.trace.pullRequestId
            ? `已找到 Azure PR #${result.trace.pullRequestId}，並完成追蹤。`
            : "已找到 Azure PR，並完成追蹤。",
        );
      } else if (result.trace.discoveryStatus === "ambiguous") {
        setPrDiscoveryState("error");
        setPrDiscoveryMessage(
          "找到多筆符合分支的 Azure PR，請用下方手動補登 PR ID。",
        );
      } else if (result.trace.discoveryStatus === "not_found") {
        setPrDiscoveryState("idle");
        setPrDiscoveryMessage(
          "分支已推送後，Azure Repos 尚未出現對應 PR。可稍後重新偵測或手動補登。",
        );
      } else {
        setPrDiscoveryState("error");
        setPrDiscoveryMessage(result.trace.reason || "Azure PR 偵測失敗。");
      }

      await Promise.all([
        refreshAll(),
        refreshSelectedRequest(selectedRequest.requestId),
      ]);
    } catch (error) {
      setPrDiscoveryState("error");
      setPrDiscoveryMessage(formatError(error));
      if (!options.silent) {
        setMessage(formatError(error));
      }
    }
  }

  async function createOrRefreshPullRequest() {
    if (!selectedRequest) {
      return;
    }

    setPrDiscoveryState("loading");
    setPrDiscoveryMessage("正在建立或刷新 Azure PR...");
    setPrDiscoveryMatches([]);

    try {
      const result = await fetchPullRequestCreate(selectedRequest.requestId);
      setPrDiscoveryMatches(result.matches ?? []);
      setPrDiscoveryState("success");
      setPrDiscoveryMessage(
        result.created
          ? result.trace.pullRequestId
            ? `已建立 Azure Draft PR #${result.trace.pullRequestId}，並完成追蹤。`
            : "已建立 Azure Draft PR，並完成追蹤。"
          : result.trace.pullRequestId
            ? `已找到既有 Azure PR #${result.trace.pullRequestId}，並完成追蹤。`
            : "已找到既有 Azure PR，並完成追蹤。",
      );

      await Promise.all([
        refreshAll(),
        refreshSelectedRequest(selectedRequest.requestId),
      ]);
      setState("success");
      setMessage("Azure PR 已建立或完成刷新。");
    } catch (error) {
      setPrDiscoveryState("error");
      setPrDiscoveryMessage(formatError(error));
      setState("error");
      setMessage(formatError(error));
    }
  }

  async function copyWorkerCommand() {
    if (!lastRegisteredWorker) {
      return;
    }

    const command = buildWorkerCommand(
      lastRegisteredWorker,
      workerForm.azurePat,
      controlPlaneUrl,
    );
    const copyResult = await copyTextToClipboard(
      command,
      commandPreviewRef.current,
    );

    if (copyResult === "copied") {
      setCopyState("copied");
      setState("success");
      setMessage("本機連線指令已複製。");
    } else if (copyResult === "selected") {
      setCopyState("selected");
      setState("success");
      setMessage("瀏覽器不允許自動複製，已選取指令內容，請按 Ctrl+C。");
    } else {
      setCopyState("error");
      setState("error");
      setMessage("無法複製指令，請手動選取指令內容。");
    }
  }

  async function clearSavedAzurePat() {
    if (!currentWorker) {
      return;
    }

    if (workerHasActiveRequest) {
      setState("error");
      setMessage("Agent 執行中，完成後可清除 PAT。");
      return;
    }

    setLauncherActionState("loading");
    setState("loading");
    setMessage("正在清除本機 Launcher 保存的 PAT...");

    try {
      await fetchJson<{ canClearPat: boolean; worker: WorkerRegistration }>(
        `/api/workers/${encodeURIComponent(currentWorker.workerId)}/clear-pat`,
        {
          method: "POST",
        },
      );
      await fetchLauncherJson<{
        ok: boolean;
        workerId: string;
        hasAzurePat: boolean;
      }>("/clear-pat", {
        method: "POST",
        body: JSON.stringify({ workerId: currentWorker.workerId }),
      });
      setWorkerForm((current) => ({ ...current, azurePat: "" }));
      await Promise.all([
        refreshAll({ silent: true }),
        refreshLocalLauncher({ silent: true }),
      ]);
      setLauncherActionState("success");
      setState("success");
      setMessage("已清除本機 Launcher 保存的 PAT");
    } catch (error) {
      await refreshLocalLauncher({ silent: true });
      const errorMessage = formatError(error);
      setLauncherActionState("error");
      setState("error");
      setMessage(
        errorMessage.includes("queued or running")
          ? "Agent 執行中，完成後可清除 PAT。"
          : errorMessage,
      );
    }
  }

  async function stopLocalWorker() {
    if (!currentWorker) {
      return;
    }

    setState("loading");
    setMessage("正在停止本機連線...");

    try {
      await fetchJson<{ worker: WorkerRegistration }>(
        `/api/workers/${encodeURIComponent(currentWorker.workerId)}/stop`,
        {
          method: "POST",
        },
      );
      await stopLocalLauncherProfile(currentWorker.workerId).catch(() => undefined);
      setLastRegisteredWorker(null);
      setRepoCandidates([]);
      setWorkerForm((current) => ({ ...current, repoPath: "" }));
      setRequestForm((current) => ({ ...current, assignedWorkerId: "" }));
      await refreshAll({ silent: true });
      setState("success");
      setMessage("已停止本機連線。");
    } catch (error) {
      setState("error");
      setMessage(formatError(error));
    }
  }

  async function stopLocalLauncherProfile(workerId: string) {
    await fetchLauncherJson("/stop", {
      method: "POST",
      body: JSON.stringify({ workerId }),
    });
    await refreshLocalLauncher({ silent: true });
  }

  async function refreshLocalWorkerCache(
    options: { retrySameAgent?: boolean } = {},
  ) {
    if (!currentWorker) {
      return;
    }

    setWorkerRefreshState("loading");
    setState("loading");
    setMessage("正在重新下載並重啟本機 Worker...");

    try {
      await fetchLauncherJson("/refresh-worker", {
        method: "POST",
        body: JSON.stringify({ workerId: currentWorker.workerId }),
      });
      await Promise.all([
        refreshAll({ silent: true }),
        refreshLocalLauncher({ silent: true }),
        selectedRequestId
          ? refreshSelectedRequest(selectedRequestId, { silent: true })
          : Promise.resolve(),
      ]);
      setWorkerRefreshState("success");
      if (options.retrySameAgent && selectedRequest && stageGate?.blockedRunId) {
        await recoverAgent("retry_same_agent");
        return;
      }
      setState("success");
      setMessage(
        options.retrySameAgent
          ? "本機 Worker 已重新下載並重啟。可重跑同一個 Agent。"
          : "本機 Worker 已重新下載並重啟，會領取既有 queued run。",
      );
    } catch (error) {
      setWorkerRefreshState("error");
      setState("error");
      await refreshLocalLauncher({ silent: true });
      const errorMessage = formatError(error);
      if (getLauncherErrorCode(error) === "launcher_profile_missing") {
        setMessage(
          "本機連線資料不存在，請按「啟動連線」重新連線；需要 PR 時請重新輸入 PAT。",
        );
        return;
      }
      setMessage(
        errorMessage.includes("Not found")
          ? "本機 Launcher 版本太舊，請先按「安裝」更新 Launcher，再重新下載 Worker。"
          : errorMessage,
      );
    }
  }

  async function requestCodexSetup() {
    if (!currentWorker) {
      return;
    }

    setCodexSetupState("loading");
    try {
      await fetchJson<{ worker: WorkerRegistration }>(
        `/api/workers/${encodeURIComponent(currentWorker.workerId)}/codex-setup`,
        { method: "POST" },
      );
      if (launcherState.available) {
        await fetchLauncherJson("/setup-codex", {
          method: "POST",
          body: JSON.stringify({ workerId: currentWorker.workerId }),
        });
      }
      await refreshAll({ silent: true });
      setCodexSetupState("success");
      setState("success");
      setMessage("已要求本機 worker 安裝 Codex。");
    } catch (error) {
      setCodexSetupState("error");
      setState("error");
      setMessage(formatError(error));
    }
  }

  async function selectRepository(repoPath: string) {
    setWorkerForm((current) => ({ ...current, repoPath }));
    if (!currentWorker) {
      return;
    }

    try {
      await persistWorkerRepository(currentWorker.workerId, repoPath);
      await refreshAll({ silent: true });
    } catch (error) {
      setState("error");
      setMessage(formatError(error));
    }
  }

  async function persistWorkerRepository(workerId: string, repoPath: string) {
    await fetchJson<{ worker: WorkerRegistration }>(
      `/api/workers/${encodeURIComponent(workerId)}/repository`,
      {
        method: "POST",
        body: JSON.stringify({ repoPath }),
      },
    );
  }

  return (
    <main className="min-h-screen px-4 pb-5 pt-16 md:px-8 lg:py-5">
      <div className="fixed right-3 top-3 z-30 flex items-start gap-2 sm:right-5 sm:top-4">
        <ThemeControls />
        <ConnectionStatusEntry
          activeRequest={activeVisibleRequest}
          canUseWorkflow={canUseWorkflow}
          connectionInfo={connectionInfo}
          openRun={openRun}
          realtimeStatus={realtimeStatus}
          repoName={selectedRepoName}
          worker={currentWorker}
          onOpenSettings={() => setSetupDialogRequested(true)}
        />
      </div>
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="border-b border-slate-300 pb-5 pr-40 sm:pr-48 lg:pr-0">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
              <ShieldCheck className="h-4 w-4" />
              Agent Flow
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-slate-950">
              Codex 任務控制台
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              把需求交給 Codex，從本機執行一路追蹤到 Azure PR。
            </p>
          </div>
        </header>

        <ToastHost
          state={state}
          message={message}
          onDone={() => setMessage("")}
        />

        <SetupDialog
          canClose={canUseWorkflow}
          open={setupDialogOpen}
          onClose={() => setSetupDialogRequested(false)}
        >
            <div className="flex flex-col gap-3">
              <SetupStep
                detail="預設不做 Azure 寫入。只有你允許後，才會要求 PAT 並讓 worker 準備 commit / draft PR。"
                step="1"
                title="選擇 PR 權限"
              >
                <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <input
                    checked={workerForm.autoCommitAndPr}
                    className="mt-1 h-4 w-4"
                    onChange={(event) =>
                      setWorkerForm((current) => {
                        const autoCommitAndPr = event.target.checked;
                        return {
                          ...current,
                          autoCommitAndPr,
                          azurePat: autoCommitAndPr ? current.azurePat : "",
                        };
                      })
                    }
                    type="checkbox"
                  />
                  <span className="flex flex-wrap items-center gap-1">
                    允許我的本機 Codex 在檢查通過後準備 commit 與 draft PR。
                    <HoverTip>
                      到 Azure DevOps 右上角 User settings / Personal access
                      tokens / New Token。MVP 需要 Code/Pull Requests
                      讀寫、單號讀寫、Build 讀取。PAT 只會送到本機 Launcher，不會存入 App。
                    </HoverTip>
                    <span className="basis-full text-xs leading-5 text-slate-500">
                      merge PR、abandon PR、deploy、branch policy、單號欄位修改仍需人工操作。
                    </span>
                  </span>
                </label>
                {workerForm.autoCommitAndPr ? (
                  <>
                    <TextField
                      label="我的 Azure PAT"
                      value={workerForm.azurePat}
                      onChange={(azurePat) =>
                        setWorkerForm((current) => ({ ...current, azurePat }))
                      }
                      placeholder="只送到本機 Launcher，不會送到 /api/workers"
                      type="password"
                    />
                    <PatPersistenceStatus
                      activeRun={workerHasActiveRequest}
                      clearing={launcherActionState === "loading"}
                      hasSavedPat={launcherState.hasAzurePat}
                      onClear={clearSavedAzurePat}
                    />
                  </>
                ) : null}
              </SetupStep>

              <SetupStep step="2" title="本機執行權限">
                <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <input
                    checked={workerForm.sandboxMode === "danger-full-access"}
                    className="mt-1 h-4 w-4"
                    onChange={(event) =>
                      setWorkerForm((current) => ({
                        ...current,
                        sandboxMode: event.target.checked
                          ? "danger-full-access"
                          : "workspace-write",
                        dangerFullAccessConfirmed: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span className="font-semibold text-orange-600">
                    啟用完整存取權限
                  </span>
                </label>
                <p className="mt-2 text-xs leading-5 text-slate-600">
                  預設模式為 workspace-write，可處理一般專案內修改；跨資料夾或系統層級操作可能受限。
                </p>
                {workerForm.sandboxMode === "danger-full-access" ? (
                  <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 p-3 text-sm leading-6 text-orange-800">
                    完整存取權限會提高本機讀寫範圍，只在信任此專案與任務時使用。
                  </p>
                ) : null}
              </SetupStep>

              <SetupStep
                detail="本機 Launcher 會管理背景 worker。"
                headerContent={
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p
                      className="min-w-0 text-xs leading-5 text-slate-500 sm:truncate"
                      title={launcherStatusText}
                    >
                      {launcherStatusText}
                    </p>
                    <div className="flex w-full items-center gap-2 sm:ml-3 sm:w-auto sm:shrink-0">
                      <button
                        className={`inline-flex h-8 min-w-[5.5rem] flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold disabled:cursor-not-allowed sm:flex-none ${launcherConnectionButtonClass}`}
                        disabled={launcherConnectionButtonDisabled}
                        onClick={toggleLocalWorkerConnection}
                        title={launcherConnectionButtonTitle}
                        type="button"
                      >
                        {state === "loading" || launcherActionState === "loading" ? (
                          <Spinner className="h-3.5 w-3.5" />
                        ) : localWorkerConnected ? (
                          <X className="h-3.5 w-3.5" />
                        ) : (
                          <Terminal className="h-3.5 w-3.5" />
                        )}
                        {launcherConnectionButtonLabel}
                      </button>
                      {!launcherState.available ? <LauncherInstallTip /> : null}
                    </div>
                  </div>
                }
              step="3"
              title="產生並啟動 worker"
            >
                {launcherState.available && launcherVersionMismatch ? (
                  <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                    <div className="font-semibold">Launcher 需要更新</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      <li>目前 Launcher 是舊版，無法正確回報 worker 狀態。</li>
                      <li>先更新 Launcher，再重啟 Worker。</li>
                      <li>更新不會重建需求，也不會建立新的 Agent run。</li>
                    </ul>
                    <button
                      className="mt-3 inline-flex items-center justify-center gap-2 rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-800 disabled:cursor-not-allowed disabled:bg-red-100 disabled:text-red-400"
                      disabled={launcherActionState === "loading"}
                      onClick={installLocalLauncher}
                      type="button"
                    >
                      <Clipboard className="h-4 w-4" />
                      複製更新指令
                    </button>
                    <details className="mt-2 text-xs text-red-800">
                      <summary className="cursor-pointer font-semibold">
                        查看詳情
                      </summary>
                      <div className="mt-1 space-y-1 break-all">
                        <div>目前版本：{launcherState.version || "未知"}</div>
                        <div>
                          App 期望：{launcherState.expectedLauncherVersion || "未知"}
                        </div>
                      </div>
                    </details>
                  </div>
                ) : null}
                {launcherState.available &&
                launcherState.requiresAdminInstall &&
                !launcherVersionMismatch ? (
                  <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="font-semibold">Launcher 暫時模式</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      <li>Launcher 已是目前版本，但正式常駐安裝尚未完成。</li>
                      <li>目前透過 Startup folder 暫時啟動，可繼續使用。</li>
                      <li>重開機後可能不會自動啟動。</li>
                      <li>請貼到以系統管理員身分開啟的 PowerShell，建立 Windows Scheduled Task。</li>
                    </ul>
                    <button
                      className="mt-3 inline-flex items-center justify-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 disabled:cursor-not-allowed disabled:bg-amber-100 disabled:text-amber-500"
                      disabled={launcherActionState === "loading"}
                      onClick={installLocalLauncher}
                      type="button"
                    >
                      <Clipboard className="h-4 w-4" />
                      複製管理員安裝指令
                    </button>
                    <p className="mt-2 text-xs font-medium text-amber-800">
                      完成後重新檢查，/health 應回報 installMode=scheduled-task、requiresAdminInstall=false、scheduledTaskStatus=installed。
                    </p>
                    <details className="mt-2 text-xs text-amber-800">
                      <summary className="cursor-pointer font-semibold">
                        查看詳情
                      </summary>
                      <div className="mt-1 space-y-1 break-all">
                        <div>目前版本：{launcherState.version || "未知"}</div>
                        <div>
                          App 期望：{launcherState.expectedLauncherVersion || "未知"}
                        </div>
                        <div>安裝模式：{launcherState.installMode}</div>
                        <div>
                          Scheduled Task 狀態：{launcherState.scheduledTaskStatus}
                        </div>
                        <div>
                          Startup folder fallback：
                          {launcherState.installMode === "temporary-startup-folder"
                            ? "已偵測"
                            : "未偵測"}
                        </div>
                        <div>
                          Scheduled Task 錯誤：
                          {launcherState.scheduledTaskError || "未回報"}
                        </div>
                      </div>
                    </details>
                  </div>
                ) : null}
                {hasLauncherSecondaryControls ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      {lastRegisteredWorker ? (
                        <button
                          className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                          onClick={copyWorkerCommand}
                          type="button"
                        >
                          <Clipboard className="h-4 w-4" />
                          {copyState === "copied"
                            ? "已複製"
                            : copyState === "selected"
                              ? "已選取"
                              : "複製指令"}
                        </button>
                      ) : null}
                      {currentWorker &&
                      launcherState.available &&
                      launcherState.hasProfile &&
                      !launcherVersionMismatch ? (
                        <button
                          className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                          disabled={workerRefreshState === "loading"}
                          onClick={() => refreshLocalWorkerCache()}
                          type="button"
                        >
                          {workerRefreshState === "loading" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          重啟 Worker
                        </button>
                      ) : null}
                    </div>
                    {workerHasActiveRequest ? (
                      <p className="text-xs leading-5 text-slate-500">
                        目前有 Agent 任務等待或執行中，App
                        會先保護這次連線；完成後才可停止。
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {lastRegisteredWorker ? (
                  <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3">
                    <div className="text-sm font-semibold text-slate-950">
                      下一步：到本機 PowerShell / terminal 執行
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      複製下方指令後貼到使用者自己的 terminal，讓它保持執行。指令會下載
                      Local Worker Companion 到使用者本機快取目錄，再啟動 worker 回報
                      heartbeat 與可用專案清單。
                    </p>
                    <div className="mt-3 rounded-md border border-blue-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700">
                      <span className="font-semibold text-slate-900">
                        Worker 回連位址：
                      </span>
                      <span className="break-all">{controlPlaneUrl}</span>
                      {runtimeConfig.source === "browser-fallback" ? (
                        <span className="ml-1 text-slate-500">
                          使用目前瀏覽器網址
                        </span>
                      ) : null}
                    </div>
                    <pre
                      className="mt-3 max-h-48 overflow-auto rounded-md border border-slate-300 bg-slate-950 p-3 text-xs leading-5 text-slate-100"
                      ref={commandPreviewRef}
                    >
                      {buildWorkerCommand(
                        lastRegisteredWorker,
                        workerForm.azurePat,
                        controlPlaneUrl,
                        {
                          maskSecrets: true,
                        },
                      )}
                    </pre>
                  </div>
                ) : null}
              </SetupStep>

              <SetupStep
                detail="App 只讀 worker 回報的 repo 清單，不從瀏覽器或前端直接掃描你的硬碟。"
                step="4"
                title="等待回報並選擇本機專案"
              >
                <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
                  <WorkerConnectionStatus
                    connectionInfo={connectionInfo}
                    onSetup={requestCodexSetup}
                    settingUp={codexSetupState === "loading"}
                  />
                  <RepositoryPicker
                    candidates={repoCandidates}
                    loading={repoScanState === "loading"}
                    value={selectedRepoPath}
                    onChange={selectRepository}
                    onRefresh={loadRepositoryCandidates}
                  />
                </div>
              </SetupStep>
            </div>
          </SetupDialog>

          {stageGate?.clarificationPrompt && clarificationDialogKey ? (
            <QuickClarificationDialog
              loading={state === "loading"}
              open={quickClarificationDialogOpen}
              prompt={stageGate.clarificationPrompt}
              onOpenChange={(open) => {
                if (!open) {
                  setDismissedClarificationDialogKey(clarificationDialogKey);
                }
              }}
              onSubmit={submitQuickClarification}
            />
          ) : null}

          {canUseWorkflow ? (
            <WorkspaceTabs
              activeTab={activeWorkspaceTab}
              blockedCount={
                visibleRequests.filter((request) => request.status === "blocked")
                  .length
              }
              openCount={
                visibleRequests.filter((request) =>
                  isActiveWorkflowStage(request.status),
                ).length
              }
              onChange={(tab) => {
                if (
                  tab === "process" &&
                  activeVisibleRequest &&
                  !selectedRequestNeedsAttention
                ) {
                  setSelectedRequestId(activeVisibleRequest.requestId);
                }
                setActiveWorkspaceTab(tab);
              }}
            />
          ) : null}

          {canUseWorkflow && activeWorkspaceTab === "process" ? (
            <BackgroundJobBanner
              detail={detail}
              loading={state === "loading"}
              message={message}
              request={activeVisibleRequest}
              worker={activeVisibleWorker}
            />
          ) : null}

          {canUseWorkflow && activeWorkspaceTab === "new" ? (
        <section className="grid gap-4">
          <Panel
            icon={<Users className="h-4 w-4" />}
            title="新增需求"
          >
            <div className="inline-grid w-fit max-w-full justify-items-start gap-2">
              <CompactChoiceControl
                label="交付"
                placeholder="請先選擇"
                value={requestForm.deliveryMode}
                options={[
                  { label: "需要發PR", value: "draft_pr" },
                  { label: "不需要 PR", value: "no_pr" },
                ]}
                onChange={(value) =>
                  setRequestForm((current) => ({
                    ...current,
                    deliveryMode: value as DeliveryMode,
                  }))
                }
              />
              <p className="text-xs leading-5 text-slate-500">
                先選擇交付模式。
              </p>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-600">
                需求內容
              </span>
              <textarea
                className="min-h-44 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                disabled={!requestForm.deliveryMode}
                ref={requestDetailRef}
                value={requestForm.detail}
                onChange={(event) =>
                  setRequestForm((current) => ({
                    ...current,
                    detail: event.target.value,
                  }))
                }
                onPaste={handleRequestDetailPaste}
                placeholder={
                  requestForm.deliveryMode
                    ? "例：會員搜尋頁按下查詢沒有反應，附截圖；預期顯示符合 login name 的結果。"
                    : "請先選擇交付方式。"
                }
              />
            </label>
            <StagedAttachmentList
              attachments={stagedAttachments}
              onRemove={removeStagedAttachment}
            />
            {requestForm.deliveryMode === "draft_pr" &&
            workerForm.autoCommitAndPr ? (
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <AzureNumberIntake
                enabled
                hasPat={hasAzureWorkItemAccess}
                iterationLoading={workItemIterationState === "loading"}
                iterationState={workItemIterationState}
                loading={workItemState === "loading"}
                candidates={workItemCandidates}
                filterOptions={workItemFilterOptions}
                filters={workItemFilters}
                iterations={workItemIterationOptions}
                pickerOpen={workItemPickerOpen}
                selectedItem={selectedWorkItem}
                selectedIteration={selectedWorkItemIteration}
                truncated={workItemTruncated}
                value={requestForm.azureWorkItemId}
                onChange={(azureWorkItemId) =>
                  setRequestForm((current) => ({
                    ...current,
                    azureWorkItemId,
                  }))
                }
                onFilterChange={updateWorkItemFilters}
                onLoadIterations={loadWorkItemIterations}
                onPickerOpenChange={setWorkItemPickerOpen}
                onRefresh={() => loadWorkItemCandidates()}
              />
            </div>
            ) : null}
            {requestInterpretation ? (
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold text-slate-500">
                暫時判讀
              </div>
              <InterpretationPreview interpretation={requestInterpretation} />
            </div>
            ) : null}
            <button
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
              disabled={!requestForm.deliveryMode || !requestForm.detail.trim()}
              onClick={createWorkflowRequest}
              type="button"
            >
              <Play className="h-4 w-4" />
              送出並交給 Codex 判讀
            </button>
          </Panel>
        </section>
          ) : null}

        {canUseWorkflow && activeWorkspaceTab === "process" ? (
        <section
          className={`grid min-w-0 gap-4 rounded-md outline-none transition-shadow ${
            requestListIsCollapsed
              ? "xl:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]"
              : "xl:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]"
          } ${
            recentlySubmittedRequestId ? "ring-2 ring-blue-200 ring-offset-2" : ""
          }`}
          ref={progressPanelRef}
          tabIndex={-1}
        >
          <Panel
            icon={<GitPullRequest className="h-4 w-4" />}
            title="我的需求紀錄"
          >
            <div className="flex flex-col gap-3">
              <Button
                className="h-auto w-full justify-between gap-3 px-3 py-2 text-left"
                onClick={() => setRequestListCollapsed((current) => !current)}
                type="button"
                variant="outline"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-950">
                    {requestListIsCollapsed ? "展開需求紀錄" : "收合需求紀錄"}
                  </span>
                  <span className="mt-1 block truncate text-xs font-normal text-slate-500">
                    {visibleRequests.length} 筆 · {visibleBlockedRequestCount} 個阻擋
                    {selectedRequest
                      ? ` · ${formatRequestDisplayTitle(selectedRequest)}`
                      : ""}
                  </span>
                </span>
                {requestListIsCollapsed ? (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                )}
              </Button>

              {!requestListIsCollapsed ? (
                <div className="flex max-h-[520px] flex-col gap-2 overflow-auto">
                  {visibleRequests.length === 0 ? (
                    <EmptyState text="目前沒有你的需求紀錄。" />
                  ) : (
                    visibleRequests.map((request) => (
                      <button
                        className={`flex w-full min-w-0 flex-col rounded-md border p-3 text-left text-sm ${
                          selectedRequestId === request.requestId
                            ? "border-blue-500 bg-blue-50"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        } ${
                          recentlySubmittedRequestId === request.requestId
                            ? "ring-2 ring-blue-300"
                            : ""
                        }`}
                        key={request.requestId}
                        onClick={() => setSelectedRequestId(request.requestId)}
                        type="button"
                      >
                        <div className="min-w-0 break-words font-semibold text-slate-950">
                          {formatRequestDisplayTitle(request)}
                        </div>
                        <div className="mt-1 break-all font-mono text-xs text-slate-500">
                          {request.requestId}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="inline-flex min-h-7 min-w-[6.5rem] items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700">
                            {formatUiDeliveryMode(request.deliveryMode)}
                          </span>
                          <StageBadge
                            className="ml-auto w-28 shrink-0 justify-center"
                            stage={request.status}
                          />
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel
            icon={<ShieldCheck className="h-4 w-4" />}
            title="需求詳情"
          >
            {!selectedRequest || !detail ? (
              <EmptyState text="尚未選取需求。送出新需求後，這裡會顯示需求詳情。" />
            ) : (
              <div className="flex flex-col gap-4">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold uppercase text-slate-500">
                        {selectedRequest.kind} / {selectedRequest.taskLevel}
                      </div>
                      <h2 className="mt-1 break-words text-xl font-semibold text-slate-950">
                        {formatRequestDisplayTitle(selectedRequest)}
                      </h2>
                      <div className="mt-1 break-all font-mono text-xs text-slate-500">
                        {selectedRequest.requestId}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
                          {formatUiEvidenceMode(selectedRequest.evidenceMode)}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
                          {formatAzureReferenceEvidenceBadge(selectedRequest)}
                        </span>
                      </div>
                    </div>
                    <StageBadge
                      className="w-28 shrink-0 justify-center"
                      stage={selectedRequest.status}
                    />
                  </div>
                  <CollapsibleRequestDetail detail={selectedRequest.detail} />
                  <RequestAttachmentGallery
                    attachments={detail.attachments}
                    requestId={selectedRequest.requestId}
                  />
                  <div className="mt-4 rounded-md border border-slate-200 bg-white p-3">
                    <div className="text-xs font-semibold text-slate-500">
                      Codex 判讀結果
                    </div>
                    <InterpretationPreview
                      interpretation={selectedRequest.interpretation}
                    />
                  </div>
                </div>

                <WorkflowStatusDashboard
                  loading={state === "loading"}
                  launcherState={launcherState}
                  latestRun={latestRun}
                  openRun={openRun}
                  request={selectedRequest}
                  worker={selectedWorker}
                  onCancelRun={cancelCurrentAgentRun}
                />
                {stageGate ? (
                  <BlockerRecoveryPanel
                    latestRun={latestRun}
                    loading={state === "loading"}
                    note={recoveryNote}
                    openRun={openRun}
                    recoveryAttachments={recoveryAttachments}
                    runs={selectedRuns}
                    stageGate={stageGate}
                    worker={selectedWorker}
                    onChangeNote={setSelectedRecoveryNote}
                    onOpenQuickClarification={openQuickClarificationDialog}
                    onPasteAttachment={handleRecoveryNotePaste}
                    onRefreshWorker={() =>
                      refreshLocalWorkerCache({
                        retrySameAgent:
                          stageGate.recoveryKind !== "worker_offline",
                      })
                    }
                    onRemoveAttachment={removeRecoveryAttachment}
                    onSelectAttachmentFiles={handleRecoveryAttachmentFileChange}
                    onCancelRun={cancelCurrentAgentRun}
                    onRerunAgent={rerunAgent}
                    onStartNewRequest={startNewRequest}
                    onSync={() =>
                      selectedRequestId &&
                      void refreshSelectedRequest(selectedRequestId)
                    }
                    onSyncOutput={syncAgentOutput}
                    launcherHasProfile={launcherState.hasProfile}
                    workerRefreshing={workerRefreshState === "loading"}
                  />
                ) : null}
                {selectedRequest.deliveryMode === "draft_pr" &&
                selectedRequest.status === "pr_ready" &&
                !hasPrDiscoveryAccess ? (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-900">
                    補上 Azure PAT 後，App 才能驗證既有 Azure PR 並連結到此需求；不會自動 merge、abandon 或 deploy。
                  </div>
                ) : null}

                <details className="rounded-md border border-slate-200 bg-white">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-800">
                    技術 Log
                  </summary>
                  <div className="flex flex-col gap-3 border-t border-slate-200 p-3">
                    <RecoveryControls
                      canRetry={Boolean(nextAgent && !openRun)}
                      loading={state === "loading"}
                      onRetry={dispatchAgent}
                      onSync={() =>
                        selectedRequestId &&
                        void refreshSelectedRequest(selectedRequestId)
                      }
                    />
                    <AgentRuns runs={detail.runs} />
                  </div>
                </details>
                {selectedRequest.deliveryMode === "draft_pr" &&
                (selectedRequest.status === "pr_ready" ||
                  selectedRequest.status === "pr_created") ? (
                  <PullRequestTraceability
                    detail={detail}
                    discoveryMatches={prDiscoveryMatches}
                    discoveryMessage={prDiscoveryMessage}
                    discoveryState={prDiscoveryState}
                    form={prLinkForm}
                    hasAzurePat={hasPrDiscoveryAccess}
                    onChange={setPrLinkForm}
                    onCreateOrRefresh={createOrRefreshPullRequest}
                    onDiscover={() => discoverPullRequestLink()}
                    onStartAdjustment={startAdjustmentRequest}
                    onSubmit={recordPullRequestLink}
                  />
                ) : null}
              </div>
            )}
          </Panel>
        </section>
        ) : null}
      </div>
    </main>
  );
}

function QuickClarificationDialog({
  loading,
  open,
  prompt,
  onOpenChange,
  onSubmit,
}: {
  loading: boolean;
  open: boolean;
  prompt: ClarificationPrompt;
  onOpenChange: (open: boolean) => void;
  onSubmit: (clarification: string) => Promise<void>;
}) {
  const promptKey = prompt.questions
    .map((question) => `${question.id}:${question.options.map((option) => option.id).join(",")}`)
    .join("|");
  const defaultSelectedOptions = Object.fromEntries(
    prompt.questions.map((question) => [
      question.id,
      question.options[0]?.id ?? "",
    ]),
  );
  const [selectionState, setSelectionState] = useState<{
    promptKey: string;
    options: Record<string, string>;
  }>({ promptKey: "", options: {} });
  const selectedOptions =
    selectionState.promptKey === promptKey
      ? { ...defaultSelectedOptions, ...selectionState.options }
      : defaultSelectedOptions;

  const canSubmit = prompt.questions.every(
    (question) =>
      Boolean(selectedOptions[question.id]) &&
      question.options.some((option) => option.id === selectedOptions[question.id]),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{prompt.title}</DialogTitle>
          <DialogDescription>
            {prompt.summary || "選完後會把答案補回同一個 Agent，讓它繼續確認範圍。"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {prompt.questions.map((question) => (
            <div className="grid gap-2" key={question.id}>
              <div className="text-sm font-semibold text-slate-900">
                {question.question}
              </div>
              <div className="grid gap-2">
                {question.options.map((option) => {
                  const active = selectedOptions[question.id] === option.id;

                  return (
                    <button
                      className={`flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm ${
                        active
                          ? "border-blue-500 bg-blue-50 text-blue-950"
                          : "border-slate-200 bg-white text-slate-700 hover:border-blue-200"
                      }`}
                      key={option.id}
                      onClick={() =>
                        setSelectionState((current) => ({
                          promptKey,
                          options: {
                            ...(current.promptKey === promptKey
                              ? current.options
                              : {}),
                            [question.id]: option.id,
                          },
                        }))
                      }
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold">{option.label}</span>
                        {option.description ? (
                          <span className="mt-1 block text-xs leading-5 text-slate-500">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                      {active ? (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button
            disabled={loading}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            稍後處理
          </Button>
          <Button
            className="gap-2"
            disabled={!canSubmit || loading}
            onClick={() =>
              void onSubmit(buildQuickClarificationText(prompt, selectedOptions))
            }
            type="button"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            確認並續跑
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildQuickClarificationText(
  prompt: ClarificationPrompt,
  selectedOptions: Record<string, string>,
) {
  const lines = [
    "快速確認：",
    `主題：${prompt.title}`,
    prompt.summary ? `原因：${prompt.summary}` : "",
  ].filter(Boolean);

  for (const question of prompt.questions) {
    const option = question.options.find(
      (candidate) => candidate.id === selectedOptions[question.id],
    );
    if (!option) {
      continue;
    }

    lines.push(`- ${question.question}: ${option.label}`);
    if (option.description) {
      lines.push(`  ${option.description}`);
    }
    lines.push(`  ${option.clarification}`);
  }

  lines.push(
    "請 Agent1 使用以上補充重新確認來源、範圍與 Allowed Files；不要再要求使用者重複回答同一個問題。",
  );

  return lines.join("\n");
}

function WorkspaceTabs({
  activeTab,
  blockedCount,
  openCount,
  onChange,
}: {
  activeTab: WorkspaceTab;
  blockedCount: number;
  openCount: number;
  onChange: (tab: WorkspaceTab) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-2 sm:flex-row">
      <WorkspaceTabButton
        active={activeTab === "new"}
        label="新增需求"
        meta="建立新的 Request ID"
        onClick={() => onChange("new")}
      />
      <WorkspaceTabButton
        active={activeTab === "process"}
        label="處理需求"
        meta={`${openCount} 個進行中 / ${blockedCount} 個阻擋`}
        onClick={() => onChange("process")}
      />
    </div>
  );
}

function WorkspaceTabButton({
  active,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left ${
        active
          ? "border-blue-500 bg-blue-50 text-blue-950"
          : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-0.5 block truncate text-xs text-slate-500">
          {meta}
        </span>
      </span>
    </button>
  );
}

function StagedAttachmentList({
  attachments,
  onRemove,
  title = "圖片附件",
}: {
  attachments: StagedRequestAttachment[];
  onRemove: (attachmentId: string) => void;
  title?: string;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
        <ImageIcon className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {attachments.map((attachment) => (
          <div
            className="grid grid-cols-[64px_minmax(0,1fr)_32px] items-center gap-2 rounded-md border border-slate-200 bg-white p-2"
            key={attachment.id}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={attachment.filename}
              className="h-16 w-16 rounded object-cover"
              src={attachment.previewUrl}
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-800">
                {attachment.filename}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {attachment.contentType} / {formatBytes(attachment.sizeBytes)}
              </div>
            </div>
            <button
              aria-label={`移除 ${attachment.filename}`}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:border-red-200 hover:text-red-700"
              onClick={() => onRemove(attachment.id)}
              title="移除圖片"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RequestAttachmentGallery({
  attachments,
  requestId,
}: {
  attachments: RequestAttachment[];
  requestId: string;
}) {
  if (attachments.length === 0) {
    return null;
  }

  const intakeAttachments = attachments.filter(
    (attachment) => attachment.purpose === "intake",
  );
  const clarificationAttachments = attachments.filter(
    (attachment) => attachment.purpose === "clarification",
  );

  return (
    <div className="mt-4 space-y-3 rounded-md border border-slate-200 bg-white p-3">
      <AttachmentGallerySection
        attachments={intakeAttachments}
        requestId={requestId}
        title="需求建立附件"
      />
      <AttachmentGallerySection
        attachments={clarificationAttachments}
        requestId={requestId}
        title="人工補件附件"
      />
    </div>
  );
}

function AttachmentGallerySection({
  attachments,
  requestId,
  title,
}: {
  attachments: RequestAttachment[];
  requestId: string;
  title: string;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        <ImageIcon className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {attachments.map((attachment) => (
          <a
            className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 rounded-md border border-slate-200 p-2 hover:border-blue-300"
            href={`/api/requests/${requestId}/attachments/${attachment.attachmentId}`}
            key={attachment.attachmentId}
            rel="noreferrer"
            target="_blank"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={attachment.filename}
              className="h-18 w-18 rounded object-cover"
              src={`/api/requests/${requestId}/attachments/${attachment.attachmentId}`}
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-800">
                {attachment.filename}
              </div>
              <div className="mt-1 break-all text-xs text-slate-500">
                {attachment.contentType} / {formatBytes(attachment.sizeBytes)}
              </div>
              {attachment.recoveryOfRunId ? (
                <div className="mt-1 break-all font-mono text-[11px] text-slate-400">
                  Run {attachment.recoveryOfRunId.slice(0, 8)}
                </div>
              ) : null}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function CollapsibleRequestDetail({ detail }: { detail: string }) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = detail.length > 700 || detail.split("\n").length > 8;
  const displayText =
    shouldCollapse && !expanded ? `${detail.slice(0, 700).trimEnd()}...` : detail;

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-500">需求內容</div>
        {shouldCollapse ? (
          <button
            className="text-xs font-semibold text-blue-700 hover:text-blue-900"
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {expanded ? "收合" : "展開全文"}
          </button>
        ) : null}
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
        {displayText}
      </p>
    </div>
  );
}

function ConnectionStatusEntry({
  activeRequest,
  canUseWorkflow,
  connectionInfo,
  openRun,
  realtimeStatus,
  repoName,
  worker,
  onOpenSettings,
}: {
  activeRequest: WorkflowRequest | null;
  canUseWorkflow: boolean;
  connectionInfo: WorkerConnectionInfo;
  openRun: WorkerRunView | null;
  realtimeStatus: RealtimeConnectionStatus;
  repoName: string;
  worker: WorkerRegistration | null;
  onOpenSettings: () => void;
}) {
  const statusText = canUseWorkflow
    ? "連線中"
    : connectionInfo.ready
      ? "尚未選擇本機專案"
      : connectionInfo.label;
  const workerIsFresh = Boolean(
    worker?.lastSeenAt && !isStaleTimestamp(worker.lastSeenAt),
  );
  const connectionTone: ConnectionPulseTone =
    canUseWorkflow && workerIsFresh && realtimeStatus === "connected"
      ? "green"
      : realtimeStatus === "connecting" ||
          realtimeStatus === "reconnecting" ||
          realtimeStatus === "fallback"
        ? "amber"
        : "red";
  const dotClass = getConnectionDotClass(connectionTone);
  const detailText = canUseWorkflow
    ? "背景會透過 worker 心跳持續更新狀態。"
    : connectionInfo.ready
      ? "請先選擇本機專案後再建立需求。"
      : connectionInfo.detail;
  const actionLabel =
    canUseWorkflow || connectionInfo.ready ? "設定" : "重新連線";
  const actionTitle = canUseWorkflow
    ? "連線中"
    : connectionInfo.ready
      ? "尚未選擇本機專案"
      : "連線未就緒，請重新連線";
  const progressTitle = getConnectionProgressTitle(activeRequest, openRun);
  const realtimeText = formatRealtimeStatus(realtimeStatus);
  const triggerText = canUseWorkflow
    ? `${worker?.workerId ?? "未連線"} / ${repoName} / ${statusText}`
    : statusText;
  const showDiagnostics = !canUseWorkflow || realtimeStatus !== "connected";
  const diagnosticText =
    canUseWorkflow && realtimeStatus !== "connected"
      ? "即時通道暫時不穩，App 會降低刷新頻率並維持背景同步。"
      : detailText;
  const [open, setOpen] = useState(false);

  function openSettings() {
    setOpen(false);
    onOpenSettings();
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label={`開啟連線設定，${triggerText}`}
          className="h-10 max-w-[calc(100vw-6rem)] gap-2 bg-background/95 px-3 shadow-sm"
          title={triggerText}
          type="button"
          variant="outline"
        >
          <ConnectionPulseDot className={dotClass} tone={connectionTone} />
          <span className="min-w-0 truncate text-sm font-semibold">
            {triggerText}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[calc(100vw-1.5rem)] max-w-80 p-3"
        sideOffset={8}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-500">本機專案</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-950">
              {repoName}
            </div>
            <div className="mt-1 truncate text-xs text-slate-500">
              {progressTitle}
            </div>
          </div>
          <Button
            className="shrink-0"
            onClick={openSettings}
            size="sm"
            type="button"
            variant="outline"
          >
            {actionLabel}
          </Button>
        </div>
        {showDiagnostics ? (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <ConnectionPulseDot
                className={`${dotClass} shrink-0`}
                tone={connectionTone}
              />
              <span className="min-w-0 truncate">{statusText}</span>
            </div>
            <p className="mt-2 break-words text-xs leading-5 text-slate-600">
              {diagnosticText}
            </p>
            {realtimeStatus !== "connected" ? (
              <div className="mt-2 text-xs font-semibold text-slate-500">
                即時通道：{realtimeText}
              </div>
            ) : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function ConnectionPulseDot({
  className,
  tone,
}: {
  className: string;
  tone: ConnectionPulseTone;
}) {
  return (
    <span
      className={`connection-pulse inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${className}`}
    />
  );
}

function getConnectionDotClass(tone: ConnectionPulseTone) {
  if (tone === "green") {
    return "bg-emerald-400 text-emerald-400 ring-4 ring-emerald-100";
  }

  if (tone === "amber") {
    return "bg-amber-400 text-amber-400 ring-4 ring-amber-100";
  }

  return "bg-red-500 text-red-500 ring-4 ring-red-100";
}

function getConnectionProgressTitle(
  request: WorkflowRequest | null,
  openRun: WorkerRunView | null,
) {
  if (openRun) {
    return `${formatUiAgentRole(openRun.agentRole)} / ${formatWorkerRunStatus(openRun.status)}`;
  }

  if (request) {
    return formatUiWorkflowStage(request.status);
  }

  return "等待新需求";
}

function formatRealtimeStatus(status: RealtimeConnectionStatus) {
  const labels: Record<RealtimeConnectionStatus, string> = {
    connecting: "正在連線",
    connected: "即時同步中",
    reconnecting: "重新連線中",
    disconnected: "已中斷",
    fallback: "改用背景同步",
  };

  return labels[status];
}

function SetupDialog({
  canClose,
  children,
  open,
  onClose,
}: {
  canClose: boolean;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6">
      <section
        aria-labelledby="setup-dialog-title"
        aria-modal="true"
        className="w-full max-w-4xl rounded-md border border-slate-200 bg-white p-4 shadow-2xl"
        role="dialog"
      >
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
              <ServerCog className="h-4 w-4" />
              本機 Codex worker
            </div>
            <h2
              className="mt-1 text-xl font-semibold text-slate-950"
              id="setup-dialog-title"
            >
              連線設定
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              完成本機 worker 連線、Codex 檢查與專案選擇後，此視窗會自動關閉。
            </p>
          </div>
          {canClose ? (
            <button
              aria-label="關閉設定"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700"
              onClick={onClose}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {children}
      </section>
    </div>
  );
}

function RecoveryControls({
  canRetry,
  loading,
  onRetry,
  onSync,
}: {
  canRetry: boolean;
  loading: boolean;
  onRetry: () => void;
  onSync: () => void;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold text-slate-600">進階復原</div>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        正常流程會自動更新與派工；下列操作只用於狀態疑似不同步或自動派工未接上的情況。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
          onClick={onSync}
          type="button"
        >
          <RefreshCw className="h-4 w-4" />
          重新同步狀態
        </button>
        {canRetry ? (
          <button
            className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            disabled={loading}
            onClick={onRetry}
            type="button"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            重試派發下一個 Agent
          </button>
        ) : null}
      </div>
    </div>
  );
}

function BlockerRecoveryPanel({
  latestRun,
  loading,
  note,
  openRun,
  recoveryAttachments,
  runs,
  stageGate,
  worker,
  launcherHasProfile,
  onChangeNote,
  onOpenQuickClarification,
  onPasteAttachment,
  onRefreshWorker,
  onRemoveAttachment,
  onSelectAttachmentFiles,
  onCancelRun,
  onRerunAgent,
  onStartNewRequest,
  onSync,
  onSyncOutput,
  workerRefreshing,
}: {
  latestRun: WorkerRunView | null;
  loading: boolean;
  note: string;
  openRun: WorkerRunView | null;
  recoveryAttachments: StagedRequestAttachment[];
  runs: WorkerRunView[];
  stageGate: StageGateResult;
  worker: WorkerRegistration | null;
  onChangeNote: (value: string) => void;
  onOpenQuickClarification: () => void;
  onPasteAttachment: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onRefreshWorker: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSelectAttachmentFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  onCancelRun: () => void;
  onRerunAgent: () => void;
  onStartNewRequest: () => void;
  onSync: () => void;
  onSyncOutput: () => void;
  launcherHasProfile: boolean;
  workerRefreshing: boolean;
}) {
  if (!shouldShowBlockerRecoveryPanel(stageGate)) {
    return null;
  }

  const blockedRun =
    runs.find((run) => run.runId === stageGate.blockedRunId) ??
    (stageGate.recoveryKind === "stale_run" ||
    stageGate.recoveryKind === "worker_offline"
      ? openRun
      : null) ??
    latestRun;
  const hasOpenRun = Boolean(openRun);
  const canRecoverStaleRun =
    stageGate.recoveryKind === "stale_run" &&
    Boolean(stageGate.blockedRunId) &&
    openRun?.runId === stageGate.blockedRunId;
  const canManualRetry =
    Boolean(stageGate.blockedRunId) &&
    (canRecoverStaleRun || (stageGate.canManualRetry && !hasOpenRun));
  const canClarifyAndRetry =
    stageGate.needsClarification &&
    Boolean(stageGate.blockedRunId) &&
    !hasOpenRun;
  const canRerunAgent = canManualRetry || canClarifyAndRetry;
  const canSyncOutput =
    stageGate.recoveryKind === "handoff_schema" &&
    Boolean(stageGate.blockedRunId) &&
    !hasOpenRun;
  const workerStale = Boolean(
    worker?.lastSeenAt && isStaleTimestamp(worker.lastSeenAt),
  );
  const workerInternalError = stageGate.recoveryKind === "worker_internal_error";
  const workerOffline = stageGate.recoveryKind === "worker_offline";
  const workerVersionMismatch =
    stageGate.recoveryKind === "worker_version_mismatch" ||
    stageGate.recoveryKind === "worker_runtime_error";
  const prBranchOutdated = stageGate.recoveryKind === "pr_branch_outdated";
  const showDiagnostics =
    prBranchOutdated ||
    stageGate.recoveryKind === "stale_run" ||
    stageGate.recoveryKind === "handoff_schema" ||
    workerOffline ||
    workerInternalError ||
    workerVersionMismatch;
  const blockedAgent = stageGate.blockedAgentRole
    ? formatUiAgentRole(stageGate.blockedAgentRole)
    : blockedRun
      ? formatUiAgentRole(blockedRun.agentRole)
      : "未判定";
  const blockedRunMissingOutput = Boolean(
    blockedRun &&
      !blockedRun.commandOutput.trim() &&
      !blockedRun.artifact.trim() &&
      !blockedRun.error.trim(),
  );

  return (
    <section
      className="rounded-md border border-amber-200 bg-white p-4"
      id="blocker-recovery-panel"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>阻擋處理台</span>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {formatRecoveryPanelSummary(stageGate)}
          </p>
        </div>
        <Button
          className="w-full shrink-0 gap-2 sm:w-auto"
          onClick={onSync}
          type="button"
          variant="outline"
        >
          <RefreshCw className="h-4 w-4" />
          同步狀態
        </Button>
      </div>

      <BlockerSummaryList items={stageGate.blockers} />

      {showDiagnostics ? (
        <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold text-slate-700">
            診斷詳情
          </summary>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <MiniBadge label="卡住 Agent" value={blockedAgent} />
            <MiniBadge
              label="最後 run"
              value={
                blockedRun
                  ? `${formatWorkerRunStatus(blockedRun.status)} / ${blockedRun.runId.slice(0, 8)}`
                  : "未判定"
              }
            />
            <MiniBadge
              label="Worker 心跳"
              value={`${formatTimestamp(worker?.lastSeenAt)}${workerStale ? " / stale" : ""}`}
            />
            <MiniBadge
              label="下一步"
              value={formatRecoveryNextStep(stageGate)}
            />
          </div>
          {stageGate.recoveryKind === "stale_run" && blockedRun ? (
            <div className="mt-3 grid gap-2 md:grid-cols-4">
              <MiniBadge
                label="Run 更新"
                value={formatTimestamp(blockedRun.updatedAt)}
              />
              <MiniBadge
                label="進度更新"
                value={formatTimestamp(blockedRun.progressUpdatedAt)}
              />
              <MiniBadge
                label="輸出"
                value={blockedRun.commandOutput.trim() ? "有" : "無"}
              />
              <MiniBadge
                label="Artifact/Error"
                value={
                  blockedRun.artifact.trim() || blockedRun.error.trim()
                    ? "有"
                    : "無"
                }
              />
            </div>
          ) : null}
        </details>
      ) : null}

      {workerOffline && launcherHasProfile ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-900">
          <div className="font-semibold">Worker 已停止，Agent 尚未開始</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>目前 run 還在 queued。</li>
            <li>重啟 Worker 後會接續同一筆 run。</li>
            <li>不需要重新輸入需求。</li>
          </ul>
          <Button
            className="mt-3 gap-2"
            disabled={loading || workerRefreshing}
            onClick={onRefreshWorker}
            type="button"
            variant="outline"
          >
            {workerRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            重啟 Worker
          </Button>
        </div>
      ) : null}

      {workerVersionMismatch && launcherHasProfile ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-900">
          <div className="font-semibold">Worker 版本不同步</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Worker 腳本需要重新下載。</li>
            <li>更新後會重跑同一個 Agent。</li>
            <li>不需要重新輸入需求。</li>
          </ul>
          <Button
            className="mt-3 gap-2"
            disabled={loading || workerRefreshing}
            onClick={onRefreshWorker}
            type="button"
            variant="outline"
          >
            {workerRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            更新並重啟 Worker
          </Button>
        </div>
      ) : null}

      {workerInternalError && launcherHasProfile ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-900">
          <div className="font-semibold">Worker 內部錯誤</div>
          <p className="mt-1">
            錯誤發生在本機 Worker 自己的執行或收尾邏輯。先更新/重啟
            Worker，之後重跑 Agent；如果仍出現同一錯誤，表示 App
            提供的 worker bundle 需要修復。
          </p>
          <Button
            className="mt-3 gap-2"
            disabled={loading || workerRefreshing}
            onClick={onRefreshWorker}
            type="button"
            variant="outline"
          >
            {workerRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            更新並重啟 Worker
          </Button>
        </div>
      ) : null}

      {stageGate.clarificationPrompt ? (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-900 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Agent1 已列出可選項，選完後會重跑 Agent 繼續確認範圍。
          </span>
          <Button
            className="w-full shrink-0 gap-2 sm:w-auto"
            disabled={!canClarifyAndRetry || loading}
            onClick={onOpenQuickClarification}
            type="button"
            variant="outline"
          >
            <Check className="h-4 w-4" />
            快速選擇
          </Button>
        </div>
      ) : null}

      {stageGate.recoveryKind === "stale_run" ? (
        <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-900">
          <div className="font-semibold">Agent run 已停滯</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>資料庫仍標示 running，但進度心跳已超過門檻。</li>
            <li>
              {blockedRunMissingOutput
                ? "目前沒有 command output、artifact 或 error 回寫。"
                : "目前已有部分輸出或錯誤，可先同步狀態確認。"}
            </li>
            <li>這不代表多個 codex.exe 都在跑同一個 Agent。</li>
            <li>codex.exe app-server / Desktop 子程序屬於正常背景服務。</li>
            <li>真正的 Agent 任務子程序會是 codex exec ...。</li>
            {blockedRunMissingOutput ? (
              <li>目前沒有明確 exec activity，只能判定 run 回報停滯。</li>
            ) : null}
            <li>先同步狀態；若仍無新進度，可重跑同一個 Agent。</li>
          </ul>
        </div>
      ) : null}

      {stageGate.recoveryKind === "handoff_schema" ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
          {stageGate.canAutoRepair
            ? "Handoff 欄位缺失，server 會自動修復一次。"
            : "請重跑 Agent。"}
        </p>
      ) : null}

      {stageGate.needsClarification ? (
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">
              補充內容
            </span>
            <textarea
              className="min-h-24 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-blue-500"
              onChange={(event) => onChangeNote(event.target.value)}
              onPaste={onPasteAttachment}
              placeholder="需要補充時可輸入文字或貼上截圖；直接重跑也可以。"
              value={note}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:border-blue-300">
              <Upload className="h-4 w-4" />
              加入截圖
              <input
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                multiple
                onChange={onSelectAttachmentFiles}
                type="file"
              />
            </label>
          </div>
          <StagedAttachmentList
            attachments={recoveryAttachments}
            onRemove={onRemoveAttachment}
            title="補充截圖"
          />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {canSyncOutput ? (
          <Button
            className="gap-2"
            disabled={loading}
            onClick={onSyncOutput}
            type="button"
            variant="outline"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            重新同步 Agent 輸出
          </Button>
        ) : null}
        {canRerunAgent ? (
          <Button
            className="gap-2"
            disabled={loading}
            onClick={onRerunAgent}
            type="button"
            variant="outline"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            重跑 Agent
          </Button>
        ) : null}
        {openRun ? (
          <Button
            className="gap-2"
            disabled={loading}
            onClick={onCancelRun}
            type="button"
            variant="outline"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
            停止目前 Agent
          </Button>
        ) : null}
        <Button
          className="gap-2"
          disabled={loading}
          onClick={onStartNewRequest}
          type="button"
          variant="outline"
        >
          <Plus className="h-4 w-4" />
          另開新需求
        </Button>
      </div>
    </section>
  );
}

function ToastHost({
  state,
  message,
  onDone,
}: {
  state: LoadState;
  message: string;
  onDone: () => void;
}) {
  if (!message) {
    return null;
  }

  const isError = state === "error";
  const isLoading = state === "loading";
  return (
    <div
      aria-live={isError ? "assertive" : "polite"}
      className={`fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg ${
        isError
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-slate-200 bg-white text-slate-700"
      } ${isLoading ? "" : "toast-fade"}`}
      onAnimationEnd={() => {
        if (!isLoading) {
          onDone();
        }
      }}
      role="status"
    >
      {isLoading ? (
        <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-blue-700" />
      ) : isError ? (
        <AlertTriangle className="mt-0.5 h-4 w-4" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-700" />
      )}
      {message}
    </div>
  );
}

function formatRequestDisplayTitle(request: WorkflowRequest) {
  const title = request.title.trim();
  if (!title || isEnglishPlaceholderTitle(title)) {
    return "未命名需求";
  }

  return title;
}

function isEnglishPlaceholderTitle(title: string) {
  return title.trim().toLowerCase() === "short human-readable title";
}

function formatInterpretationSummary(summary: string) {
  const trimmed = summary.trim();
  if (!trimmed || isEnglishPlaceholderSummary(trimmed)) {
    return "需求摘要待本機 Codex 重新判讀，請以需求內容與來源確認為準。";
  }

  return trimmed;
}

function isEnglishPlaceholderSummary(summary: string) {
  return (
    summary.trim().toLowerCase() ===
    "classification summary; do not claim sources are confirmed"
  );
}

function SetupStep({
  children,
  headerContent,
  step,
  title,
}: {
  children: ReactNode;
  detail?: string;
  headerContent?: ReactNode;
  step: string;
  title: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-700 text-sm font-semibold text-white">
          {step}
        </div>
        <div className="min-w-0 flex-1">
          {headerContent ? (
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <div className="shrink-0 text-sm font-semibold text-slate-950">
                {title}
              </div>
              <div className="min-w-0 flex-1">{headerContent}</div>
            </div>
          ) : (
            <div className="text-sm font-semibold text-slate-950">{title}</div>
          )}
          {children ? <div className="mt-3">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}

function Panel({
  className = "",
  icon,
  title,
  subtitle,
  children,
}: {
  className?: string;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`min-w-0 rounded-md border border-slate-200 bg-white p-4 shadow-sm ${className}`}
    >
      <div className="mb-4 flex min-w-0 items-start gap-2">
        <div className="mt-0.5 text-blue-700">{icon}</div>
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold text-slate-950">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 break-words text-sm text-slate-600">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  className = "",
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  type?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <input
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-100"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
}

function PatPersistenceStatus({
  activeRun,
  clearing,
  hasSavedPat,
  onClear,
}: {
  activeRun: boolean;
  clearing: boolean;
  hasSavedPat: boolean;
  onClear: () => void;
}) {
  if (!hasSavedPat) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
        <div className="min-w-0">
          <div className="font-semibold">本機 Launcher 已保存 PAT</div>
          {activeRun ? (
            <div className="mt-1 text-xs leading-5 text-emerald-800">
              Agent 執行中，完成後可清除 PAT。
            </div>
          ) : null}
        </div>
      </div>
      <button
        className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-900 disabled:cursor-not-allowed disabled:bg-emerald-100 disabled:text-emerald-500"
        disabled={activeRun || clearing}
        onClick={onClear}
        type="button"
      >
        {clearing ? <Spinner className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        清除 PAT
      </button>
    </div>
  );
}

function SelectField({
  disabled,
  label,
  value,
  onChange,
  onOpenChange,
  options,
  placeholder,
}: {
  disabled?: boolean;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  options: Array<{ label: string; value: string }>;
  placeholder?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <Select
        disabled={disabled}
        value={value}
        onOpenChange={onOpenChange}
        onValueChange={onChange}
      >
        <SelectTrigger
          aria-label={label}
          className="w-full min-w-0 max-w-full truncate rounded-md border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:ring-blue-500/20 disabled:bg-slate-100"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent
          className="z-[60] max-h-64 min-w-[var(--radix-select-trigger-width)] max-w-[min(32rem,calc(100vw-2rem))]"
          position="popper"
        >
          {options.length === 0 ? (
            <SelectItem disabled value={REPOSITORY_PLACEHOLDER_VALUE}>
              {placeholder ?? "沒有可選項目"}
            </SelectItem>
          ) : (
            options.map((option) => (
              <SelectItem
                className="w-full max-w-full [&>span:last-child]:min-w-0 [&>span:last-child]:truncate"
                key={option.value}
                value={option.value}
              >
                {option.label}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

function HoverTip({ children }: { children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      <HelpCircle
        aria-label="PAT 說明"
        className="h-4 w-4 cursor-help text-slate-500"
      />
      <span className="pointer-events-none absolute left-1/2 top-6 z-20 hidden w-80 -translate-x-1/2 rounded-md border border-slate-200 bg-white p-3 text-xs font-normal leading-5 text-slate-700 shadow-lg group-hover:block">
        {children}
      </span>
    </span>
  );
}

function LauncherInstallTip() {
  return (
    <span className="group relative inline-flex shrink-0">
      <AlertTriangle
        aria-label="首次啟動提示"
        className="h-4 w-4 cursor-help text-amber-600"
      />
      <span className="pointer-events-none absolute right-0 top-6 z-20 hidden w-80 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs font-normal leading-5 text-amber-900 shadow-lg group-hover:block">
        首次啟動 worker 需自行開啟 PowerShell / terminal，貼上並執行安裝指令。瀏覽器無法直接開啟本機終端機；安裝完成後，App 會透過本機 Launcher 背景啟動 worker。
      </span>
    </span>
  );
}

function WorkerConnectionStatus({
  connectionInfo,
  onSetup,
  settingUp,
}: {
  connectionInfo: WorkerConnectionInfo;
  onSetup: () => void;
  settingUp: boolean;
}) {
  const showCodexHelp =
    !connectionInfo.ready &&
    (connectionInfo.diagnosticCode === "cli-missing" ||
      connectionInfo.diagnosticCode === "desktop-internal-not-cli" ||
      connectionInfo.diagnosticCode === "cli-command-failed" ||
      connectionInfo.diagnosticCode === "missing-command");

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs font-semibold text-slate-600">本機 Codex</div>
      <div className="mt-1 text-sm font-semibold text-slate-950">
        {connectionInfo.label}
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-600">
        {connectionInfo.detail}
      </p>
      {showCodexHelp ? (
        <div className="mt-3 rounded-md border border-orange-200 bg-orange-50 p-3 text-xs leading-5 text-orange-900">
          <button
            className="inline-flex items-center justify-center gap-2 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            disabled={settingUp}
            onClick={onSetup}
            type="button"
          >
            {settingUp ? <Spinner className="h-3.5 w-3.5" /> : null}
            安裝
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RepositoryPicker({
  candidates,
  loading,
  value,
  onChange,
  onRefresh,
  className = "",
}: {
  candidates: RepositoryCandidate[];
  loading: boolean;
  value: string;
  onChange: (value: string) => void;
  onRefresh: () => void;
  className?: string;
}) {
  const placeholder =
    candidates.length === 0 ? "等待本機專案回報" : "請選擇專案";
  const options = candidates.some(
    (candidate) => normalizeRepositoryPath(candidate.path) === normalizeRepositoryPath(value),
  )
    ? candidates
    : [
        ...(value
          ? [{ name: getPathLeaf(value), path: value, source: "selected" }]
          : []),
        ...candidates,
      ];

  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className}`}>
      <SelectField
        label="選擇本機專案"
        value={value}
        onChange={onChange}
        onOpenChange={(open) => {
          if (open) {
            void onRefresh();
          }
        }}
        options={options.map((candidate) => ({
          label: candidate.name,
          value: candidate.path,
        }))}
        placeholder={placeholder}
      />
      <div className="min-h-5 text-xs leading-5 text-slate-500">
        {loading ? (
          <span className="inline-flex items-center gap-1.5 text-blue-700">
            <Spinner className="h-3.5 w-3.5" />
            更新中
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CompactSelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
}) {
  const selected = options.find((option) => option.value === value);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className="h-9 w-auto min-w-[10rem] rounded-md border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:ring-blue-500/20"
      >
        <span className="truncate text-xs font-semibold text-slate-500">
          {label}：
        </span>
        <SelectValue>{selected?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent
        className="z-[60] max-w-[min(24rem,calc(100vw-2rem))]"
        position="popper"
      >
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CompactChoiceControl({
  label,
  value,
  options,
  onChange,
  placeholder = "請選擇",
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          className="h-9 w-fit max-w-full shrink gap-2 px-3"
          type="button"
          variant="outline"
        >
          <span className="shrink-0 text-xs text-slate-500">{label}：</span>
          <span className="min-w-0 truncate">
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-1"
        sideOffset={6}
      >
        {options.map((option) => {
          const active = option.value === value;

          return (
            <button
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                active
                  ? "bg-blue-50 font-semibold text-blue-900"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              type="button"
            >
              {option.label}
              {active ? <Check className="h-4 w-4" /> : null}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function AzureNumberIntake({
  enabled,
  hasPat,
  iterationLoading,
  iterationState,
  loading,
  candidates,
  filterOptions,
  filters,
  iterations,
  pickerOpen,
  selectedItem,
  selectedIteration,
  truncated,
  value,
  onChange,
  onFilterChange,
  onLoadIterations,
  onPickerOpenChange,
  onRefresh,
}: {
  enabled: boolean;
  hasPat: boolean;
  iterationLoading: boolean;
  iterationState: LoadState;
  loading: boolean;
  candidates: WorkItemCandidate[];
  filterOptions: WorkItemFilterOptions;
  filters: WorkItemFilterState;
  iterations: WorkItemIterationOption[];
  pickerOpen: boolean;
  selectedItem: WorkItemCandidate | null;
  selectedIteration: WorkItemIterationOption | null;
  truncated: boolean;
  value: string;
  onChange: (value: string) => void;
  onFilterChange: (filters: Partial<WorkItemFilterState>) => void;
  onLoadIterations: () => void;
  onPickerOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}) {
  if (!enabled) {
    return null;
  }

  if (!hasPat) {
    return (
      <p className="text-sm leading-6 text-slate-600">
        提供 PAT 後可選擇 Azure 單號，協助後續準備正式分支並追蹤 PR。
      </p>
    );
  }

  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(220px,1.4fr)_repeat(3,minmax(150px,1fr))_auto] lg:items-end">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">Sprint</span>
          <Popover open={pickerOpen} onOpenChange={onPickerOpenChange}>
            <PopoverTrigger asChild>
              <Button
                className="w-full justify-between"
                disabled={iterationLoading}
                type="button"
                variant="outline"
              >
                <span className="min-w-0 truncate text-left">
                  {selectedIteration
                    ? formatIterationOptionLabel(selectedIteration)
                    : iterationLoading
                      ? "讀取 Sprint..."
                      : "選擇 Sprint"}
                </span>
                <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(520px,90vw)] p-0">
              <Command>
                <CommandInput placeholder="搜尋 Sprint / Iteration..." />
                <CommandList>
                  <CommandEmpty>找不到 Sprint。</CommandEmpty>
                  <CommandGroup heading="Sprint / Iteration">
                    <CommandItem
                      data-checked={!filters.iterationPath}
                      onSelect={() => {
                        onPickerOpenChange(false);
                        onFilterChange({
                          ...DEFAULT_WORK_ITEM_FILTERS,
                        });
                      }}
                      value="all-sprints"
                    >
                      不指定 Sprint
                    </CommandItem>
                    {iterations.map((iteration) => (
                      <CommandItem
                        data-checked={iteration.path === filters.iterationPath}
                        key={iteration.id}
                        onSelect={() => {
                          onPickerOpenChange(false);
                          onFilterChange({
                            ...DEFAULT_WORK_ITEM_FILTERS,
                            iterationPath: iteration.path,
                          });
                        }}
                        style={{
                          paddingLeft: `${0.5 + iteration.depth * 0.75}rem`,
                        }}
                        value={`${iteration.path} ${iteration.name}`}
                      >
                        <span className="min-w-0 truncate">
                          {formatIterationOptionLabel(iteration)}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </label>

        <WorkItemSelectFilter
          label="狀態"
          options={filterOptions.states}
          value={filters.state}
          onChange={(state) => onFilterChange({ state })}
        />
        <WorkItemSelectFilter
          label="類型"
          options={filterOptions.types}
          value={filters.type}
          onChange={(type) => onFilterChange({ type })}
        />
        <WorkItemSelectFilter
          label="指派者"
          options={filterOptions.assignees}
          value={filters.assignedTo}
          onChange={(assignedTo) => onFilterChange({ assignedTo })}
        />

        <Button
          className="min-w-0"
          disabled={iterationLoading || loading}
          onClick={() => {
            if (iterations.length === 0) {
              onLoadIterations();
            } else {
              onRefresh();
            }
          }}
          type="button"
          variant="outline"
        >
          {iterationLoading || loading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          更新
        </Button>
      </div>

      {iterationState === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>
            Sprint 清單讀取失敗。請確認 PAT 有 Work Items Read 權限後再更新。
          </AlertDescription>
        </Alert>
      ) : null}

      {iterationState === "idle" && iterations.length === 0 ? (
        <Alert>
          <AlertDescription>
            載入 Sprint 清單後，可依 Sprint、狀態、類型與指派者篩選 Azure 單號。
          </AlertDescription>
        </Alert>
      ) : null}

      {truncated ? (
        <Alert>
          <AlertDescription>
            Azure 回傳結果已達 {WORK_ITEM_QUERY_TOP} 筆上限；請縮小 Sprint 或篩選條件。
          </AlertDescription>
        </Alert>
      ) : null}

      {selectedItem && isUserStoryCandidate(selectedItem) ? (
        <div className="rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-sm leading-6 text-amber-950">
          User Story 只作需求來源參考，請改選 Bug / Feature / Task 等開發單號。
        </div>
      ) : selectedItem ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
          已讀取 Azure 單號內容：{formatAzureNumberLabel(selectedItem)}。此單號會用於
          PR 分支與 Azure 追蹤，不需要在需求內容重複填寫。
        </div>
      ) : null}

      {value && !selectedItem ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
          目前選到 Azure 單號 #{value}，但清單未讀到內容。送出時會標為
          tracking reference only，不會當成已驗證來源。
        </div>
      ) : null}

      {!value ? (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-600">
          建立正式 PR 前需要選擇並驗證 Azure 單號；需求內容只需要描述要做什麼與預期結果。
        </div>
      ) : null}

      <WorkItemCandidateTable
        candidates={candidates}
        loading={loading}
        selectedId={value}
        selectedIteration={selectedIteration}
        onSelect={onChange}
      />
    </div>
  );
}

function WorkItemSelectFilter({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <Select
        value={value || SELECT_ALL_VALUE}
        onValueChange={(nextValue) =>
          onChange(nextValue === SELECT_ALL_VALUE ? "" : nextValue)
        }
      >
        <SelectTrigger className="w-full bg-white">
          <SelectValue placeholder={`全部${label}`} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SELECT_ALL_VALUE}>全部{label}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function WorkItemCandidateTable({
  candidates,
  loading,
  selectedId,
  selectedIteration,
  onSelect,
}: {
  candidates: WorkItemCandidate[];
  loading: boolean;
  selectedId: string;
  selectedIteration: WorkItemIterationOption | null;
  onSelect: (value: string) => void;
}) {
  if (loading) {
    return (
      <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    );
  }

  if (!selectedIteration && candidates.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-sm text-slate-500">
        選擇 Sprint 或按更新查全專案。
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-sm text-slate-500">
        這組篩選條件沒有回傳 Azure 單號。
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-80 rounded-md border border-slate-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">單號</TableHead>
            <TableHead>標題</TableHead>
            <TableHead className="w-28">狀態</TableHead>
            <TableHead className="w-28">類型</TableHead>
            <TableHead className="w-40">指派者</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((item) => {
            const selected = item.id === selectedId;
            const isUserStory = isUserStoryCandidate(item);
            return (
              <TableRow
                aria-disabled={isUserStory || undefined}
                aria-selected={selected}
                className={
                  isUserStory
                    ? "cursor-not-allowed bg-amber-100 text-amber-950 hover:bg-amber-100"
                    : "cursor-pointer"
                }
                data-state={selected ? "selected" : undefined}
                key={item.id}
                onClick={() => {
                  if (!isUserStory) {
                    onSelect(selected ? "" : item.id);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (!isUserStory) {
                      onSelect(selected ? "" : item.id);
                    }
                  }
                }}
                tabIndex={isUserStory ? undefined : 0}
              >
                <TableCell className="font-mono text-xs">
                  <span className="inline-flex items-center gap-1">
                    {selected ? <Check className="h-3.5 w-3.5" /> : null}
                    #{item.id}
                  </span>
                </TableCell>
                <TableCell className="min-w-64 max-w-[420px]">
                  <div className="truncate font-medium text-slate-950">
                    {item.title || "未命名 Work Item"}
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">
                    {item.iterationPath || selectedIteration?.path || "全專案"}
                  </div>
                  {isUserStory ? (
                    <div className="mt-1 text-xs font-medium text-amber-900">
                      User Story 只作需求來源參考，請選 Bug / Feature / Task 等開發單號。
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{item.state || "未設定"}</Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    className={
                      isUserStory
                        ? "border-amber-500 bg-amber-200 text-amber-950"
                        : undefined
                    }
                    variant="outline"
                  >
                    {item.type || "Azure"}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-40 truncate text-sm text-slate-600">
                  {item.assignedTo || "未指派"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <Loader2
      aria-label="載入中"
      className={`animate-spin ${className}`}
      role="status"
    />
  );
}

function StageBadge({
  className = "",
  stage,
}: {
  className?: string;
  stage: WorkflowRequest["status"];
}) {
  const isBlocked = stage === "blocked";
  const isReady = stage === "pr_ready" || stage === "delivered";

  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${className} ${
        isBlocked
          ? "bg-red-100 text-red-800"
          : isReady
            ? "bg-green-100 text-green-800"
            : "bg-slate-100 text-slate-700"
      }`}
    >
      {formatUiWorkflowStage(stage)}
    </span>
  );
}

function InterpretationPreview({
  interpretation,
}: {
  interpretation: RequestInterpretation;
}) {
  return (
    <div className="mt-2 flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <MiniBadge
          label="來源"
          value={
            interpretation.source === "worker" ? "本機 Codex" : "暫時判讀"
          }
        />
        <MiniBadge label="類型" value={interpretation.kind} />
        <MiniBadge label="等級" value={interpretation.taskLevel} />
        <MiniBadge
          label="下一步"
          value={formatPublicNextStep(interpretation.suggestedNextAgent)}
        />
      </div>
      <p className="text-sm text-slate-700">
        {formatInterpretationSummary(interpretation.summary)}
      </p>
      <InlineList
        title="需要確認的來源"
        items={interpretation.missingSources}
      />
      {interpretation.riskFlags.length > 0 ? (
        <InlineList
          title="需要人工注意"
          items={interpretation.riskFlags}
          tone="amber"
        />
      ) : null}
    </div>
  );
}

function MiniBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-slate-950">
        {value}
      </div>
    </div>
  );
}

function BackgroundJobBanner({
  detail,
  loading,
  message,
  request,
}: {
  detail: WorkflowRequestDetail | null;
  loading: boolean;
  message: string;
  request: WorkflowRequest | null;
  worker: WorkerRegistration | null;
}) {
  if (!request && !loading) {
    return null;
  }

  const runs =
    detail && request && detail.request.requestId === request.requestId
      ? detail.runs
      : [];
  const openRun = runs.find(isOpenWorkerRun) ?? null;
  const status = openRun
    ? `${formatUiAgentRole(openRun.agentRole)} ${formatWorkerRunStatus(openRun.status)}`
    : request
      ? formatUiWorkflowStage(request.status)
      : "建立需求中";

  return (
    <div className="sticky top-3 z-30 mb-4 rounded-md border border-blue-200 bg-white/95 p-3 shadow-sm backdrop-blur">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            {loading || openRun ? (
              <Loader2 className="h-4 w-4 animate-spin text-blue-700" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-green-700" />
            )}
            <span>背景工作狀態</span>
          </div>
          <p className="mt-1 truncate text-sm text-slate-600">
            {message ||
              (request ? formatRequestDisplayTitle(request) : "") ||
              "App 正在更新處理進度。"}
          </p>
        </div>
        <div className="min-w-0 lg:min-w-56">
          <MiniBadge label="目前步驟" value={status} />
        </div>
      </div>
    </div>
  );
}

function WorkflowStatusDashboard({
  loading,
  launcherState,
  latestRun,
  openRun,
  onCancelRun,
  request,
  worker,
}: {
  loading: boolean;
  launcherState: LocalLauncherState;
  latestRun: WorkerRunView | null;
  openRun: WorkerRunView | null;
  onCancelRun: () => void;
  request: WorkflowRequest;
  worker: WorkerRegistration | null;
}) {
  const activeRun = openRun ?? latestRun;
  const isRunning = Boolean(openRun);
  const isQueuedRun = openRun?.status === "queued";
  const cancelRequested = Boolean(openRun?.cancelRequestedAt);
  const launcherNeedsUpdate = launcherState.launcherVersionStatus === "mismatch";
  const workerProcessStopped = Boolean(
    openRun &&
      launcherState.available &&
      launcherState.hasProfile &&
      !launcherState.running,
  );
  const statusText = openRun
    ? `${formatUiAgentRole(openRun.agentRole)} / ${formatWorkerRunStatus(openRun.status)}`
    : formatUiWorkflowStage(request.status);
  const progressLabel = launcherNeedsUpdate
    ? "Launcher 需要更新"
    : workerProcessStopped
      ? "Worker 已停止"
      : isQueuedRun
      ? "等待 Worker 領取 Agent"
      : (openRun?.progressLabel?.trim() ?? "");
  const progressDetail = launcherNeedsUpdate
    ? "先更新 Launcher，再重啟 Worker。"
    : workerProcessStopped
      ? "Agent 尚未開始；重啟 Worker 後會接續這筆 queued run。"
      : isQueuedRun
      ? "Agent run 已排入佇列，但尚未被本機 Worker 領取。"
      : (openRun?.progressDetail?.trim() ?? "");
  const isPastSoftTimeout = openRun ? isRunPastSoftTimeout(openRun) : false;
  const runtimeLabel = isQueuedRun ? "等待 Worker 時間" : "執行時間";
  const isPacketLarge = Boolean(
    openRun && openRun.packetSizeChars > PACKET_SIZE_WARNING_CHARS,
  );
  const workerStale = Boolean(
    worker?.lastSeenAt && isStaleTimestamp(worker.lastSeenAt),
  );
  const shouldShowStatus =
    isRunning ||
    workerStale ||
    launcherNeedsUpdate ||
    workerProcessStopped ||
    isPastSoftTimeout ||
    isPacketLarge;

  if (!shouldShowStatus) {
    return null;
  }

  return (
    <div
      className={`rounded-md border p-4 ${
        isRunning ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            {isRunning ? <Spinner className="h-4 w-4 text-blue-700" /> : null}
            <span>{isRunning ? "背景處理中" : "工作狀態"}</span>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {isRunning
              ? "Local Worker 正在執行；完成後 App 會自動刷新並排下一個 Agent，直到需要人工決策或交付完成。"
              : `目前狀態：${statusText}。若流程暫停，請處理下方阻擋項目。`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {openRun ? (
            <Button
              className="gap-2"
              disabled={loading || cancelRequested}
              onClick={onCancelRun}
              type="button"
              variant="outline"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <X className="h-4 w-4" />
              )}
              {cancelRequested ? "停止中" : "停止 Agent"}
            </Button>
          ) : null}
        </div>
      </div>
      {isRunning ? (
        <div className="mt-3 rounded-md border border-blue-200 bg-white/75 p-3 text-sm leading-6 text-slate-700">
          <div className="font-semibold text-slate-950">
            {progressLabel || "正在執行 Agent"}
          </div>
          <p className="mt-1 break-words">
            {progressDetail || "Worker 已接手，等待下一次進度回報。"}
          </p>
          {openRun?.progressUpdatedAt ? (
            <p className="mt-1 text-xs text-slate-500">
              進度更新：{formatTimestamp(openRun.progressUpdatedAt)}
            </p>
          ) : null}
          {openRun ? (
            <details className="mt-3 text-xs text-slate-500">
              <summary className="cursor-pointer font-semibold text-slate-600">
                技術詳情
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <MiniBadge
                  label="Run"
                  value={`${formatWorkerRunStatus(openRun.status)} / ${openRun.runId.slice(0, 8)}`}
                />
                <MiniBadge label={runtimeLabel} value={formatRunDuration(openRun)} />
                <MiniBadge
                  label="Launcher"
                  value={
                    launcherState.available
                      ? launcherState.running
                        ? "執行中"
                        : launcherNeedsUpdate
                          ? "需更新"
                          : "已停止"
                      : "未啟動"
                  }
                />
                <MiniBadge label="Packet" value={formatPacketSize(openRun.packetSizeChars)} />
                <MiniBadge
                  label="Handoff"
                  value={`${openRun.priorHandoffCount} 份`}
                />
                <MiniBadge
                  label="Snapshot"
                  value={openRun.usedResumeSnapshot ? "有" : "無"}
                />
                <MiniBadge
                  label="Retry"
                  value={openRun.isRetryContext ? "是" : "否"}
                />
                <MiniBadge
                  label="停止請求"
                  value={
                    openRun.cancelRequestedAt
                      ? formatTimestamp(openRun.cancelRequestedAt)
                      : "無"
                  }
                />
                <MiniBadge
                  label="Worker 心跳"
                  value={formatTimestamp(worker?.lastSeenAt)}
                />
                <MiniBadge
                  label="最新更新"
                  value={formatTimestamp(activeRun?.updatedAt ?? request.updatedAt)}
                />
              </div>
            </details>
          ) : null}
          {workerProcessStopped || launcherNeedsUpdate ? (
            <details className="mt-2 text-xs text-slate-500">
              <summary className="cursor-pointer font-semibold text-slate-600">
                查看詳情
              </summary>
              <div className="mt-1 space-y-1 break-all">
                <div>Launcher 版本：{launcherState.version || "未知"}</div>
                <div>
                  App 期望 Launcher：
                  {launcherState.expectedLauncherVersion || "未知"}
                </div>
                <div>Worker PID：{launcherState.pid ?? "無"}</div>
                <div>
                  Worker 狀態：
                  {launcherState.workerStatusReason || "未回報"}
                </div>
              </div>
            </details>
          ) : null}
          {isPacketLarge ? (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
              Packet 上下文偏大，可能增加 Agent 執行時間；系統已優先使用最新 handoff 與 snapshot 壓縮。
            </p>
          ) : null}
          {isPastSoftTimeout ? (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
              已超過建議時間，可能正在跑完整驗證或等待 Codex 回應；可先查看技術 Log 或重新同步狀態。
            </p>
          ) : null}
        </div>
      ) : null}
      {!isRunning && workerStale ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          Worker 心跳已久未更新：{formatTimestamp(worker?.lastSeenAt)}
        </p>
      ) : null}
    </div>
  );
}

function InlineList({
  title,
  items,
  tone = "slate",
}: {
  title: string;
  items: string[];
  tone?: "slate" | "red" | "amber";
}) {
  if (items.length === 0) {
    return null;
  }

  const color =
    tone === "red"
      ? "text-red-800"
      : tone === "amber"
        ? "text-amber-800"
        : "text-slate-700";

  return (
    <div className="mt-3">
      <div className={`text-xs font-semibold ${color}`}>{title}</div>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function BlockerSummaryList({ items }: { items: string[] }) {
  const summaries = summarizeStageGateBlockers(items);
  if (summaries.length === 0) {
    return null;
  }
  const originalDetails = [
    ...new Set(
      summaries.flatMap((summary) =>
        summary.original
          .split("\n\n---\n\n")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ),
  ].join("\n\n---\n\n");

  return (
    <div className="mt-3">
      <div className="text-xs font-semibold text-red-800">阻擋原因</div>
      <div className="mt-2 grid gap-2">
        {summaries.map((summary, index) => (
          <BlockerSummaryCard key={`${summary.title}-${index}`} summary={summary} />
        ))}
      </div>
      <details className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-700">
          原文技術細節
        </summary>
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-white p-2 font-mono leading-5">
          {originalDetails}
        </pre>
      </details>
    </div>
  );
}

function BlockerSummaryCard({ summary }: { summary: BlockerSummary }) {
  const isPrBranchOutdated = summary.kind === "pr_branch_outdated";
  return (
    <div
      className={`rounded-md border bg-white p-3 ${
        isPrBranchOutdated ? "border-amber-300" : "border-red-100"
      }`}
    >
      <div className="text-sm font-semibold text-red-900">{summary.title}</div>
      {isPrBranchOutdated ? (
        <div className="mt-2 text-sm font-semibold text-amber-900">
          不是 develop 沒拉最新，需要更新的是 PR 分支。
        </div>
      ) : null}
      <div className="mt-2 grid gap-2 text-sm leading-6 text-slate-700 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold text-slate-500">
            為什麼會阻擋
          </div>
          <p className="mt-1">{summary.reason}</p>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-500">
            下一步可補什麼
          </div>
          <p className="mt-1">{summary.nextAction}</p>
        </div>
      </div>
      {summary.details?.length ? (
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          {summary.details.map((detail) => (
            <div
              className="min-w-0 rounded-md border border-slate-200 bg-slate-50 p-2"
              key={`${detail.label}-${detail.value}`}
            >
              <div className="text-xs font-semibold text-slate-500">
                {detail.label}
              </div>
              <div className="mt-1 break-words font-semibold text-slate-900">
                {detail.value}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {summary.warnings?.length ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm font-semibold leading-6 text-amber-900">
          {summary.warnings.join(" ")}
        </div>
      ) : null}
    </div>
  );
}

function AgentRuns({ runs }: { runs: WorkflowRequestDetail["runs"] }) {
  if (runs.length === 0) {
    return <EmptyState text="目前尚無 Agent 執行紀錄。" />;
  }

  return (
    <div className="flex flex-col gap-3">
      {runs.map((run) => (
        <details
          className="rounded-md border border-slate-200 bg-white"
          key={run.runId}
        >
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-800">
            {formatUiAgentRole(run.agentRole)} / {formatWorkerRunStatus(run.status)}
          </summary>
          <div className="grid gap-3 border-t border-slate-200 p-3 lg:grid-cols-2">
            <LogBlock title="Agent Packet" value={run.packet} />
            <LogBlock
              title="產物 Artifact"
              value={run.artifact || "尚未產生產物。"}
            />
            <LogBlock
              title="指令輸出 Command Output"
              value={run.commandOutput || "尚無指令輸出。"}
            />
            <LogBlock
              title="差異摘要 Diff Summary"
              value={run.diffSummary || "尚無差異摘要。"}
            />
          </div>
        </details>
      ))}
    </div>
  );
}

type PullRequestTraceabilityProps = {
  detail: WorkflowRequestDetail;
  discoveryMatches: PullRequestDiscoveryMatch[];
  discoveryMessage: string;
  discoveryState: LoadState;
  form: { pullRequestId: string };
  hasAzurePat: boolean;
  onChange: (form: { pullRequestId: string }) => void;
  onCreateOrRefresh: () => void;
  onDiscover: () => void;
  onStartAdjustment: () => void;
  onSubmit: () => void;
};

function PullRequestTraceabilityPanel({
  detail,
  discoveryMatches,
  discoveryMessage,
  discoveryState,
  form,
  hasAzurePat,
  onChange,
  onCreateOrRefresh,
  onDiscover,
  onStartAdjustment,
  onSubmit,
}: PullRequestTraceabilityProps) {
  const canSubmit = hasAzurePat && Boolean(form.pullRequestId.trim());
  const trace =
    detail.request.resumeSnapshot?.prDeliveryTrace ??
    getPrDeliveryTraceForRequest(detail.request);
  const hasTrackedPr = detail.prLinks.length > 0;
  const traceLabel = trace.sourceBranch
    ? `${trace.sourceBranch} -> ${trace.baseBranch}`
    : `等待 Azure Work Item -> ${trace.baseBranch}`;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-slate-950">
          Azure PR 追蹤
        </div>
        <Badge variant={hasTrackedPr ? "default" : "secondary"}>
          {formatPrDiscoveryStatus(trace.discoveryStatus)}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        App 會依團隊分支自動偵測 Azure Repos 的 active PR；不會建立、merge、abandon 或 deploy。
      </p>
      <div className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 md:grid-cols-3">
        <div>
          <div className="text-xs font-semibold text-slate-500">分支</div>
          <div className="mt-1 break-all font-mono text-xs">{traceLabel}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-500">Azure 單號</div>
          <div className="mt-1">{trace.workItemId || "未提供"}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-500">狀態</div>
          <div className="mt-1">{trace.reason || "等待偵測"}</div>
        </div>
      </div>
      {!hasAzurePat ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          需要 Azure PAT，App 才能讀取 Azure Repos 並自動追蹤 PR。
        </div>
      ) : null}
      {discoveryMessage ? (
        <div
          className={`mt-3 rounded-md border p-3 text-sm ${
            discoveryState === "error"
              ? "border-red-200 bg-red-50 text-red-900"
              : discoveryState === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-blue-200 bg-blue-50 text-blue-900"
          }`}
        >
          {discoveryMessage}
        </div>
      ) : null}
      {discoveryMatches.length > 1 ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          找到多筆 PR 候選，請確認後在下方手動補登 PR ID：{" "}
          {discoveryMatches.map((match) => `#${match.pullRequestId}`).join(", ")}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300"
          disabled={!hasAzurePat || discoveryState === "loading"}
          onClick={onCreateOrRefresh}
          type="button"
        >
          {discoveryState === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GitPullRequest className="h-4 w-4" />
          )}
          建立/刷新 Azure PR
        </button>
        <button
          className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          disabled={!hasAzurePat || discoveryState === "loading" || hasTrackedPr}
          onClick={onDiscover}
          type="button"
        >
          {discoveryState === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          重新偵測
        </button>
        <button
          className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
          onClick={onStartAdjustment}
          type="button"
        >
          <Plus className="h-4 w-4" />
          另開調整需求
        </button>
      </div>
      <details className="mt-3 rounded-md border border-slate-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-800">
          手動補登 PR ID
        </summary>
        <div className="grid gap-3 border-t border-slate-200 p-3 md:grid-cols-[160px_auto]">
          <TextField
            label="PR ID"
            value={form.pullRequestId}
            onChange={(pullRequestId) => onChange({ pullRequestId })}
            placeholder="399"
          />
          <button
            className="inline-flex items-center justify-center gap-2 self-end rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            disabled={!canSubmit}
            onClick={onSubmit}
            type="button"
          >
            <GitPullRequest className="h-4 w-4" />
            補登 PR
          </button>
        </div>
      </details>
      {detail.prLinks.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {detail.prLinks.map((link) => (
            <div
              className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm"
              key={link.id}
            >
              <div className="font-semibold text-slate-950">
                Azure PR #{link.pullRequestId}
              </div>
              {link.webUrl ? (
                <a
                  className="break-all text-blue-700 underline"
                  href={link.webUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {link.webUrl}
                </a>
              ) : null}
              <div className="mt-1 text-xs text-slate-500">
                記錄時間 {link.createdAt}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PullRequestTraceability(props: PullRequestTraceabilityProps) {
  void PullRequestTraceabilityLegacy;
  return <PullRequestTraceabilityPanel {...props} />;
}

function PullRequestTraceabilityLegacy({
  detail,
  form,
  hasAzurePat,
  onChange,
  onSubmit,
}: {
  detail: WorkflowRequestDetail;
  form: { pullRequestId: string };
  hasAzurePat: boolean;
  onChange: (form: { pullRequestId: string }) => void;
  onSubmit: () => void;
}) {
  const canSubmit = hasAzurePat && Boolean(form.pullRequestId.trim());

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-sm font-semibold text-slate-950">
        連結 Azure PR
      </div>
      <p className="mt-1 text-sm text-slate-600">
        PR 已準備好後，可驗證既有 Azure PR 並連結到此需求；此動作不會 merge、abandon、deploy 或修改單號欄位。
      </p>
      {!hasAzurePat ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          需要 Azure PAT，App 才能在連結前驗證 PR。
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 md:grid-cols-[160px_auto]">
        <TextField
          label="PR 編號"
          value={form.pullRequestId}
          onChange={(pullRequestId) => onChange({ pullRequestId })}
          placeholder="399"
        />
        <button
          className="inline-flex items-center justify-center gap-2 self-end rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          disabled={!canSubmit}
          onClick={onSubmit}
          type="button"
        >
          <GitPullRequest className="h-4 w-4" />
          連結既有 PR
        </button>
      </div>
      {detail.prLinks.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {detail.prLinks.map((link) => (
            <div
              className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm"
              key={link.id}
            >
              <div className="font-semibold text-slate-950">
                Azure PR #{link.pullRequestId}
              </div>
              {link.webUrl ? (
                <a
                  className="break-all text-blue-700 underline"
                  href={link.webUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {link.webUrl}
                </a>
              ) : null}
              <div className="mt-1 text-xs text-slate-500">
                記錄時間 {link.createdAt}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LogBlock({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-slate-600">{title}</div>
      <pre className="max-h-64 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 text-xs leading-5 text-slate-100">
        {value}
      </pre>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
      {text}
    </div>
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? `Request failed with ${response.status}.`);
  }

  return data as T;
}

async function fetchFormJson<T>(url: string, body: FormData): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    body,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? `Request failed with ${response.status}.`);
  }

  return data as T;
}

async function fetchLauncherJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1800);

  try {
    const response = await fetchLauncherResponse(path, init, controller.signal);
    const data = (await response
      .json()
      .catch(() => ({}))) as { error?: string; code?: string } & T;

    if (!response.ok) {
      const error = new Error(
        data.error ?? `Launcher request failed with ${response.status}.`,
      ) as LauncherError;
      error.code = data.code;
      throw error;
    }

    return data as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchLauncherResponse(
  path: string,
  init: RequestInit | undefined,
  signal: AbortSignal,
) {
  try {
    return await fetch(`${LOCAL_LAUNCHER_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("本機 Launcher 沒有回應，請確認它正在執行後重試。");
    }

    throw new Error("無法連到本機 Launcher，請確認它正在執行後重試。");
  }
}

function buildWorkerRegistration(workerForm: WorkerForm, owner: string) {
  const workerId = workerForm.workerId.trim() || createLocalWorkerId(owner);
  const displayName =
    workerForm.displayName.trim() || `${owner.trim() || "local-user"} local Codex`;

  return {
    workerId,
    displayName,
    repoPath: workerForm.repoPath.trim(),
    commandTemplate: workerForm.commandTemplate.trim(),
    autoCommitAndPr: workerForm.autoCommitAndPr,
    sandboxMode: workerForm.sandboxMode,
  };
}

function hydrateWorkerFormFromRegistration(
  current: WorkerForm,
  worker: WorkerRegistration,
): WorkerForm {
  return {
    ...current,
    workerId: worker.workerId,
    displayName: worker.displayName,
    repoPath: worker.repoPath,
    commandTemplate: worker.commandTemplate,
    autoCommitAndPr: worker.autoCommitAndPr,
    sandboxMode: worker.sandboxMode,
    dangerFullAccessConfirmed: worker.sandboxMode === "danger-full-access",
  };
}

function findCurrentWorkerRegistration(
  workers: WorkerRegistration[],
  assignedWorkerId: string,
  owner: string,
) {
  return (
    workers.find((worker) => worker.workerId === assignedWorkerId) ??
    workers.find((worker) => worker.workerId === createLocalWorkerId(owner)) ??
    null
  );
}

function getWorkerHydrationSignature(worker: WorkerRegistration) {
  return [
    worker.workerId,
    worker.displayName,
    worker.repoPath,
    worker.commandTemplate,
    String(worker.autoCommitAndPr),
    worker.sandboxMode,
  ].join("\x1f");
}

function getWorkerConnectionInfo(
  worker: WorkerRegistration | null,
  repositoryCandidates: RepositoryCandidate[],
): WorkerConnectionInfo {
  if (!worker) {
    return {
      ready: false,
      label: "尚未啟動連線",
      detail: "請先安裝或啟動本機 Launcher。",
      diagnosticCode: "unknown",
      executablePath: "",
    };
  }

  if (worker.status === "disabled") {
    return {
      ready: false,
      label: "已停止連線",
      detail: "可重新啟動本機 Launcher 連線。",
      diagnosticCode: worker.codexDiagnosticCode,
      executablePath: worker.codexExecutablePath,
    };
  }

  if (!worker.lastSeenAt) {
    return {
      ready: false,
      label: "等待本機 worker 回報",
      detail: "請確認本機 Launcher 已啟動背景 worker。",
      diagnosticCode: worker.codexDiagnosticCode,
      executablePath: worker.codexExecutablePath,
    };
  }

  if (isStaleTimestamp(worker.lastSeenAt)) {
    return {
      ready: false,
      label: "連線逾時",
      detail: "Worker 太久沒有回報。",
      diagnosticCode: worker.codexDiagnosticCode,
      executablePath: worker.codexExecutablePath,
    };
  }

  if (
    worker.repositoryCandidates.length === 0 &&
    repositoryCandidates.length === 0
  ) {
    return {
      ready: false,
      label: "等待專案回報",
      detail: "worker 已啟動，但尚未回報可用專案清單。",
      diagnosticCode: worker.codexDiagnosticCode,
      executablePath: worker.codexExecutablePath,
    };
  }

  if (!worker.codexReady) {
    return {
      ready: false,
      label: "Codex 執行環境未就緒",
      detail: formatCodexReadinessDetail(worker),
      diagnosticCode: worker.codexDiagnosticCode,
      executablePath: worker.codexExecutablePath,
    };
  }

  if (worker.workerVersionStatus === "mismatch") {
    return {
      ready: true,
      label: "Worker 需要更新",
      detail: "Worker 腳本需要更新；請重啟 Worker。",
      diagnosticCode: worker.codexDiagnosticCode,
      executablePath: worker.codexExecutablePath,
    };
  }

  if (worker.workerVersionStatus === "unknown") {
    return {
      ready: true,
      label: "Worker 版本未確認",
      detail: "Worker 尚未回報版本；建議重啟 Worker。",
      diagnosticCode: worker.codexDiagnosticCode,
      executablePath: worker.codexExecutablePath,
    };
  }

  return {
    ready: true,
    label: "已連線",
    detail: "worker 已啟動並回報本機專案清單。請選擇要交給 Codex 處理的專案。",
    diagnosticCode: worker.codexDiagnosticCode,
    executablePath: worker.codexExecutablePath,
  };
}

function formatCodexReadinessDetail(worker: WorkerRegistration) {
  const error = worker.codexError.trim();
  if (error && !hasEncodingDamage(error)) {
    return error;
  }

  if (worker.codexDiagnosticCode === "cli-missing") {
    return "找不到可由 terminal 呼叫的 Codex CLI。請先安裝並登入 Codex CLI。";
  }

  if (worker.codexDiagnosticCode === "desktop-internal-not-cli") {
    return "目前找到的是 Codex Desktop 內部執行檔，不是 Local Worker 可呼叫的 Codex CLI。";
  }

  if (worker.codexStatus === "command-failed") {
    return "Codex CLI 無法從 Local Worker 執行。請確認 terminal 可直接執行 Codex CLI；若目前找到的是 Codex Desktop 內部執行檔，Local Worker 會回報存取被拒。";
  }

  return "本機 worker 已連線，但尚未確認 Codex CLI 可執行任務。";
}

function hasEncodingDamage(value: string) {
  return value.includes("�") || /[ÃÂä¸æåéèã]/.test(value);
}

function isStaleTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return true;
  }

  return Date.now() - timestamp > 5 * 60 * 1000;
}

function buildWorkerCommand(
  worker: WorkerRegistrationWithToken,
  azurePat = "",
  controlPlaneUrl: string,
  options: { maskSecrets?: boolean } = {},
) {
  const patValue = options.maskSecrets && azurePat.trim() ? "<hidden>" : azurePat;
  const lines = [
    powerShellEnv("CONTROL_PLANE_URL", controlPlaneUrl),
    powerShellEnv("WORKER_ID", worker.workerId),
    powerShellEnv("WORKER_TOKEN", worker.token),
  ];

  if (worker.repoPath) {
    lines.push(powerShellEnv("REPO_PATH", worker.repoPath));
  }

  lines.push(powerShellEnv("CODEX_SANDBOX_MODE", worker.sandboxMode));

  if (patValue.trim()) {
    lines.push(powerShellEnv("AZURE_DEVOPS_PAT", patValue));
  }

  if (worker.autoCommitAndPr) {
    lines.push(powerShellEnv("CONTROL_PLANE_AUTO_COMMIT_PR", "1"));
  }

  lines.push(
    "$workerRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexMissionControl\\worker'",
  );
  lines.push("New-Item -ItemType Directory -Force -Path $workerRoot | Out-Null");
  lines.push("$workerFiles = @('local-worker.mjs', 'local-worker-utils.mjs')");
  lines.push("foreach ($workerFile in $workerFiles) {");
  lines.push(
    '  $workerUrl = "$env:CONTROL_PLANE_URL/api/workers/bootstrap?file=$workerFile"',
  );
  lines.push(
    "  Invoke-WebRequest -UseBasicParsing -Uri $workerUrl -OutFile (Join-Path $workerRoot $workerFile)",
  );
  lines.push("}");
  lines.push("Set-Location -LiteralPath $workerRoot");
  lines.push("node .\\local-worker.mjs");
  return lines.join("\n");
}

function buildLauncherInstallCommand(controlPlaneUrl: string) {
  const lines = [
    powerShellEnv("CONTROL_PLANE_URL", controlPlaneUrl),
    "$installer = Join-Path $env:TEMP 'codex-mission-control-launcher-install.ps1'",
    'Invoke-WebRequest -UseBasicParsing -Uri "$env:CONTROL_PLANE_URL/api/workers/bootstrap?file=local-launcher-install.ps1" -OutFile $installer',
    "powershell -NoProfile -ExecutionPolicy Bypass -File $installer -ControlPlaneUrl $env:CONTROL_PLANE_URL",
  ];

  return lines.join("\n");
}

async function copyTextToClipboard(
  text: string,
  fallbackElement?: HTMLElement | null,
): Promise<"copied" | "selected" | "failed"> {
  const clipboard =
    typeof navigator === "undefined" ? undefined : navigator.clipboard;

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return "copied";
    } catch {
      // Some embedded browsers reject navigator.clipboard even inside clicks.
    }
  }

  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);

    try {
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      if (
        typeof document.execCommand === "function" &&
        document.execCommand("copy")
      ) {
        return "copied";
      }
    } catch {
      // Fall through to selecting the visible command for manual copy.
    } finally {
      textarea.remove();
    }
  }

  if (fallbackElement && typeof window !== "undefined") {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(fallbackElement);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return "selected";
  }

  return "failed";
}

function createLocalWorkerId(owner: string) {
  const slug = (owner || "local-user")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${slug || "local-user"}-local`;
}

function sameRepositoryCandidates(
  left: RepositoryCandidate[],
  right: RepositoryCandidate[],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getRepositoryDisplayName(
  repoPath: string,
  repositoryCandidates: RepositoryCandidate[],
  worker: WorkerRegistration | null,
) {
  if (!repoPath) {
    return "尚未選擇";
  }

  const normalizedRepoPath = normalizeRepositoryPath(repoPath);
  const candidates = [
    ...repositoryCandidates,
    ...(worker?.repositoryCandidates ?? []),
  ];
  const matched = candidates.find(
    (candidate) => normalizeRepositoryPath(candidate.path) === normalizedRepoPath,
  );

  return matched?.name || getPathLeaf(repoPath);
}

function isRequestForSelectedRepository(
  request: Pick<WorkflowRequest, "repoPath">,
  selectedRepoPath: string,
) {
  const normalizedSelectedRepo = normalizeRepositoryPath(selectedRepoPath);
  if (!normalizedSelectedRepo) {
    return true;
  }

  return normalizeRepositoryPath(request.repoPath) === normalizedSelectedRepo;
}

function normalizeRepositoryPath(repoPath: string) {
  return repoPath.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function getPathLeaf(repoPath: string) {
  const normalized = repoPath.replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalized.split("/").pop() || "尚未選擇";
}

function isOpenWorkerRun(run: WorkerRunView) {
  return run.status === "queued" || run.status === "running";
}

function isActiveWorkflowStage(stage: WorkflowRequest["status"]) {
  return [
    "dispatched",
    "source_check",
    "ready_for_implementation",
    "running",
    "review",
  ].includes(stage);
}

function formatUiAgentRole(agentRole: WorkerRunView["agentRole"]) {
  const labels: Record<WorkerRunView["agentRole"], string> = {
    agent0: "Agent 0：讀懂需求，整理成可派工的工作",
    agent1: "Agent 1：確認來源、範圍與缺漏，避免直接猜",
    agent2: "Agent 2：在本機專案完成必要調整與驗證",
    agent3: "Agent 3：檢查結果、整理交付，決定 PR 或完成狀態",
  };

  return labels[agentRole];
}

function formatWorkerRunStatus(status: WorkerRunView["status"]) {
  const labels: Record<WorkerRunView["status"], string> = {
    queued: "等待中",
    running: "執行中",
    completed: "已完成",
    failed: "失敗",
    blocked: "已阻擋",
    cancelled: "已停止",
  };

  return labels[status];
}

function formatUiWorkflowStage(stage: WorkflowRequest["status"]) {
  const labels: Record<WorkflowRequest["status"], string> = {
    intake: "需求輸入",
    dispatched: "已派工",
    source_check: "來源確認",
    ready_for_implementation: "等待本機調整",
    running: "執行中",
    review: "審查中",
    pr_ready: "PR 已準備好",
    pr_created: "PR 已建立",
    delivered: "已交付",
    blocked: "已阻擋",
  };

  return labels[stage];
}

function formatPrDiscoveryStatus(status: PrDeliveryTrace["discoveryStatus"]) {
  const labels: Record<PrDeliveryTrace["discoveryStatus"], string> = {
    pending: "等待推送",
    found: "已找到 PR",
    not_found: "未找到 PR",
    ambiguous: "多筆候選",
    failed: "偵測失敗",
  };

  return labels[status];
}

function formatUiDeliveryMode(deliveryMode: DeliveryMode) {
  return deliveryMode === "no_pr" ? "不需要 PR" : "需要 draft PR";
}

function formatUiEvidenceMode(evidenceMode: RequestEvidenceMode) {
  return evidenceMode === "ui_only"
    ? "小幅 UI/視覺修正"
    : "使用者敘述/截圖 + repo 驗證";
}

function formatAzureReferenceEvidenceBadge(request: WorkflowRequest) {
  if (request.azureReferenceType === "none" || !request.azureReferenceId) {
    return "無 Azure 單號";
  }

  if (request.azureReferenceType === "pr") {
    return `Azure PR #${request.azureReferenceId}`;
  }

  const evidence = request.azureReferenceEvidence;
  if (evidence.status === "verified") {
    return `Azure #${request.azureReferenceId} 已驗證`;
  }

  if (evidence.status === "unverified") {
    return `Azure #${request.azureReferenceId} 未驗證`;
  }

  return `Azure #${request.azureReferenceId} tracking only`;
}

function formatLauncherStatus(launcherState: LocalLauncherState) {
  if (!launcherState.available) {
    return "尚未偵測到本機 Launcher。";
  }

  if (launcherState.launcherVersionStatus === "mismatch") {
    return "Launcher 需要更新。";
  }

  const installSuffix = launcherState.requiresAdminInstall
    ? "（暫時模式）"
    : launcherState.installMode === "scheduled-task"
      ? "（正式安裝）"
      : "";

  if (launcherState.running) {
    return `Worker 執行中。${installSuffix}`;
  }

  if (launcherState.hasProfile) {
    return `等待 Worker 回報。${installSuffix}`;
  }

  return `尚未連線 Worker。${installSuffix}`;
}

function shouldShowBlockerRecoveryPanel(stageGate: StageGateResult) {
  return (
    stageGate.status === "blocked" ||
    stageGate.status === "human-decision" ||
    stageGate.recoveryKind === "worker_offline" ||
    stageGate.recoveryKind === "stale_run" ||
    stageGate.canManualRetry ||
    stageGate.needsClarification
  );
}

function formatRecoveryPanelSummary(stageGate: StageGateResult) {
  if (stageGate.recoveryKind === "worker_offline") {
    return "Worker 已停止，Agent 尚未開始。";
  }

  if (stageGate.recoveryKind === "stale_run") {
    return "Agent run 已停滯，不是仍在正常執行。";
  }

  if (stageGate.recoveryKind === "handoff_schema") {
    return "Handoff 不完整。";
  }

  if (
    stageGate.recoveryKind === "worker_version_mismatch" ||
    stageGate.recoveryKind === "worker_runtime_error"
  ) {
    return "本機 Worker 版本不同步，需重新下載並重啟。";
  }

  if (stageGate.recoveryKind === "worker_internal_error") {
    return "Worker 內部錯誤，需更新/重啟後重跑 Agent。";
  }

  if (stageGate.recoveryKind === "repo_dirty_blocked") {
    return "本機 repo 有未提交異動或分支衝突。";
  }

  if (stageGate.needsClarification) {
    return "重跑 Agent；若有補充內容會一併帶入。";
  }

  if (stageGate.status === "human-decision") {
    return "等待人工決策。";
  }

  return "流程已阻擋。";
}

function formatRecoveryNextStep(stageGate: StageGateResult) {
  if (stageGate.recoveryKind === "worker_offline") {
    return "重啟 Worker";
  }

  if (stageGate.recoveryKind === "stale_run") {
    return "同步後重跑 Agent";
  }

  if (stageGate.needsClarification) {
    return "重跑 Agent";
  }

  if (
    stageGate.recoveryKind === "worker_version_mismatch" ||
    stageGate.recoveryKind === "worker_runtime_error"
  ) {
    return "更新 Worker";
  }

  if (stageGate.recoveryKind === "worker_internal_error") {
    return "修復 Worker";
  }

  if (stageGate.recoveryKind === "repo_dirty_blocked") {
    return "處理 repo 狀態";
  }

  if (stageGate.canManualRetry) {
    return "重跑 Agent";
  }

  if (stageGate.status === "human-decision") {
    return "人工決策";
  }

  return "查看阻擋原因";
}

function formatStageGateListItem(item: string) {
  if (item === "No Local Worker is assigned to this request.") {
    return "此需求尚未指派本機 worker。";
  }

  if (item.includes("worker_internal_error") || item.includes("Worker 內部錯誤")) {
    return "Worker 內部錯誤，請更新/重啟 Worker；若仍同錯，表示 App 提供的 worker bundle 需要修復。";
  }

  if (
    item.includes("worker_version_mismatch") ||
    item.includes("本機背景 Worker 版本不同步") ||
    item.includes("本機 Worker 版本不同步")
  ) {
    return "Worker 需要更新；請更新並重啟 Worker。";
  }

  if (item.includes("本機 repo 目前有未提交異動")) {
    return item;
  }

  if (item === "Wait for the assigned Local Worker to return artifacts.") {
    return "等待指派的本機 worker 回傳產物。";
  }

  if (
    item ===
    "Wait for the assigned Local Worker to pick up the queued Agent run."
  ) {
    return "等待本機 Worker 領取已排入佇列的 Agent。";
  }

  if (
    item ===
    "Restart or refresh the assigned Local Worker so it can pick up the queued Agent run."
  ) {
    return "重新下載並重啟本機 Worker，讓它領取已排入佇列的 Agent。";
  }

  if (
    item ===
    "Review Agent3 delivery artifact and approve Azure draft PR creation."
  ) {
    return "檢查 Agent3 交付結果，並追蹤 Azure Repos 中對應分支產生的 PR。";
  }

  if (
    item ===
    "Approve guarded draft PR creation when the App requests Azure write confirmation."
  ) {
    return "執行 Azure PR 偵測；若 Azure 尚未出現 PR，再用手動補登。";
  }

  if (
    item ===
    "Review Agent3 delivery artifact and track the Azure PR that appears for the pushed request branch."
  ) {
    return "檢查 Agent3 交付結果，並追蹤 Azure Repos 中對應分支產生的 PR。";
  }

  if (
    item ===
    "Run Azure PR discovery or use the manual fallback if Azure Repos does not expose the PR yet."
  ) {
    return "執行 Azure PR 偵測；若 Azure 尚未出現 PR，再用手動補登。";
  }

  if (item.startsWith("Dispatch ")) {
    return "將下一步派給指派的本機 worker。";
  }

  if (item.includes("reported failed")) {
    return item.replace("reported failed", "回報失敗");
  }

  if (item.includes("reported blocked")) {
    return item.replace("reported blocked", "回報阻擋");
  }

  return item;
}

function formatRunDuration(run: WorkerRunView) {
  const start = Date.parse(
    run.status === "queued" ? run.createdAt : (run.startedAt ?? run.createdAt),
  );
  const end = run.completedAt ? Date.parse(run.completedAt) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return "未知";
  }

  const seconds = Math.max(1, Math.round((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${remainder}s`;
}

function inferWorkerStatusReason(
  workerStatus: LocalLauncherWorkerStatus | null,
): LocalLauncherState["workerStatusReason"] {
  if (!workerStatus) {
    return "";
  }

  if (!workerStatus.hasProfile) {
    return "profile_missing";
  }

  if (workerStatus.running) {
    return "running";
  }

  return workerStatus.pid ? "pid_not_running" : "pid_missing";
}

function getLauncherVersionStatus(
  launcherVersion: string,
  expectedLauncherVersion: string,
): LocalLauncherState["launcherVersionStatus"] {
  if (!launcherVersion || !expectedLauncherVersion) {
    return "unknown";
  }

  return launcherVersion === expectedLauncherVersion ? "current" : "mismatch";
}

function isRunPastSoftTimeout(run: WorkerRunView) {
  if (!run.startedAt || run.completedAt) {
    return false;
  }

  const start = Date.parse(run.startedAt);
  return !Number.isNaN(start) && Date.now() - start > RUN_SOFT_TIMEOUT_MS;
}

function formatPacketSize(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "未知";
  }

  if (value < 1000) {
    return `${value} chars`;
  }

  return `${(value / 1000).toFixed(1)}k chars`;
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "尚未回報";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "未知";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function getBrowserControlPlaneUrl() {
  return typeof location === "undefined"
    ? ""
    : location.origin.replace(/\/+$/, "");
}


function powerShellEnv(name: string, value: string) {
  return `$env:${name}='${value.replaceAll("'", "''")}'`;
}

function formatPublicNextStep(agentRole: string) {
  if (agentRole === "agent0") {
    return "準備流程";
  }

  if (agentRole === "agent1") {
    return "確認來源";
  }

  if (agentRole === "agent2") {
    return "執行開發";
  }

  if (agentRole === "agent3") {
    return "檢查交付";
  }

  return "無";
}

function formatAzureNumberLabel(item: WorkItemCandidate) {
  const type = item.type || "Azure";
  const title = item.title ? ` - ${item.title}` : "";
  const state = item.state ? ` (${item.state})` : "";

  return `${type} 單號 ${item.id}${title}${state}`;
}

function isUserStoryCandidate(item: WorkItemCandidate | null | undefined) {
  return item?.type?.trim().toLowerCase() === "user story";
}

function buildVerifiedWorkItemEvidence(
  item: WorkItemCandidate,
  checkedAt: string,
): AzureReferenceEvidence {
  return {
    status: "verified",
    referenceType: "work-item",
    referenceId: item.id,
    checkedAt,
    title: item.title ?? "",
    workItemType: item.type ?? "",
    workItemState: item.state ?? "",
    assignedTo: item.assignedTo ?? "",
    areaPath: item.areaPath ?? "",
    iterationPath: item.iterationPath ?? "",
    webUrl: item.webUrl ?? "",
    summary: item.title ?? "",
    error: "",
  };
}

function flattenWorkItemIterations(
  root: WorkItemIterationNode,
): WorkItemIterationOption[] {
  const options: WorkItemIterationOption[] = [];

  function visit(node: WorkItemIterationNode, depth: number) {
    options.push({
      id: node.id,
      name: node.name,
      path: node.path,
      startDate: node.startDate,
      finishDate: node.finishDate,
      depth,
    });

    for (const child of node.children) {
      visit(child, depth + 1);
    }
  }

  for (const child of root.children) {
    visit(child, 0);
  }

  return options;
}

function buildWorkItemFilterOptions(
  items: WorkItemCandidate[],
): WorkItemFilterOptions {
  return {
    states: uniqueSorted(items.map((item) => item.state)),
    types: uniqueSorted(items.map((item) => item.type)),
    assignees: uniqueSorted(items.map((item) => item.assignedTo)),
  };
}

function uniqueSorted(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right, "zh-Hant"));
}

function formatIterationOptionLabel(option: WorkItemIterationOption) {
  const dateRange = formatIterationDateRange(option);
  return dateRange ? `${option.path} (${dateRange})` : option.path;
}

function formatIterationDateRange(option: WorkItemIterationOption) {
  if (!option.startDate && !option.finishDate) {
    return "";
  }

  return [formatShortDate(option.startDate), formatShortDate(option.finishDate)]
    .filter(Boolean)
    .join(" - ");
}

function formatShortDate(value: string | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 10);
}

function extractAzureReferenceFromDetail(detail: string): {
  type: AzureReferenceType;
  id: string;
} {
  const workItemMatch =
    detail.match(/work\s*item\s*#?\s*(\d+)/i) ??
    detail.match(/wi\s*#?\s*(\d+)/i) ??
    detail.match(/單號\s*#?\s*(\d+)/) ??
    detail.match(/任務\s*#?\s*(\d+)/);
  if (workItemMatch?.[1]) {
    return { type: "work-item", id: workItemMatch[1] };
  }

  const prMatch =
    detail.match(/\bpr\s*#?\s*(\d+)/i) ??
    detail.match(/pull\s*request\s*#?\s*(\d+)/i);
  if (prMatch?.[1]) {
    return { type: "pr", id: prMatch[1] };
  }

  return { type: "none", id: "" };
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error.";
}

function getLauncherErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return "";
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}
