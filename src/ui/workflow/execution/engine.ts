/**
 * WorkflowEngine — stateless execution logic for a workflow graph.
 *
 * Walks from the trigger node following edges determined by each node's
 * `execute()` return value (the output handle ID).  Forks a
 * `StrictWorkflowContext` per node so that write-permissions match the
 * node's declared `contextOutputs`.
 *
 * Compound nodes (Apply-to-Each, Parallel) are supported: their inner
 * sub-graphs are executed via `executeInnerChain()`.
 *
 * Yields to the event loop between nodes (`setTimeout(0)`) to keep the
 * main thread responsive.
 */

import { ZotFlowError, ZotFlowErrorCode } from "utils/error";
import { getNodeType, resolveScopedContextOutputs } from "../node-registry";
import {
    topologicalSort,
    propagateSchemas,
    getTopLevelGraph,
    getInnerGraph,
    type PropagatedSchema,
} from "../context/propagation";
import { mergeSchemas } from "../context/schema";
import { createInitialContext } from "../context/strict-context";
import { validateWorkflow } from "../context/validation";

import type { WorkflowFile, WorkflowNode, WorkflowEdge } from "../types";
import { TERMINATE_HANDLE } from "./types";
import type {
    WorkflowExecutionResult,
    NodeExecutionResult,
    ExecutionCallbacks,
} from "./types";
import type { StrictWorkflowContext } from "../context/strict-context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Yield to the event loop so the UI stays responsive. */
function yieldToMain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Count the total top-level nodes reachable from the trigger via edge traversal. */
function countReachable(
    triggerId: string,
    edges: WorkflowEdge[],
    nodeIds: Set<string>,
): number {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
        let arr = adj.get(e.source);
        if (!arr) {
            arr = [];
            adj.set(e.source, arr);
        }
        arr.push(e.target);
    }

    const visited = new Set<string>();
    const queue = [triggerId];
    while (queue.length > 0) {
        const id = queue.shift()!;
        if (visited.has(id) || !nodeIds.has(id)) continue;
        visited.add(id);
        for (const next of adj.get(id) ?? []) {
            if (!visited.has(next)) queue.push(next);
        }
    }
    return visited.size;
}

// ---------------------------------------------------------------------------
// Inner chain execution (for compound nodes)
// ---------------------------------------------------------------------------

/**
 * Execute the linear chain of nodes inside a compound container.
 *
 * Finds the first node with no inner predecessors and follows edges
 * until the chain ends or a terminate handle is returned.
 */
async function executeInnerChain(
    parentId: string,
    allNodes: WorkflowNode[],
    allEdges: WorkflowEdge[],
    context: StrictWorkflowContext,
    schemas: Map<string, PropagatedSchema>,
    signal: AbortSignal,
    results: NodeExecutionResult[],
    callbacks?: ExecutionCallbacks,
): Promise<string | undefined> {
    const { nodes: innerNodes, edges: innerEdges } = getInnerGraph(
        parentId,
        allNodes,
        allEdges,
    );
    if (innerNodes.length === 0) return undefined;

    const sorted = topologicalSort(innerNodes, innerEdges);
    if (sorted.length === 0) return undefined;

    const innerNodeMap = new Map<string, WorkflowNode>();
    for (const n of innerNodes) innerNodeMap.set(n.id, n);

    let currentId: string | undefined = sorted[0];
    const visited = new Set<string>();

    while (currentId) {
        await yieldToMain();
        if (signal.aborted) return undefined;

        if (visited.has(currentId)) break;
        visited.add(currentId);

        const node = innerNodeMap.get(currentId);
        if (!node) break;

        const nodeType = getNodeType(node.type);
        if (!nodeType) break;

        const schema = schemas.get(currentId);
        const nodeContext = context.fork(
            schema?.outputs ?? schema?.cumulative!,
            schema?.cumulative!,
        );

        const nodeLabel = node.data.label || nodeType.displayName || node.type;
        callbacks?.onNodeStart?.(currentId);

        const startMs = performance.now();
        let handleId: string;

        try {
            handleId = await nodeType.execute(nodeContext, node.data, signal);
        } catch (e) {
            const duration = performance.now() - startMs;
            results.push({
                nodeId: currentId,
                duration,
                status: "failed",
                error: e instanceof Error ? e.message : String(e),
            });
            callbacks?.onNodeError?.(currentId, e);
            throw ZotFlowError.wrap(
                e,
                ZotFlowErrorCode.WORKFLOW_NODE_FAILED,
                "WorkflowEngine",
                `Inner node "${nodeLabel}" failed`,
                { nodeId: currentId },
            );
        }

        const duration = performance.now() - startMs;
        results.push({
            nodeId: currentId,
            handleId,
            duration,
            status: "completed",
        });
        callbacks?.onNodeComplete?.(currentId, handleId, duration);

        // Carry forward context
        context = nodeContext;

        if (handleId === TERMINATE_HANDLE) return TERMINATE_HANDLE;

        // Follow edge
        const nextEdge = innerEdges.find(
            (e) =>
                e.source === currentId &&
                (e.sourceHandle === handleId ||
                    (e.sourceHandle == null && handleId === "flow-out")),
        );
        currentId = nextEdge?.target;
    }

    return undefined;
}

