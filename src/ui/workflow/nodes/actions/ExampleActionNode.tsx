/**
 * Example Action — a generic placeholder action node.
 *
 * Logs an interpolated message to the plugin log (Activity Center → Logs).
 * The message field supports variable references such as `{{trigger.itemKey}}`.
 */

import { Type } from "@sinclair/typebox";

import { services } from "services/services";

import { interpolateToString } from "../../context/interpolate";
import {
    PropertySection,
    PropertyField,
    PropertyInput,
} from "../../properties/PropertyControls";
import type { BaseNodeData, NodePropertiesProps, NodeType } from "../../types";

interface ExampleActionNodeData extends BaseNodeData {
    message: string;
}

// ---------------------------------------------------------------------------
// Properties panel
// ---------------------------------------------------------------------------

function ExampleActionProperties({
    nodeId,
    data,
    updateData,
}: NodePropertiesProps) {
    const d = data as unknown as ExampleActionNodeData;
    return (
        <PropertySection title="Configuration">
            <PropertyField label="Message" htmlFor="example-action-message">
                <PropertyInput
                    contextNodeId={nodeId}
                    value={d.message}
                    placeholder="e.g. {{trigger.itemKey}}"
                    onChange={(e) => updateData({ message: e.target.value })}
                />
            </PropertyField>
        </PropertySection>
    );
}

// ---------------------------------------------------------------------------
// Node type definition
// ---------------------------------------------------------------------------

export const exampleAction: NodeType<ExampleActionNodeData> = {
    type: "example-action",
    category: "action",
    displayName: "Example Action",
    icon: "play",
    description: "Logs a message to the plugin log",

    contextOutputs: Type.Object({}),

    defaultData: {
        label: "Example Action",
        message: "",
    },

    Properties: ExampleActionProperties,

    async execute(context, data, _signal) {
        const output = interpolateToString(data.message, context);
        services.logService.info(output, "Example Action");
        return "flow-out";
    },
};
