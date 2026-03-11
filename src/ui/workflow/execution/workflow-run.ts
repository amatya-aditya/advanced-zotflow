/**
 * WorkflowRun — manages a single workflow execution instance.
 *
 * Wraps `WorkflowEngine.execute()` with lifecycle tracking, abort support,
 * and `ITaskInfo` generation for the Activity Center / TaskMonitor.
 */

import { v4 as uuid } from "uuid";
import { WorkflowEngine } from "./engine";

import type { WorkflowFile } from "../types";
import type {
    WorkflowRunStatus,
    NodeExecutionResult,
    ExecutionCallbacks,
} from "./types";
import type { ITaskInfo, ITaskProgress } from "types/tasks";

// ---------------------------------------------------------------------------
// WorkflowRun
// ---------------------------------------------------------------------------

export class WorkflowRun {
    readonly id: string;
    readonly createdTime: number;
    readonly workflowFile: WorkflowFile;
    readonly filePath?: string;

    private abortController: AbortController;
    private _status: WorkflowRunStatus = "pending";
    private _startTime?: number;
    private _endTime?: number;
    private _progress: ITaskProgress = { completed: 0, total: 0, message: "" };
    private _results: NodeExecutionResult[] = [];
    private _error?: string;

    /** Called by WorkflowService whenever run state changes. */
    onUpdate?: (info: ITaskInfo) => void;

    constructor(file: WorkflowFile, filePath?: string) {
        this.id = uuid();
        this.createdTime = Date.now();
        this.workflowFile = file;
        this.filePath = filePath;
        this.abortController = new AbortController();
    }

    // ----- Public API ------------------------------------------------------

    get status(): WorkflowRunStatus {
        return this._status;
    }

    get errorMessage(): string | undefined {
        return this._error;
    }

    /**
     * Start the workflow execution.
     *
     * Resolves when the run finishes (completed, failed, or cancelled).
     * Never throws — errors are captured in `_error` and `_status`.
     */
    async start(): Promise<void> {
        this._status = "running";
        this._startTime = Date.now();
        this.emitUpdate();

        const callbacks: ExecutionCallbacks = {
            onNodeStart: (nodeId) => {
                this._progress = {
                    ...this._progress,
                    message: `Running: ${this.nodeLabel(nodeId)}`,
                };
                this.emitUpdate();
            },
            onNodeComplete: (_nodeId, _handleId, _durationMs) => {
                // progress is updated via onProgress
            },
            onNodeError: (_nodeId, _error) => {
                // final error state handled below
            },
            onProgress: (completed, total, message) => {
                this._progress = { completed, total, message };
                this.emitUpdate();
            },
        };

        try {
            const result = await WorkflowEngine.execute(
                this.workflowFile,
                this.abortController.signal,
                callbacks,
            );
            this._results = result.results;
            this._status = result.status;
        } catch (e) {
            this._status = "failed";
            this._error = e instanceof Error ? e.message : String(e);
        }

        this._endTime = Date.now();

        // Update progress message with terminal state
        this._progress = {
            ...this._progress,
            message: this.terminalDisplayText(),
        };
        this.emitUpdate();
    }

    /** Cancel this run by aborting its signal. */
    cancel(): void {
        this.abortController.abort();
    }

    // ----- ITaskInfo -------------------------------------------------------

    /** Convert current state to an `ITaskInfo` for the TaskMonitor. */
    toTaskInfo(): ITaskInfo {
        const workflowName =
            this.workflowFile.globals?.name ?? "Untitled Workflow";
        const succeeded = this._results.filter(
            (r) => r.status === "completed",
        ).length;
        const failed = this._results.filter(
            (r) => r.status === "failed",
        ).length;

        return {
            id: this.id,
            type: "workflow",
            status:
                this._status === "pending"
                    ? "pending"
                    : this._status === "running"
                      ? "running"
                      : this._status === "completed"
                        ? "completed"
                        : this._status === "failed"
                          ? "failed"
                          : "cancelled",
            displayText: `Workflow: ${workflowName}`,
            progress: { ...this._progress },
            result:
                this._status === "completed" || this._status === "failed"
                    ? { successCount: succeeded, failCount: failed }
                    : undefined,
            input: this.filePath ? { file: this.filePath } : undefined,
            createdTime: this.createdTime,
            startTime: this._startTime,
            endTime: this._endTime,
            error: this._error,
            canCancel: this._status === "running",
        };
    }

    // ----- Internal --------------------------------------------------------

    private emitUpdate(): void {
        this.onUpdate?.(this.toTaskInfo());
    }

    /** Readable label for a node ID (falls back to the ID itself). */
    private nodeLabel(nodeId: string): string {
        const node = this.workflowFile.nodes.find((n) => n.id === nodeId);
        return node?.data.label || node?.type || nodeId;
    }

    /** Build a terminal display string. */
    private terminalDisplayText(): string {
        const name = this.workflowFile.globals?.name ?? "Workflow";
        const succeeded = this._results.filter(
            (r) => r.status === "completed",
        ).length;

        switch (this._status) {
            case "completed":
                return `${name} — Completed (${succeeded} nodes)`;
            case "failed":
                return `${name} — Failed`;
            case "cancelled":
                return `${name} — Cancelled`;
            default:
                return name;
        }
    }
}
