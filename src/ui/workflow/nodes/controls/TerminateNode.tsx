/**
 * Terminate Node — stops workflow execution immediately.
 *
 * Returns the special `TERMINATE_HANDLE` value that the engine
 * recognises as an early-exit signal. The node has no output handles
 * (dead end on the canvas).
 */

import React from "react";

import { ObsidianIcon } from "ui/ObsidianIcon";
import {
    PropertySection,
    PropertyField,
    PropertyInput,
} from "../../properties/PropertyControls";
import { TERMINATE_HANDLE } from "../../execution/types";

import type { BaseNodeData, NodePropertiesProps, NodeType } from "../../types";

// ---------------------------------------------------------------------------
// Data shape
// ---------------------------------------------------------------------------

interface TerminateNodeData extends BaseNodeData {
    status: "success" | "failure";
    message: string;
}

// ---------------------------------------------------------------------------
// Properties panel
// ---------------------------------------------------------------------------

function TerminateProperties({
    nodeId,
    data,
    updateData,
}: NodePropertiesProps) {
    const d = data as unknown as TerminateNodeData;

    return (
        <PropertySection title="Termination">
            <PropertyField label="Status" htmlFor="terminate-status">
                <select
                    id="terminate-status"
                    className="dropdown"
                    value={d.status ?? "success"}
                    onChange={(e) =>
                        updateData({ status: e.target.value } as any)
                    }
                >
                    <option value="success">Success</option>
                    <option value="failure">Failure</option>
                </select>
            </PropertyField>
            <PropertyField label="Message" htmlFor="terminate-message">
                <PropertyInput
                    contextNodeId={nodeId}
                    id="terminate-message"
                    value={d.message ?? ""}
                    placeholder="Optional termination message"
                    onChange={(e) =>
                        updateData({ message: e.target.value } as any)
                    }
                />
            </PropertyField>
        </PropertySection>
    );
}

// ---------------------------------------------------------------------------
// Canvas body
// ---------------------------------------------------------------------------

function TerminateBody({ data }: { data: TerminateNodeData }) {
    const status = data.status ?? "success";
    return (
        <div className="zotflow-wf-terminate-summary">
            <ObsidianIcon
                icon={status === "success" ? "check-circle" : "x-circle"}
            />
            <span>{status === "success" ? "Success" : "Failure"}</span>
            {data.message && (
                <span className="zotflow-wf-terminate-msg">{data.message}</span>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Node type definition
// ---------------------------------------------------------------------------

export const terminateNode: NodeType<TerminateNodeData> = {
    type: "terminate",
    category: "control",
    displayName: "Terminate",
    icon: "octagon-x",
    description: "Stops workflow execution",
    outputs: [],

    defaultData: {
        label: "Terminate",
        description: "Stops workflow execution",
        status: "success",
        message: "",
    },

    Body: TerminateBody,
    Properties: TerminateProperties,

    async execute(_context, _data, _signal) {
        return TERMINATE_HANDLE;
    },

    validate(_data) {
        return [];
    },
};
