/**
 * CompoundNode — rendering shell for compound (group) node types.
 *
 * Compound nodes act as containers: they render a header with handles,
 * plus an inner area that holds child nodes. React Flow's `parentId`
 * mechanism groups children inside the compound, and `NodeResizer`
 * lets the user resize the container.
 */

import React from "react";
import { Handle, NodeResizer, Position } from "@xyflow/react";
import { useStore } from "zustand";

import { ObsidianIcon } from "../../ObsidianIcon";
import { getNodeType, resolveOutputs } from "../node-registry";
import { useWorkflowStoreApi } from "../store-context";

import type { NodeProps } from "@xyflow/react";
import type { BaseNodeData } from "../types";
import type { ValidationResult } from "../context/validation";

const EMPTY_VALIDATION_RESULTS: ValidationResult[] = [];

export interface CompoundNodeChildProps {
    nodeProps: NodeProps;
    children?: React.ReactNode;
}

export function CompoundNode({ nodeProps, children }: CompoundNodeChildProps) {
    const { id, type, data, selected } = nodeProps;
    const d = data as unknown as BaseNodeData;
    const def = getNodeType(type ?? "control");

    const storeApi = useWorkflowStoreApi();
    const issues = useStore(
        storeApi,
        (s) => s.validationByNode.get(id) ?? EMPTY_VALIDATION_RESULTS,
    );
    const hasErrors = issues.some((i) => i.level === "error");
    const hasWarnings = !hasErrors && issues.length > 0;

    if (!def) return null;

    const outputs = resolveOutputs(
        type ?? "control",
        d as Record<string, unknown>,
    );
    const multiOut = outputs.length > 1;

    return (
        <div
            style={{ "--node-color-rgb": def.colorVar } as React.CSSProperties}
            className={`zotflow-wf-compound ${selected ? "zotflow-wf-compound--selected" : ""}`}
        >
            <NodeResizer
                minWidth={300}
                minHeight={200}
                isVisible={selected ?? false}
                lineClassName="zotflow-wf-compound-resize-line"
                handleClassName="zotflow-wf-compound-resize-handle"
            />

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
            <div className="zotflow-wf-compound-header">
                <ObsidianIcon icon={def.icon} />
                <span className="zotflow-wf-compound-title">{d.label}</span>
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

            {/* Optional body content (e.g. config summary) */}
            {children && (
                <div className="zotflow-wf-compound-body">{children}</div>
            )}

            {/* Inner canvas area — child nodes are rendered here by React Flow */}
            <div className="zotflow-wf-compound-inner" />

            {/* Output handle labels (multi-output nodes) */}
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
