/**
 * Zustand store powering the workflow editor.
 *
 * Manages React Flow nodes, edges, viewport, and dirty-state tracking so the
 * Obsidian view wrapper knows when to persist changes back to the vault.
 */

import { createStore } from "zustand/vanilla";
import { applyNodeChanges, applyEdgeChanges, addEdge } from "@xyflow/react";

import { DEFAULT_WORKFLOW } from "./types";
import { validateWorkflow } from "./context/validation";

import type { ValidationResult } from "./context/validation";

import type { StoreApi } from "zustand/vanilla";
import type {
    Connection,
    NodeChange,
    EdgeChange,
    Viewport,
} from "@xyflow/react";
import type {
    WorkflowFile,
    WorkflowNode,
    WorkflowEdge,
    WorkflowGlobals,
} from "./types";

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

export interface WorkflowState {
    /** Current set of nodes. */
    nodes: WorkflowNode[];
    /** Current set of edges. */
    edges: WorkflowEdge[];
    /** Current viewport (pan/zoom). */
    viewport: Viewport;
    /** `true` when the graph has unsaved changes. */
    dirty: boolean;

    /** Design-time validation results (recomputed on graph changes). */
    validationResults: ValidationResult[];
    /** Validation results grouped by node ID for quick lookup. */
    validationByNode: Map<string, ValidationResult[]>;

    // --- Actions -----------------------------------------------------------

    /** Replace the entire document (e.g. on file load). Resets dirty flag. */
    loadWorkflow: (file: WorkflowFile) => void;

    /** React Flow `onNodesChange` handler. */
    onNodesChange: (changes: NodeChange[]) => void;

    /** React Flow `onEdgesChange` handler. */
    onEdgesChange: (changes: EdgeChange[]) => void;

    /** React Flow `onConnect` handler. */
    onConnect: (connection: Connection) => void;

    /** React Flow `onViewportChange` handler. */
    onViewportChange: (viewport: Viewport) => void;

    /** Add a new node to the workflow. */
    addNode: (node: WorkflowNode) => void;

    /** Remove a node and its edges. If it's a compound, also remove children. */
    removeNode: (id: string) => void;

    /** Update the data payload of a specific node. */
    updateNodeData: (id: string, data: Partial<WorkflowNode["data"]>) => void;

    /** Global workflow settings (name, description, etc). */
    globals: WorkflowGlobals;

    /** Update global settings payload. */
    updateGlobals: (data: Partial<WorkflowGlobals>) => void;

    /** Serialise current state back to the `.zotflow` file format. */
    toWorkflowFile: () => WorkflowFile;

    /** Reset dirty flag (called after a successful save). */
    markClean: () => void;

    /** Recompute design-time validation results from current graph. */
    runValidation: () => void;
}

// ---------------------------------------------------------------------------
// Factory — returns a vanilla Zustand store (framework-agnostic)
// ---------------------------------------------------------------------------

export function createWorkflowStore(
    initial: WorkflowFile = DEFAULT_WORKFLOW,
): StoreApi<WorkflowState> {
    return createStore<WorkflowState>((set, get) => ({
        nodes: initial.nodes,
        edges: initial.edges,
        viewport: initial.viewport ?? { x: 0, y: 0, zoom: 0.8 },
        globals: initial.globals ?? DEFAULT_WORKFLOW.globals!,
        dirty: false,
        validationResults: [],
        validationByNode: new Map(),

        loadWorkflow(file) {
            set({
                nodes: file.nodes,
                edges: file.edges,
                viewport: file.viewport ?? { x: 0, y: 0, zoom: 0.8 },
                globals: file.globals ?? DEFAULT_WORKFLOW.globals!,
                dirty: false,
            });
        },

        onNodesChange(changes) {
            // Collect IDs of nodes being removed so we can cascade-delete
            // any children inside compound nodes.
            const removedIds = new Set<string>();
            for (const c of changes) {
                if (c.type === "remove") removedIds.add(c.id);
            }

            set((s) => {
                let nodes = applyNodeChanges(
                    changes,
                    s.nodes,
                ) as WorkflowNode[];

                if (removedIds.size > 0) {
                    // Remove children whose parentId was deleted
                    nodes = nodes.filter(
                        (n) => !n.parentId || !removedIds.has(n.parentId),
                    );
                }

                return { nodes, dirty: true };
            });
        },

        onEdgesChange(changes) {
            set((s) => ({
                edges: applyEdgeChanges(changes, s.edges) as WorkflowEdge[],
                dirty: true,
            }));
        },

        onConnect(connection) {
            set((s) => {
                // Enforce single-input: if the target handle already has
                // an incoming edge, replace it instead of adding a second.
                const filtered = s.edges.filter(
                    (e) =>
                        !(
                            e.target === connection.target &&
                            e.targetHandle === connection.targetHandle
                        ),
                );
                return {
                    edges: addEdge(
                        { ...connection, id: `edge_${Date.now()}` },
                        filtered,
                    ) as WorkflowEdge[],
                    dirty: true,
                };
            });
        },

        onViewportChange(viewport) {
            set({ viewport, dirty: true });
        },

        addNode(node) {
            set((s) => ({
                nodes: s.nodes.concat(node),
                dirty: true,
            }));
        },

        removeNode(id) {
            set((s) => {
                // Collect all IDs to remove (the node + any children)
                const idsToRemove = new Set<string>([id]);
                for (const n of s.nodes) {
                    if (n.parentId === id) idsToRemove.add(n.id);
                }
                return {
                    nodes: s.nodes.filter((n) => !idsToRemove.has(n.id)),
                    edges: s.edges.filter(
                        (e) =>
                            !idsToRemove.has(e.source) &&
                            !idsToRemove.has(e.target),
                    ),
                    dirty: true,
                };
            });
        },

        updateNodeData(id, data) {
            set((s) => ({
                nodes: s.nodes.map((node) => {
                    if (node.id === id) {
                        return { ...node, data: { ...node.data, ...data } };
                    }
                    return node;
                }),
                dirty: true,
            }));
        },

        updateGlobals(data) {
            set((s) => ({
                globals: { ...s.globals, ...data },
                dirty: true,
            }));
        },

        toWorkflowFile() {
            const { nodes, edges, viewport, globals } = get();
            return { version: 1, nodes, edges, viewport, globals };
        },

        markClean() {
            set({ dirty: false });
        },

        runValidation() {
            const { nodes, edges } = get();
            const results = validateWorkflow(nodes, edges);
            const byNode = new Map<string, ValidationResult[]>();
            for (const r of results) {
                if (r.nodeId) {
                    const list = byNode.get(r.nodeId) ?? [];
                    list.push(r);
                    byNode.set(r.nodeId, list);
                }
            }
            set({ validationResults: results, validationByNode: byNode });
        },
    }));
}
