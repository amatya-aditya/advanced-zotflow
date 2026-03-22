/**
 * Node Properties Panel for the workflow editor.
 *
 * Renders common fields (label, description) for any selected node, then
 * delegates to the node-specific `Properties` component registered in
 * the node registry. Shows global workflow settings when nothing is selected.
 */
import React, { useState, useEffect, useCallback } from "react";
import { Panel } from "@xyflow/react";
import { useStore } from "zustand";

import { ObsidianIcon } from "ui/ObsidianIcon";

import type { BaseNodeData } from "../types";
import { getNodeType } from "../node-registry";
import { useWorkflowStoreApi } from "../store-context";
import {
    PropertySection,
    PropertyField,
    PropertyInput,
    PropertyTextarea,
    PropertyCheckbox,
    PropertyToggleField,
    PropertyReadOnlyText,
} from "./PropertyControls";

export function NodePropertiesPanel() {
    const store = useWorkflowStoreApi();
    const [isExpanded, setIsExpanded] = useState(true);

    const nodes = useStore(store, (s) => s.nodes);
    const updateNodeData = useStore(store, (s) => s.updateNodeData);
    const globals = useStore(store, (s) => s.globals);
    const updateGlobals = useStore(store, (s) => s.updateGlobals);
    const validationByNode = useStore(store, (s) => s.validationByNode);
    const validationResults = useStore(store, (s) => s.validationResults);

    // Find the currently selected node
    const selectedNode = nodes.find((n) => n.selected);

    // Auto-expand the panel whenever the selected node changes
    useEffect(() => {
        if (selectedNode) {
            setIsExpanded(true);
        }
    }, [selectedNode?.id]);

    // Stable callback for node-specific Properties components
    const handleUpdateData = useCallback(
        (patch: Partial<BaseNodeData>) => {
            if (selectedNode) {
                updateNodeData(selectedNode.id, patch);
            }
        },
        [selectedNode?.id, updateNodeData],
    );

    // --- Render Global Settings ---
    const renderGlobalSettings = () => {
        return (
            <div
                className={`zotflow-wf-props-content-inner ${isExpanded ? "expanded" : ""}`}
            >
                <PropertySection title="Global Settings">
                    <PropertyField label="Workflow Name" htmlFor="global-name">
                        <PropertyInput
                            id="global-name"
                            value={globals.name}
                            onChange={(e) =>
                                updateGlobals({ name: e.target.value })
                            }
                            placeholder="Workflow Name"
                        />
                    </PropertyField>

                    <PropertyField label="Description" htmlFor="global-desc">
                        <PropertyTextarea
                            id="global-desc"
                            value={globals.description}
                            onChange={(e) =>
                                updateGlobals({ description: e.target.value })
                            }
                            placeholder="Workflow description..."
                            rows={3}
                        />
                    </PropertyField>

                    <PropertyToggleField
                        label="Enabled"
                        htmlFor="global-enabled"
                    >
                        <PropertyCheckbox
                            id="global-enabled"
                            checked={globals.isEnabled}
                            onChange={(e) =>
                                updateGlobals({ isEnabled: e.target.checked })
                            }
                        />
                    </PropertyToggleField>
                </PropertySection>
            </div>
        );
    };

    // --- Render Node Properties ---
    const renderNodeProperties = () => {
        if (!selectedNode) return null;
        const { id, type, data } = selectedNode;

        // Lookup the node-specific properties component from the registry
        const nodeType = getNodeType(type);
        const PropsComponent = nodeType?.Properties;

        return (
            <div
                className={`zotflow-wf-props-content-inner ${isExpanded ? "expanded" : ""}`}
            >
                {/* Common fields — always rendered */}
                <PropertySection title="Node Information">
                    <PropertyField label="Type" htmlFor="node-type" readOnly>
                        <PropertyReadOnlyText value={nodeType?.type ?? type} />
                    </PropertyField>

                    <PropertyField
                        label="Description"
                        htmlFor="node-desc"
                        readOnly
                    >
                        <PropertyReadOnlyText
                            value={data.description ?? ""}
                            placeholder="Optional description"
                            multiline
                        />
                    </PropertyField>

                    <PropertyField label="Label" htmlFor="node-label">
                        <PropertyInput
                            id="node-label"
                            value={data.label}
                            onChange={(e) =>
                                updateNodeData(id, { label: e.target.value })
                            }
                            placeholder="Node Label"
                        />
                    </PropertyField>

                    {nodeType?.defaultData?.outputName !== undefined && (
                        <PropertyField
                            label="Output Name"
                            htmlFor="node-output-name"
                        >
                            <PropertyInput
                                id="node-output-name"
                                value={
                                    (data.outputName as string | undefined) ??
                                    (nodeType.defaultData
                                        .outputName as string) ??
                                    ""
                                }
                                onChange={(e) =>
                                    updateNodeData(id, {
                                        outputName: e.target.value,
                                    })
                                }
                                placeholder="e.g. loop, variables"
                            />
                        </PropertyField>
                    )}
                </PropertySection>

                {/* Node-specific fields — delegated to registered component */}
                {PropsComponent && (
                    <PropsComponent
                        nodeId={id}
                        data={data}
                        updateData={handleUpdateData}
                    />
                )}
            </div>
        );
    };

    const def = selectedNode ? getNodeType(selectedNode.type) : undefined;
    const title = selectedNode
        ? `${def?.displayName ?? selectedNode.type} Properties`
        : "Global Settings";

    return (
        <Panel
            position="top-right"
            className="zotflow-wf-props-panel"
            onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
            onDrop={(e) => {
                e.stopPropagation();
            }}
        >
            <div className="zotflow-wf-props-header">
                <div
                    className="zotflow-wf-props-title-wrapper"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div className="zotflow-wf-props-title">{title}</div>
                    <div
                        className={`zotflow-wf-props-toggle-icon ${isExpanded ? "expanded" : ""}`}
                    >
                        <ObsidianIcon icon="chevron-down" />
                    </div>
                </div>

                {(() => {
                    const errorsToShow = selectedNode
                        ? (validationByNode.get(selectedNode.id) ?? [])
                        : validationResults.filter((r) => !r.nodeId);

                    if (errorsToShow.length === 0) return null;

                    return (
                        <div className="zotflow-wf-validation-list">
                            {errorsToShow.map((err, i) => (
                                <div
                                    key={i}
                                    className={`zotflow-wf-validation-${err.level}`}
                                >
                                    <ObsidianIcon
                                        icon={
                                            err.level === "error"
                                                ? "alert-circle"
                                                : "alert-triangle"
                                        }
                                    />
                                    <span>{err.message}</span>
                                </div>
                            ))}
                        </div>
                    );
                })()}
            </div>

            <div
                className={`zotflow-wf-props-content ${isExpanded ? "expanded" : "collapsed"}`}
            >
                {selectedNode ? renderNodeProperties() : renderGlobalSettings()}
            </div>
        </Panel>
    );
}
