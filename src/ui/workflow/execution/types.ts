/**
 * Types for the workflow execution engine.
 */

// ---------------------------------------------------------------------------
// Execution status
// ---------------------------------------------------------------------------

/** Special handle ID returned by nodes that terminate the workflow early. */
export const TERMINATE_HANDLE = "__terminate__";

/** Lifecycle state of a single workflow run. */
export type WorkflowRunStatus =
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "terminated";

/** Lifecycle state of a single node within a run. */
export type NodeExecutionStatus = "completed" | "failed" | "skipped";

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Outcome of executing a single node. */
export interface NodeExecutionResult {
    nodeId: string;
    /** The output handle ID returned by `execute()` (e.g. `"flow-out"`, `"true"`). */
    handleId?: string;
    /** Wall-clock duration in ms. */
    duration: number;
    status: NodeExecutionStatus;
    error?: string;
}

/** Final outcome of a complete workflow run. */
export interface WorkflowExecutionResult {
    status: WorkflowRunStatus;
    results: NodeExecutionResult[];
    /** Deep clone of the context store after the last executed node. */
    finalSnapshot?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

/** Optional hooks the caller can attach to observe execution progress. */
export interface ExecutionCallbacks {
    onNodeStart?(nodeId: string): void;
    onNodeComplete?(nodeId: string, handleId: string, durationMs: number): void;
    onNodeError?(nodeId: string, error: unknown): void;
    onProgress?(completed: number, total: number, message: string): void;
}
