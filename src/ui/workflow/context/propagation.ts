/**
 * Schema propagation — computes available context variables at each node
 * by walking the workflow graph in topological order.
 *
 * At every node the propagator resolves:
 *   - **available** — variables accessible from upstream nodes
 *   - **outputs**   — variables this node declares it writes
 *   - **cumulative**— available + outputs (what downstream nodes see)
 *
 * Compound (group) nodes are supported: their inner child sub-graphs are
 * propagated separately via `propagateInnerSchemas()` and `getInnerGraph()`.
 */

import type { TObject } from "@sinclair/typebox";

import { EMPTY_SCHEMA, mergeSchemas } from "./schema";
import {
    resolveContextOutputs,
    resolveScopedContextOutputs,
    getNodeType,
} from "../node-registry";

import type { WorkflowNode, WorkflowEdge } from "../types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Per-node propagation result. */
export interface PropagatedSchema {
    /** Variables available *to* this node (union of all upstream outputs). */
    available: TObject;
    /** Variables this node adds to context. */
    outputs: TObject;
    /** available + outputs — what downstream nodes can see. */
    cumulative: TObject;
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

/**
 * Return node IDs in topological (execution) order.
 *
 * Uses Kahn's algorithm.  If the graph contains a cycle, the returned
 * array will be shorter than the number of nodes — callers should
 * compare lengths to detect cycles.
 */
export function topologicalSort(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
): string[] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const n of nodes) {
        inDegree.set(n.id, 0);
        adj.set(n.id, []);
    }

    for (const e of edges) {
        adj.get(e.source)?.push(e.target);
        inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
        if (deg === 0) queue.push(id);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
        const id = queue.shift()!;
        sorted.push(id);

        for (const neighbor of adj.get(id) ?? []) {
            const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
            inDegree.set(neighbor, newDeg);
            if (newDeg === 0) queue.push(neighbor);
        }
    }

    return sorted;
}

// ---------------------------------------------------------------------------
// Graph partitioning helpers (exported for engine use)
// ---------------------------------------------------------------------------

/**
 * Return only the top-level nodes and edges (excluding children of compound
 * nodes). This is the graph the outer execution loop walks.
 */
export function getTopLevelGraph(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
    const topNodes = nodes.filter((n) => !n.parentId);
    const topIds = new Set(topNodes.map((n) => n.id));
    const topEdges = edges.filter(
        (e) => topIds.has(e.source) && topIds.has(e.target),
    );
    return { nodes: topNodes, edges: topEdges };
}

/**
 * Return the inner sub-graph (children + their edges) for a compound node.
 * Used by both design-time propagation and runtime execution.
 */
export function getInnerGraph(
    parentId: string,
    allNodes: WorkflowNode[],
    allEdges: WorkflowEdge[],
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
    const innerNodes = allNodes.filter((n) => n.parentId === parentId);
    const innerIds = new Set(innerNodes.map((n) => n.id));
    const innerEdges = allEdges.filter(
        (e) => innerIds.has(e.source) && innerIds.has(e.target),
    );
    return { nodes: innerNodes, edges: innerEdges };
}

// ---------------------------------------------------------------------------
// Inner sub-graph propagation
// ---------------------------------------------------------------------------

/**
 * Propagate schemas through a compound node's inner sub-graph.
 *
 * The compound node's `available` schema (i.e. what's in context when the
 * compound starts) plus any variables the compound itself injects (e.g.
 * `loop.item`) are merged as the starting schema for inner nodes.
 */
function propagateInnerSchemas(
    parentId: string,
    parentAvailable: TObject,
    allNodes: WorkflowNode[],
    allEdges: WorkflowEdge[],
    result: Map<string, PropagatedSchema>,
): void {
    const { nodes: innerNodes, edges: innerEdges } = getInnerGraph(
        parentId,
        allNodes,
        allEdges,
    );
    if (innerNodes.length === 0) return;

    // The compound's contextOutputs + scopedContextOutputs are visible inside.
    // Scoped outputs (e.g. loop.item) only appear here, not downstream.
    const parentNode = allNodes.find((n) => n.id === parentId);
    const compoundOutputs = parentNode
        ? resolveContextOutputs(parentNode.type, parentNode.data)
        : EMPTY_SCHEMA;
    const preScoped = mergeSchemas(parentAvailable, compoundOutputs);
    const scopedOutputs = parentNode
        ? resolveScopedContextOutputs(
              parentNode.type,
              parentNode.data,
              preScoped,
          )
        : EMPTY_SCHEMA;
    const innerBase = mergeSchemas(preScoped, scopedOutputs);

    propagateSubGraph(
        innerNodes,
        innerEdges,
        innerBase,
        allNodes,
        allEdges,
        result,
    );
}

// ---------------------------------------------------------------------------
// Schema propagation (shared logic)
// ---------------------------------------------------------------------------

/**
 * Core propagation loop used by both top-level and inner sub-graphs.
 */
function propagateSubGraph(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    baseSchema: TObject,
    allNodes: WorkflowNode[],
    allEdges: WorkflowEdge[],
    result: Map<string, PropagatedSchema>,
): void {
    const nodeMap = new Map<string, WorkflowNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    const predecessors = new Map<string, string[]>();
    for (const n of nodes) predecessors.set(n.id, []);
    for (const e of edges) {
        predecessors.get(e.target)?.push(e.source);
    }

    const sorted = topologicalSort(nodes, edges);

    for (const id of sorted) {
        const node = nodeMap.get(id);
        if (!node) continue;

        // Compute `available`
        const preds = predecessors.get(id) ?? [];
        let available: TObject;

        if (preds.length === 0) {
            available = baseSchema;
        } else {
            // Use the first predecessor that has a result; merge any extras.
            available = result.get(preds[0]!)?.cumulative ?? baseSchema;
            for (let i = 1; i < preds.length; i++) {
                const ps = result.get(preds[i]!);
                if (ps) available = mergeSchemas(available, ps.cumulative);
            }
        }

        const outputs = resolveContextOutputs(node.type, node.data);
        const cumulative = mergeSchemas(available, outputs);
        result.set(id, { available, outputs, cumulative });

        // Recurse into compound children
        const nodeDef = getNodeType(node.type);
        if (nodeDef?.isCompound) {
            propagateInnerSchemas(id, available, allNodes, allEdges, result);
        }
    }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Propagate context schemas through the workflow graph.
 *
 * Returns a `Map<nodeId, PropagatedSchema>` for every reachable node,
 * including nodes inside compound containers.
 */
export function propagateSchemas(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
): Map<string, PropagatedSchema> {
    const result = new Map<string, PropagatedSchema>();
    const { nodes: topNodes, edges: topEdges } = getTopLevelGraph(nodes, edges);
    propagateSubGraph(topNodes, topEdges, EMPTY_SCHEMA, nodes, edges, result);
    return result;
}
