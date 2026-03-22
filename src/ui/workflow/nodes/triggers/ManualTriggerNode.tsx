/**
 * Manual Trigger — starts the workflow manually.
 *
 * Outputs Zotero context variables that downstream nodes can reference
 * via template expressions like `{{trigger.itemKey}}`.
 */

import { Type } from "@sinclair/typebox";

import type { BaseNodeData, NodePropertiesProps, NodeType } from "../../types";
import { extractPaths } from "../../context/schema";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ManualTriggerNodeData extends BaseNodeData {}

import {
    PropertySection,
    PropertyField,
} from "../../properties/PropertyControls";

// ---------------------------------------------------------------------------
// Context output schema
// ---------------------------------------------------------------------------

const TRIGGER_OUTPUTS = Type.Object({
    trigger: Type.Object({
        itemKey: Type.String({ description: "Zotero item key" }),
        itemType: Type.String({ description: "Zotero item type" }),
        libraryID: Type.Number({ description: "Zotero library ID" }),
        collectionKey: Type.Optional(
            Type.String({ description: "Parent collection key" }),
        ),
        dateAdded: Type.String({ description: "ISO date when item was added" }),
        testList: Type.Array(Type.Union([Type.Number(), Type.String()]), {
            description: "List of test numbers",
        }),
        testListObject: Type.Array(Type.Object({ id: Type.Number() }), {
            description: "List of test objects",
        }),
    }),
});
// ---------------------------------------------------------------------------
// Properties panel
// ---------------------------------------------------------------------------

function ManualTriggerProperties(_props: NodePropertiesProps) {
    const paths = extractPaths(TRIGGER_OUTPUTS);
    const leaves = paths.filter((p) => p.type !== "object");

    if (leaves.length === 0) return null;

    return (
        <PropertySection title="Context Outputs">
            {leaves.map((p) => (
                <PropertyField key={p.path} label={p.path} readOnly>
                    <span>
                        {p.type}
                        {p.optional ? " (optional)" : ""}
                    </span>
                </PropertyField>
            ))}
        </PropertySection>
    );
}

// ---------------------------------------------------------------------------
// Node type definition
// ---------------------------------------------------------------------------

export const manualTrigger: NodeType<ManualTriggerNodeData> = {
    type: "manual-trigger",
    category: "trigger",
    displayName: "Manual Trigger",
    icon: "zap",
    description: "Starts the workflow manually",
    outputs: [{ id: "flow-out" }],

    contextOutputs: TRIGGER_OUTPUTS,

    defaultData: {
        label: "Manual Trigger",
    },

    Properties: ManualTriggerProperties,

    async execute(context, _data, _signal) {
        // TODO: resolve actual Zotero item from selection/command trigger
        context.set("trigger.itemKey", "");
        context.set("trigger.itemType", "");
        context.set("trigger.libraryID", 0);
        context.set("trigger.collectionKey", "");
        context.set("trigger.dateAdded", "");
        context.set("trigger.testList", [1, 2, 3, "1"]);
        context.set("trigger.testListObject", [{ id: 1 }, { id: 2 }]);

        return "flow-out";
    },
};
