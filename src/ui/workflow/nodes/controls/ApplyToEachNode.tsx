/**
 * Apply to Each Node — compound loop that iterates over a collection.
 *
 * Sets `loop.item` and `loop.index` on each iteration, then executes
 * the inner sub-graph chain. Uses `isCompound: true` so it renders
 * as a container via `CompoundNode`.
 */

import { Type } from "@sinclair/typebox";
import React, { useMemo } from "react";
import { useStore } from "zustand";

import {
    PropertySection,
    PropertyField,
} from "../../properties/PropertyControls";
import { getAvailableArrayPaths } from "../../context/context-query";
import { resolvePathSchema } from "../../context/schema";
import { useWorkflowStoreApi } from "../../store-context";

import type { BaseNodeData, NodePropertiesProps, NodeType } from "../../types";

// ---------------------------------------------------------------------------
// Data shape
// ---------------------------------------------------------------------------

interface ApplyToEachData extends BaseNodeData {
    /** Dot-path to the array variable in context. */
    collectionPath: string;
}

// ---------------------------------------------------------------------------
// Properties panel
// ---------------------------------------------------------------------------

function ApplyToEachProperties({
    nodeId,
    data,
    updateData,
}: NodePropertiesProps) {
    const d = data as unknown as ApplyToEachData;
    const storeApi = useWorkflowStoreApi();
    const nodes = useStore(storeApi, (s) => s.nodes);
    const edges = useStore(storeApi, (s) => s.edges);

    const arrayPaths = useMemo(
        () => getAvailableArrayPaths(nodeId, nodes, edges),
        [nodeId, nodes, edges],
    );

    return (
        <PropertySection title="Apply to Each">
            <PropertyField label="Collection" htmlFor="loop-collection">
                <select
                    className="dropdown"
                    id="loop-collection"
                    value={d.collectionPath ?? ""}
                    onChange={(e) =>
                        updateData({ collectionPath: e.target.value } as any)
                    }
                >
                    <option value="">— Select a list —</option>
                    {arrayPaths.map((p) => (
                        <option key={p.path} value={p.path}>
                            {p.path}
                            {p.description ? ` (${p.description})` : ""}
                        </option>
                    ))}
                </select>
            </PropertyField>
        </PropertySection>
    );
}

// ---------------------------------------------------------------------------
// Canvas body
// ---------------------------------------------------------------------------

function ApplyToEachBody({ data }: { data: ApplyToEachData }) {
    const path = data.collectionPath || "(no collection)";
    return (
        <div className="zotflow-wf-loop-body">
            <span className="zotflow-wf-loop-icon">↻</span>
            <span className="zotflow-wf-loop-path">{path}</span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Node type definition
// ---------------------------------------------------------------------------

export const applyToEachNode: NodeType<ApplyToEachData> = {
    type: "apply-to-each",
    category: "control",
    displayName: "Apply to Each",
    icon: "repeat",
    description: "Iterate over a collection",
    isCompound: true,

    outputs: [{ id: "flow-out" }],

    getScopedContextOutputs(data, available) {
        // Scoped: only visible inside the loop body, not downstream.
        // The user-configurable `outputName` determines the namespace key.
        const key = data.outputName || "loop";

        // Infer the element type from the collection's array schema.
        let itemType = Type.Unknown({ description: "Current item" });
        if (data.collectionPath) {
            const arraySchema = resolvePathSchema(
                available,
                data.collectionPath,
            );
            if (arraySchema && (arraySchema as any).items) {
                itemType = (arraySchema as any).items;
            }
        }

        return Type.Object({
            [key]: Type.Object({
                item: itemType,
                index: Type.Number({ description: "Current index" }),
            }),
        });
    },

    defaultData: {
        label: "Apply to Each",
        description: "Iterate over a collection",
        collectionPath: "",
        outputName: "loop",
    },

    Body: ApplyToEachBody,
    Properties: ApplyToEachProperties,

    async execute(_context, _data, _signal) {
        // The actual loop is handled by the engine's executeApplyToEach().
        // This execute() just returns the output handle for routing.
        return "flow-out";
    },

    validate(data) {
        const errors: string[] = [];
        if (!data.collectionPath) {
            errors.push("Collection path is required.");
        }
        if (
            data.outputName !== undefined &&
            data.outputName !== "" &&
            !/^[a-zA-Z_]\w*$/.test(data.outputName)
        ) {
            errors.push(
                `Output name "${data.outputName}" is not a valid identifier.`,
            );
        }
        return errors;
    },
};