// ---------------------------------------------------------------------------
// Compound node dispatchers
// ---------------------------------------------------------------------------

/**
 * Execute an Apply-to-Each compound node.
 *
 * Iterates over the collection, sets `{outputName}.item` and
 * `{outputName}.index` on each iteration, then runs the inner chain.
 * The `outputName` is user-configurable and defaults to `"loop"`.
 */
async function executeApplyToEach(
    node: WorkflowNode,
    allNodes: WorkflowNode[],
    allEdges: WorkflowEdge[],
    context: StrictWorkflowContext,
    schemas: Map<string, PropagatedSchema>,
    signal: AbortSignal,
    results: NodeExecutionResult[],
    callbacks?: ExecutionCallbacks,
): Promise<void> {
    const data = node.data as Record<string, unknown>;
    const collectionPath = (data.collectionPath as string) ?? "";
    const collection = context.get(collectionPath);
    const outputName = (data.outputName as string) || "loop";

    if (!Array.isArray(collection)) return;

    for (let i = 0; i < collection.length; i++) {
        if (signal.aborted) return;

        context.set(outputName, {
            item: collection[i],
            index: i,
        });

        const terminateResult = await executeInnerChain(
            node.id,
            allNodes,
            allEdges,
            context,
            schemas,
            signal,
            results,
            callbacks,
        );
        if (terminateResult === TERMINATE_HANDLE) return;
    }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class WorkflowEngine {
    /**
     * Execute a workflow from start to finish.
     *
     * @param file     - The parsed `.zotflow` document.
     * @param signal   - AbortSignal for cancellation.
     * @param callbacks - Optional hooks for observing progress.
     * @returns Final execution result with per-node outcomes.
     */
    static async execute(
        file: WorkflowFile,
        signal: AbortSignal,
        callbacks?: ExecutionCallbacks,
    ): Promise<WorkflowExecutionResult> {
        const { nodes: allNodes, edges: allEdges } = file;
        const results: NodeExecutionResult[] = [];

        // ----- Design-time validation --------------------------------------

        const validationErrors = validateWorkflow(allNodes, allEdges).filter(
            (r) => r.level === "error",
        );
        if (validationErrors.length > 0) {
            const messages = validationErrors.map((r) => r.message).join("; ");
            throw new ZotFlowError(
                ZotFlowErrorCode.WORKFLOW_VALIDATION_FAILED,
                "WorkflowEngine",
                `Workflow has ${validationErrors.length} validation error${validationErrors.length > 1 ? "s" : ""}: ${messages}`,
            );
        }

        // ----- Partition into top-level graph ------------------------------

        const { nodes: topNodes, edges: topEdges } = getTopLevelGraph(
            allNodes,
            allEdges,
        );

        // ----- Validate ----------------------------------------------------

        const nodeMap = new Map<string, WorkflowNode>();
        for (const n of topNodes) nodeMap.set(n.id, n);

        const sorted = topologicalSort(topNodes, topEdges);
        if (sorted.length < topNodes.length) {
            throw new ZotFlowError(
                ZotFlowErrorCode.WORKFLOW_CYCLE_DETECTED,
                "WorkflowEngine",
                "Workflow contains a cycle and cannot be executed.",
            );
        }

        // Find trigger (first node in topological order whose type is a trigger)
        let triggerNode: WorkflowNode | undefined;
        for (const id of sorted) {
            const node = nodeMap.get(id);
            if (!node) continue;
            const resolved = getNodeType(node.type);
            if (resolved?.category === "trigger") {
                triggerNode = node;
                break;
            }
        }
        if (!triggerNode) {
            throw new ZotFlowError(
                ZotFlowErrorCode.WORKFLOW_NO_TRIGGER,
                "WorkflowEngine",
                "Workflow has no trigger node.",
            );
        }

        // ----- Prepare schemas (covers all nodes, including inner) ---------

        const schemas = propagateSchemas(allNodes, allEdges);
        const topIds = new Set(topNodes.map((n) => n.id));
        const totalNodes = countReachable(triggerNode.id, topEdges, topIds);

        // ----- Execute (follow-the-edge from trigger) ----------------------

        const triggerSchema = schemas.get(triggerNode.id);
        let context: StrictWorkflowContext = createInitialContext(
            triggerSchema?.outputs ?? triggerSchema?.cumulative!,
            triggerSchema?.cumulative,
        );

        let currentNodeId: string | undefined = triggerNode.id;
        let completedCount = 0;
        const visited = new Set<string>();

        while (currentNodeId) {
            await yieldToMain();

            if (signal.aborted) {
                return { status: "cancelled", results };
            }

            // Runtime cycle guard
            if (visited.has(currentNodeId)) {
                throw new ZotFlowError(
                    ZotFlowErrorCode.WORKFLOW_CYCLE_DETECTED,
                    "WorkflowEngine",
                    `Runtime cycle detected at node "${currentNodeId}".`,
                );
            }
            visited.add(currentNodeId);

            const node = nodeMap.get(currentNodeId);
            if (!node) {
                throw new ZotFlowError(
                    ZotFlowErrorCode.WORKFLOW_NODE_NOT_FOUND,
                    "WorkflowEngine",
                    `Node "${currentNodeId}" not found in workflow.`,
                );
            }

            const nodeType = getNodeType(node.type);
            if (!nodeType) {
                throw new ZotFlowError(
                    ZotFlowErrorCode.WORKFLOW_NODE_NOT_FOUND,
                    "WorkflowEngine",
                    `Node type "${node.type}" is not registered.`,
                );
            }

            // Fork context for this node (trigger uses the initial context)
            const schema = schemas.get(currentNodeId);
            let allowedOutputs = schema?.outputs ?? schema?.cumulative!;

            // Compound nodes also need to write their scoped outputs (e.g.
            // Apply-to-Each writes loop.item/loop.index). Merge scoped outputs
            // into the allowed writes so StrictWorkflowContext doesn't reject.
            if (nodeType.isCompound) {
                const scoped = resolveScopedContextOutputs(
                    node.type,
                    node.data,
                );
                allowedOutputs = mergeSchemas(allowedOutputs, scoped);
            }

            const nodeContext =
                currentNodeId === triggerNode.id
                    ? context
                    : context.fork(allowedOutputs, schema?.cumulative!);

            const nodeLabel =
                node.data.label || nodeType.displayName || node.type;

            callbacks?.onNodeStart?.(currentNodeId);
            callbacks?.onProgress?.(
                completedCount,
                totalNodes,
                `Running: ${nodeLabel}`,
            );

            // ------ Compound node dispatch ---------------------------------
            if (nodeType.isCompound) {
                const compoundNodeId: string = currentNodeId;
                const startMs = performance.now();
                try {
                    // Execute the compound's own logic first
                    const handleId = await nodeType.execute(
                        nodeContext,
                        node.data,
                        signal,
                    );

                    // Dispatch to the appropriate compound executor
                    if (node.type === "apply-to-each") {
                        await executeApplyToEach(
                            node,
                            allNodes,
                            allEdges,
                            nodeContext,
                            schemas,
                            signal,
                            results,
                            callbacks,
                        );
                    } else {
                        // Generic compound: just run inner chain
                        await executeInnerChain(
                            node.id,
                            allNodes,
                            allEdges,
                            nodeContext,
                            schemas,
                            signal,
                            results,
                            callbacks,
                        );
                    }

                    const duration = performance.now() - startMs;
                    completedCount++;
                    results.push({
                        nodeId: compoundNodeId,
                        handleId,
                        duration,
                        status: "completed",
                    });
                    callbacks?.onNodeComplete?.(
                        compoundNodeId,
                        handleId,
                        duration,
                    );
                    callbacks?.onProgress?.(
                        completedCount,
                        totalNodes,
                        `Completed: ${nodeLabel}`,
                    );

                    context = nodeContext;

                    if (handleId === TERMINATE_HANDLE) {
                        return {
                            status: "terminated",
                            results,
                            finalSnapshot: context.snapshot(),
                        };
                    }

                    // Route to next node
                    const nextEdge = topEdges.find(
                        (e) =>
                            e.source === compoundNodeId &&
                            (e.sourceHandle === handleId ||
                                (e.sourceHandle == null &&
                                    handleId === "flow-out")),
                    );
                    currentNodeId = nextEdge?.target;
                    continue;
                } catch (e) {
                    const duration = performance.now() - startMs;
                    results.push({
                        nodeId: compoundNodeId,
                        duration,
                        status: "failed",
                        error: e instanceof Error ? e.message : String(e),
                    });
                    callbacks?.onNodeError?.(compoundNodeId, e);
                    throw ZotFlowError.wrap(
                        e,
                        ZotFlowErrorCode.WORKFLOW_NODE_FAILED,
                        "WorkflowEngine",
                        `Compound node "${nodeLabel}" failed`,
                        { nodeId: compoundNodeId },
                    );
                }
            }

            // ------ Regular (non-compound) node execution ------------------
            const startMs = performance.now();
            let handleId: string;

            try {
                handleId = await nodeType.execute(
                    nodeContext,
                    node.data,
                    signal,
                );
            } catch (e) {
                const duration = performance.now() - startMs;
                results.push({
                    nodeId: currentNodeId,
                    duration,
                    status: "failed",
                    error: e instanceof Error ? e.message : String(e),
                });
                callbacks?.onNodeError?.(currentNodeId, e);

                throw ZotFlowError.wrap(
                    e,
                    ZotFlowErrorCode.WORKFLOW_NODE_FAILED,
                    "WorkflowEngine",
                    `Node "${nodeLabel}" failed`,
                    { nodeId: currentNodeId },
                );
            }

            const duration = performance.now() - startMs;
            completedCount++;
            results.push({
                nodeId: currentNodeId,
                handleId,
                duration,
                status: "completed",
            });
            callbacks?.onNodeComplete?.(currentNodeId, handleId, duration);
            callbacks?.onProgress?.(
                completedCount,
                totalNodes,
                `Completed: ${nodeLabel}`,
            );

            // Carry forward the context store
            context = nodeContext;

            // Check for early termination
            if (handleId === TERMINATE_HANDLE) {
                return {
                    status: "terminated",
                    results,
                    finalSnapshot: context.snapshot(),
                };
            }

            // Route: find edge matching source + sourceHandle
            const nextEdge = topEdges.find(
                (e) =>
                    e.source === currentNodeId &&
                    (e.sourceHandle === handleId ||
                        (e.sourceHandle == null && handleId === "flow-out")),
            );
            currentNodeId = nextEdge?.target;
        }

        return {
            status: "completed",
            results,
            finalSnapshot: context.snapshot(),
        };
    }
}
