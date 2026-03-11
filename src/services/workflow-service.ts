import { WorkflowRun } from "ui/workflow/execution/workflow-run";
import { services } from "./services";

import type { LogService } from "./log-service";
import type { WorkflowFile } from "ui/workflow/types";
import type { ITaskInfo } from "types/tasks";

/**
 * WorkflowService — main-thread service managing workflow execution runs.
 *
 * Coordinates `WorkflowRun` instances and pushes state updates to the
 * `TaskMonitor` so that the Activity Center can display live progress.
 */

export interface StartRunOptions {
    filePath?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class WorkflowService {
    /** Active and historical runs (keyed by run ID). */
    private runs = new Map<string, WorkflowRun>();

    /** Maximum retained runs to prevent unbounded memory growth. */
    private static readonly MAX_RUNS = 50;

    constructor(private logService: LogService) {}

    // ----- Public API ------------------------------------------------------

    /**
     * Create and start a new workflow run.
     *
     * @returns The run ID (usable for `cancelRun` / `getRuns`).
     */
    startRun(file: WorkflowFile, options?: StartRunOptions): string {
        this.evictOldRuns();

        const run = new WorkflowRun(file, options?.filePath);
        run.onUpdate = (info: ITaskInfo) => {
            services.taskMonitor.onTaskUpdate(run.id, info);
        };

        this.runs.set(run.id, run);

        // Emit initial "pending" state
        services.taskMonitor.onTaskUpdate(run.id, run.toTaskInfo());

        // Fire-and-forget — errors are captured inside the run
        void run.start().then(() => {
            if (run.status === "failed") {
                services.notificationService.notify("error", run.errorMessage ?? "Workflow run failed.");
            }
            this.logService.info(
                `Workflow run ${run.id} finished: ${run.status}`,
                "WorkflowService",
            );
        });

        this.logService.info(
            `Started workflow run ${run.id}`,
            "WorkflowService",
        );
        return run.id;
    }

    /** Cancel an in-progress run by ID. */
    cancelRun(runId: string): void {
        const run = this.runs.get(runId);
        if (run && run.status === "running") {
            run.cancel();
            this.logService.info(
                `Cancelled workflow run ${runId}`,
                "WorkflowService",
            );
        }
    }

    /** Return `ITaskInfo` snapshots of all tracked runs. */
    getRuns(): ITaskInfo[] {
        return [...this.runs.values()]
            .map((r) => r.toTaskInfo())
            .sort((a, b) => b.createdTime - a.createdTime);
    }

    // ----- Internal --------------------------------------------------------

    /** Drop oldest finished runs when over the limit. */
    private evictOldRuns(): void {
        if (this.runs.size < WorkflowService.MAX_RUNS) return;

        const sorted = [...this.runs.entries()].sort(
            ([, a], [, b]) => a.createdTime - b.createdTime,
        );
        for (const [id, run] of sorted) {
            if (this.runs.size < WorkflowService.MAX_RUNS) break;
            if (run.status !== "running") {
                this.runs.delete(id);
            }
        }
    }
}
