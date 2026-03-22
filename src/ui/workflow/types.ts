/**
 * Types for the ZotFlow workflow view (.zotflow files).
 */

import type React from "react";
import type { TObject } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

/** Persisted viewport state. */
export interface WorkflowViewport {
    x: number;
    y: number;
    zoom: number;
}

// ---------------------------------------------------------------------------
// Node categories & registry
// ---------------------------------------------------------------------------

/** Top-level categories that govern a node's handle topology. */
export type NodeCategory = "trigger" | "action" | "control";

/** Declares one handle (input or output) on a node type. */
export interface HandleDef {
    /** Unique handle ID within the node (e.g. "flow-in", "true"). */
    id: string;
    /** Optional label rendered beside the handle. */
    label?: string;
}

/**
 * Complete definition of a workflow node type.
 *
 * Each concrete node exports exactly one `NodeType<D>` object containing
 * identity, topology, default data, optional UI components, and execution
 * behavior. The node registry stores these directly.
 *
 * `inputs`, `outputs`, and `colorVar` are optional — the registry fills
 * category-based defaults at registration time (see `ResolvedNodeType`).
 */
export interface NodeType<D extends BaseNodeData = BaseNodeData> {
    /** Unique key registered with React Flow's `nodeTypes` map. */
    type: string;
    /** Governs handle topology defaults and palette grouping. */
    category: NodeCategory;
    /** Human-readable name shown in the palette and node header. */
    displayName: string;
    /** Obsidian icon name (Lucide). */
    icon: string;
    /** CSS variable value for `--node-color-rgb`. Defaults per category. */
    colorVar?: string;
    /** Short description for the palette tooltip. */
    description?: string;
    /** Whether this node is a compound (group) container that holds child nodes. */
    isCompound?: boolean;
    /** Input handles (top of the node). */
    inputs?: HandleDef[];
    /** Output handles (bottom of the node). */
    outputs?: HandleDef[];

    /**
     * Dynamic output handles derived from the node's instance data.
     * Takes priority over static `outputs` when present.
     * Use for nodes like Switch that generate handles per case.
     */
    getOutputs?(data: D): HandleDef[];

    /** Data payload pre-populated when the node is dropped onto the canvas. */
    defaultData: D;

    /**
     * Static output schema — context variables this node writes.
     *
     * Must be a `Type.Object` using namespace nesting, e.g.:
     * ```ts
     * Type.Object({ trigger: Type.Object({ itemKey: Type.String() }) })
     * ```
     */
    contextOutputs?: TObject;

    /**
     * Dynamic output schema derived from the node's instance data.
     * Takes priority over `contextOutputs` when present.
     */
    getContextOutputs?(data: D): TObject;

    /**
     * Scoped output schema — context variables visible only inside a
     * compound node's inner sub-graph, NOT propagated downstream.
     *
     * Use for loop variables (`loop.item`, `loop.index`) that should
     * only exist within the loop body.
     */
    scopedContextOutputs?: TObject;

    /**
     * Dynamic scoped output schema derived from the node's instance data.
     * Takes priority over `scopedContextOutputs` when present.
     *
     * @param data      — the node's current data payload
     * @param available  — context schema available at this node (before scoped
     *                     outputs are merged). Allows the node to inspect
     *                     upstream types, e.g. to infer the element type of
     *                     the collection being iterated.
     */
    getScopedContextOutputs?(data: D, available: TObject): TObject;

    /**
     * Static input requirements — context variables this node reads.
     * Used for design-time validation only (not enforced at runtime).
     */
    contextInputs?: TObject;

    /**
     * Dynamic input requirements derived from the node's instance data.
     * Takes priority over `contextInputs` when present.
     */
    getContextInputs?(data: D): TObject;

    /** Optional body content rendered inside the node card below the header. */
    Body?: React.ComponentType<{ data: D }>;
    /** Optional properties panel rendered when this node is selected. */
    Properties?: React.ComponentType<NodePropertiesProps>;

    /**
     * Execute this node at runtime.
     *
     * @param context - Shared workflow context (read/write variables).
     * @param data    - The node's persisted data payload.
     * @param signal  - Abort signal for cancellation.
     * @returns The ID of the output handle to follow (e.g. `"flow-out"`, `"true"`).
     */
    execute(
        context: WorkflowContext,
        data: D,
        signal: AbortSignal,
    ): Promise<string>;

