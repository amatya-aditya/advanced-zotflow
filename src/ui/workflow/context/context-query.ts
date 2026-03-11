/**
 * Context query utilities — resolve available variable paths at a given node.
 */

import { extractPaths } from "./schema";
import { propagateSchemas } from "./propagation";

import type { WorkflowNode, WorkflowEdge } from "../types";

// ---------------------------------------------------------------------------
// Public query functions
// ---------------------------------------------------------------------------

/**
 * Get available context paths for a specific node (for autocomplete).
 *
 * Returns the flattened list of dot-paths available from upstream nodes.
 */
export function getAvailableContextPaths(
    nodeId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
): { path: string; type: string; optional: boolean; description?: string }[] {
    const schemas = propagateSchemas(nodes, edges);
    const prop = schemas.get(nodeId);
    if (!prop) return [];

    return extractPaths(prop.available)
        .filter((p) => p.type !== "object")
        .map((p) => ({
            path: p.path,
            type: p.type,
            optional: p.optional,
            description: p.description,
        }));
}

/**
 * Get available context paths that are arrays for a specific node.
 *
 * Returns only dot-paths whose schema type is `"array"`.
 */
export function getAvailableArrayPaths(
    nodeId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
): { path: string; description?: string }[] {
    const schemas = propagateSchemas(nodes, edges);
    const prop = schemas.get(nodeId);
    if (!prop) return [];

    return extractPaths(prop.available)
        .filter((p) => p.type === "array")
        .map((p) => ({
            path: p.path,
            description: p.description,
        }));
}
