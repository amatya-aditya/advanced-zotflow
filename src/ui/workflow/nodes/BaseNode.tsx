/**
 * BaseNode — shared rendering shell for all workflow node types.
 *
 * Reads the node's definition from the registry and renders:
 *   • Input handles (top)
 *   • Coloured header with icon + label
 *   • Body with description + optional children (custom content)
 *   • Output handle labels (when multiple outputs exist)
 *   • Output handles (bottom, evenly distributed)
 */

import React, { useEffect, useMemo } from "react";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import { useStore } from "zustand";

import { ObsidianIcon } from "../../ObsidianIcon";
import { getNodeType, resolveOutputs } from "../node-registry";
import { useWorkflowStoreApi } from "../store-context";

import type { NodeProps } from "@xyflow/react";
import type { BaseNodeData } from "../types";
import type { ValidationResult } from "../context/validation";

const EMPTY_VALIDATION_RESULTS: ValidationResult[] = [];

export interface BaseNodeChildProps {
    nodeProps: NodeProps;
    children?: React.ReactNode;
}

export function BaseNode({ nodeProps, children }: BaseNodeChildProps) {
    const { id, type, data, selected } = nodeProps;
    const d = data as unknown as BaseNodeData;
    const def = getNodeType(type ?? "action");

    const storeApi = useWorkflowStoreApi();
    const issues = useStore(
        storeApi,
        (s) => s.validationByNode.get(id) ?? EMPTY_VALIDATION_RESULTS,
    );
    const hasErrors = issues.some((i) => i.level === "error");
    const hasWarnings = !hasErrors && issues.length > 0;

    if (!def) return null;

    const outputs = resolveOutputs(
        type ?? "action",
        d as Record<string, unknown>,
    );
    const multiOut = outputs.length > 1;

    // Build a stable key from handle IDs so React Flow rescans when handles change
    const handleKey = useMemo(
        () => outputs.map((h) => h.id).join(","),
        [outputs],
    );
    const updateNodeInternals = useUpdateNodeInternals();
    useEffect(() => {
        updateNodeInternals(id);
    }, [handleKey, id, updateNodeInternals]);

    return (
        <div
            style={{ "--node-color-rgb": def.colorVar } as React.CSSProperties}
            className={`zotflow-wf-node ${selected ? "zotflow-wf-node--selected" : ""}`}
        >
            {/* Input handles */}
            {def.inputs.map((h, i) => (
                <Handle
                    key={h.id}
                    type="target"
                    position={Position.Top}
                    className="zotflow-wf-handle"
                    id={h.id}
                    style={
                        def.inputs.length > 1
                            ? {
                                  left: `${((i + 1) / (def.inputs.length + 1)) * 100}%`,
                              }
                            : undefined
                    }
                />
            ))}

            {/* Header */}
            <div className="zotflow-wf-node-header">
                <ObsidianIcon icon={def.icon} />
                <span className="zotflow-wf-node-title">{d.label}</span>
                {hasErrors && (
                    <span
                        className="zotflow-wf-node-badge zotflow-wf-node-badge--error"
                        title={issues.map((i) => i.message).join("\n")}
                    >
                        <ObsidianIcon icon="alert-circle" />
                    </span>
                )}
                {hasWarnings && (
                    <span
                        className="zotflow-wf-node-badge zotflow-wf-node-badge--warning"
                        title={issues.map((i) => i.message).join("\n")}
                    >
                        <ObsidianIcon icon="alert-triangle" />
                    </span>
                )}
            </div>

            {/* Body */}
            <div className="zotflow-wf-node-body">
                {d.description && (
                    <div className="zotflow-wf-node-desc">{d.description}</div>
                )}
                {children}
            </div>

            {/* Output handle labels (multi-output nodes like condition) */}
            {multiOut && (
                <div className="zotflow-wf-handle-labels">
                    {outputs.map((h) => (
                        <span key={h.id} className="zotflow-wf-handle-label">
                            {h.label ?? h.id}
                        </span>
                    ))}
                </div>
            )}

            {/* Output handles */}
            {outputs.map((h, i) => (
                <Handle
                    key={h.id}
                    type="source"
                    position={Position.Bottom}
                    className="zotflow-wf-handle"
                    id={h.id}
                    style={
                        multiOut
                            ? {
                                  left: `${((i + 1) / (outputs.length + 1)) * 100}%`,
                              }
                            : undefined
                    }
                />
            ))}
        </div>
    );
}
