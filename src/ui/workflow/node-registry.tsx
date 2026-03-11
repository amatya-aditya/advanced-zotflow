/**
 * Node registry — single source of truth for every node type available
 * in the workflow editor.
 *
 * Uses a dynamic registration pattern (similar to Obsidian's `registerView`).
 * Each concrete node module exports a single `NodeType` object, then
 * `main.ts` calls `registerNodeType()` for each.
 *
 * To add a new node type:
 *   1. Create a file under `nodes/<category>/` that exports a `NodeType<D>`.
 *   2. Import it in `main.ts` and call `registerNodeType()`.
 */

import React, { memo } from "react";

import { BaseNode } from "./nodes/BaseNode";
import { CompoundNode } from "./nodes/CompoundNode";

import type { NodeProps } from "@xyflow/react";
import type {
    BaseNodeData,
    HandleDef,
    NodeCategory,
    NodeType,
    ResolvedNodeType,
} from "./types";
import { EMPTY_SCHEMA } from "./context/schema";

import type { TObject } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Category defaults (applied during registration)
// ---------------------------------------------------------------------------

const CATEGORY_DEFAULTS: Record<
    NodeCategory,
    {
        inputs: { id: string }[];
        outputs: { id: string }[];
        icon: string;
        colorVar: string;
    }
> = {
    trigger: {
        inputs: [],
        outputs: [{ id: "flow-out" }],
        icon: "zap",
        colorVar: "var(--color-green-rgb)",
    },
    action: {
        inputs: [{ id: "flow-in" }],
        outputs: [{ id: "flow-out" }],
        icon: "play",
        colorVar: "var(--color-blue-rgb)",
    },
    control: {
        inputs: [{ id: "flow-in" }],
        outputs: [],
        icon: "git-branch",
        colorVar: "var(--color-yellow-rgb)",
    },
};

/** Display metadata per category (for palette section headers). */
export const CATEGORY_META: Record<NodeCategory, { label: string }> = {
    trigger: { label: "Triggers" },
    action: { label: "Actions" },
    control: { label: "Controls" },
};

// ---------------------------------------------------------------------------
// Registry (populated at runtime via registerNodeType)
// ---------------------------------------------------------------------------

interface RegistryEntry {
    resolved: ResolvedNodeType;
    component: React.ComponentType<NodeProps>;
}

const registry = new Map<string, RegistryEntry>();

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register a node type with the workflow editor.
 *
 * Applies category-based defaults for `inputs`, `outputs`, and `colorVar`,
 * then auto-generates a memoised React Flow component that renders BaseNode
 * with the optional `Body` slot.
 *
 * Throws if the same `type` key is registered twice.
 */
export function registerNodeType<D extends BaseNodeData>(
    nodeType: NodeType<D>,
): void {
    if (registry.has(nodeType.type)) {
        throw new Error(
            `[node-registry] Duplicate node type: "${nodeType.type}"`,
        );
    }

    const defaults = CATEGORY_DEFAULTS[nodeType.category];
    const resolved: ResolvedNodeType = {
        ...nodeType,
        inputs: nodeType.inputs ?? defaults.inputs,
        outputs: nodeType.outputs ?? defaults.outputs,
        colorVar: nodeType.colorVar ?? defaults.colorVar,
        icon: nodeType.icon ?? defaults.icon,
    } as ResolvedNodeType;

    // Auto-generate the React Flow component
    const BodyComponent = nodeType.Body;
    const Shell = nodeType.isCompound ? CompoundNode : BaseNode;
    const GeneratedNode = memo(function GeneratedNode(props: NodeProps) {
        return (
            <Shell nodeProps={props}>
                {BodyComponent && (
                    <BodyComponent data={props.data as unknown as D} />
                )}
            </Shell>
        );
    });
    GeneratedNode.displayName = `${nodeType.displayName.replace(/\s/g, "")}Node`;

    registry.set(nodeType.type, { resolved, component: GeneratedNode });
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Lookup a resolved node type by its `type` key. */
export function getNodeType(type: string): ResolvedNodeType | undefined {
    return registry.get(type)?.resolved;
}

/** Get all resolved node types belonging to a category. */
export function getNodesByCategory(category: NodeCategory): ResolvedNodeType[] {
    return [...registry.values()]
        .map((e) => e.resolved)
        .filter((r) => r.category === category);
}

/**
 * Build the `nodeTypes` map expected by React Flow.
 * Returns `Record<string, React.ComponentType<NodeProps>>`.
 */
export function getRegisteredNodeTypes(): Record<
    string,
    React.ComponentType<NodeProps>
> {
    const types: Record<string, React.ComponentType<NodeProps>> = {};
    for (const [type, entry] of registry) {
        types[type] = entry.component;
    }
    return types;
}

/**
 * Resolve the context output schema for a node instance.
 *
 * Prefers `getContextOutputs(data)` (dynamic) over `contextOutputs` (static).
 * Falls back to `EMPTY_SCHEMA` if neither is defined.
 */
export function resolveContextOutputs(
    type: string,
    data: Record<string, unknown>,
): TObject {
    const entry = registry.get(type);
    if (!entry) return EMPTY_SCHEMA;
    const def = entry.resolved;
    if (def.getContextOutputs) return def.getContextOutputs(data as any);
    return def.contextOutputs ?? EMPTY_SCHEMA;
}

/**
 * Resolve the scoped context output schema for a compound node instance.
 *
 * Scoped outputs are only visible inside the compound's inner sub-graph,
 * not propagated to downstream nodes.
 */
export function resolveScopedContextOutputs(
    type: string,
    data: Record<string, unknown>,
    available?: TObject,
): TObject {
    const entry = registry.get(type);
    if (!entry) return EMPTY_SCHEMA;
    const def = entry.resolved;
    if (def.getScopedContextOutputs)
        return def.getScopedContextOutputs(
            data as any,
            available ?? EMPTY_SCHEMA,
        );
    return def.scopedContextOutputs ?? EMPTY_SCHEMA;
}

/**
 * Resolve the context input schema for a node instance.
 *
 * Prefers `getContextInputs(data)` (dynamic) over `contextInputs` (static).
 * Falls back to `EMPTY_SCHEMA` if neither is defined.
 */
export function resolveContextInputs(
    type: string,
    data: Record<string, unknown>,
): TObject {
    const entry = registry.get(type);
    if (!entry) return EMPTY_SCHEMA;
    const def = entry.resolved;
    if (def.getContextInputs) return def.getContextInputs(data as any);
    return def.contextInputs ?? EMPTY_SCHEMA;
}

/**
 * Resolve the output handles for a node instance.
 *
 * Prefers `getOutputs(data)` (dynamic) over static `outputs`.
 */
export function resolveOutputs(
    type: string,
    data: Record<string, unknown>,
): HandleDef[] {
    const entry = registry.get(type);
    if (!entry) return [];
    const def = entry.resolved;
    if (def.getOutputs) return def.getOutputs(data as any);
    return def.outputs;
}