    /**
     * Optional editor-time validation.
     * @returns An array of error messages (empty = valid).
     */
    validate?(data: D): string[];
}

/**
 * A `NodeType` with all optional topology fields guaranteed present.
 * Produced by the registry after applying category-based defaults.
 */
export type ResolvedNodeType<D extends BaseNodeData = BaseNodeData> =
    NodeType<D> & {
        inputs: HandleDef[];
        outputs: HandleDef[];
        colorVar: string;
    };

/**
 * Shared workflow execution context.
 *
 * Passed to every `NodeType.execute()` call. Nodes read upstream
 * variables via `get()` and write their outputs via `set()`.
 *
 * The concrete implementation will be provided by the execution engine.
 */
export interface WorkflowContext {
    /** Read a context variable (e.g. `"trigger.itemKey"`). */
    get(key: string): unknown;
    /** Write a context variable for downstream nodes. */
    set(key: string, value: unknown): void;
    /** Evaluate a template expression against the current context. */
    evaluateJsonLogic(logic: unknown): unknown;
    /** Return the cumulative schema available at this point in execution. */
    getSchema(): TObject;
}

// ---------------------------------------------------------------------------
// Node data — every custom node stores a typed `data` payload
// ---------------------------------------------------------------------------

/** Base fields shared by every node's `data`. */
export interface BaseNodeData {
    /** User-visible label shown on the node card. */
    label: string;
    /** Optional longer description (collapsed by default). */
    description?: string;
    /**
     * User-configurable namespace for context variables this node writes.
     *
     * When set, context outputs are written under this key (e.g. if a loop
     * node sets `outputName: "bookLoop"`, its variables are accessible as
     * `bookLoop.item` and `bookLoop.index`).
     *
     * Each node type provides a sensible default (e.g. `"loop"`,
     * `"variables"`). Users can rename to avoid collisions when multiple
     * nodes of the same kind exist in a workflow.
     */
    outputName?: string;
    /** Index signature required by React Flow's `Record<string, unknown>`. */
    [key: string]: unknown;
}

/**
 * Props passed to a node-specific properties panel component.
 *
 * Each concrete node can export a `Properties` React component that receives
 * these props. The `NodePropertiesPanel` renders it below the common fields.
 */
export interface NodePropertiesProps {
    /** The selected node's ID. */
    nodeId: string;
    /** The selected node's data payload. */
    data: BaseNodeData;
    /** Patch-update the node's data (merges with existing). */
    updateData: (patch: Partial<BaseNodeData>) => void;
}

// ---------------------------------------------------------------------------
// Serialised graph elements
// ---------------------------------------------------------------------------

/** Serialised node (matches React Flow's `Node` shape). */
export interface WorkflowNode {
    id: string;
    /** Maps to a key in the node registry (e.g. `"trigger"`, `"action"`, `"condition"`). */
    type: string;
    position: { x: number; y: number };
    data: BaseNodeData;
    /** Added by React Flow when a node is selected. */
    selected?: boolean;
    /** For child nodes inside a compound — the parent compound node ID. */
    parentId?: string;
    /** Restricts drag to parent bounds when set to `"parent"`. */
    extent?: "parent";
    /** Explicit width (used by compound containers for resizing). */
    width?: number;
    /** Explicit height (used by compound containers for resizing). */
    height?: number;
}

/** Serialised edge — represents execution order between two nodes. */
export interface WorkflowEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    label?: string;
    animated?: boolean;
    type?: string;
}

// ---------------------------------------------------------------------------
// File schema
// ---------------------------------------------------------------------------

/**
 * Global workflow settings.
 */
export interface WorkflowGlobals {
    name: string;
    description: string;
    isEnabled: boolean;
}

/** Root schema of a `.zotflow` file. */
export interface WorkflowFile {
    version: number;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    viewport?: WorkflowViewport;
    globals?: WorkflowGlobals;
}

/** Default empty workflow document. */
export const DEFAULT_WORKFLOW: WorkflowFile = {
    version: 1,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    globals: {
        name: "New Workflow",
        description: "",
        isEnabled: true,
    },
};
