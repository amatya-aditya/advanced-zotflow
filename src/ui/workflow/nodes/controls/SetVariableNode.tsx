/**
 * Set Variable Node — writes one or more typed values to the shared context.
 *
 * Each variable is stored under the `variables.{name}` namespace so
 * downstream nodes can reference them via `{{variables.count}}` etc.
 * Values support template expressions (e.g. `{{trigger.itemKey}}`).
 */

import { Type } from "@sinclair/typebox";
import React from "react";

import { ObsidianIcon } from "ui/ObsidianIcon";
import { interpolate } from "../../context/interpolate";
import {
    PropertySection,
    PropertyInput,
    PropertyField,
} from "../../properties/PropertyControls";

import type { TSchema } from "@sinclair/typebox";
import type { BaseNodeData, NodePropertiesProps, NodeType } from "../../types";

// ---------------------------------------------------------------------------
// Data shape
// ---------------------------------------------------------------------------

interface VariableEntry {
    name: string;
    type: "string" | "number" | "boolean";
    value: string;
}

interface SetVariableNodeData extends BaseNodeData {
    variables: VariableEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTypeSchema(type: string): TSchema {
    switch (type) {
        case "number":
            return Type.Number();
        case "boolean":
            return Type.Boolean();
        default:
            return Type.String();
    }
}

// ---------------------------------------------------------------------------
// Properties panel
// ---------------------------------------------------------------------------

function SetVariableProperties({
    nodeId,
    data,
    updateData,
}: NodePropertiesProps) {
    const d = data as unknown as SetVariableNodeData;
    const vars = d.variables ?? [];

    const setVars = (newVars: VariableEntry[]) =>
        updateData({ variables: newVars } as any);

    const addVar = () =>
        setVars([...vars, { name: "", type: "string", value: "" }]);

    const removeVar = (i: number) =>
        setVars(vars.filter((_, idx) => idx !== i));

    const updateVar = (i: number, patch: Partial<VariableEntry>) =>
        setVars(vars.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));

    return (
        <PropertySection title="Configuration">
            <PropertyField label="Variables" htmlFor="setvar-variables">
                {vars.map((v, i) => (
                    <div key={i} className="zotflow-wf-setvar-row">
                        <div className="zotflow-wf-setvar-inputs">
                            <input
                                type="text"
                                value={v.name}
                                placeholder="name"
                                onChange={(e) =>
                                    updateVar(i, { name: e.target.value })
                                }
                            />
                            <select
                                className="dropdown"
                                value={v.type}
                                onChange={(e) =>
                                    updateVar(i, {
                                        type: e.target
                                            .value as VariableEntry["type"],
                                    })
                                }
                            >
                                <option value="string">String</option>
                                <option value="number">Number</option>
                                <option value="boolean">Boolean</option>
                            </select>
                            <PropertyInput
                                contextNodeId={nodeId}
                                value={v.value}
                                placeholder="value"
                                onChange={(e) =>
                                    updateVar(i, { value: e.target.value })
                                }
                            />
                        </div>
                        <button
                            type="button"
                            className="clickable-icon"
                            onClick={() => removeVar(i)}
                            title="Remove variable"
                        >
                            <ObsidianIcon icon="trash-2" />
                        </button>
                    </div>
                ))}
                <button
                    type="button"
                    className="zotflow-wf-setvar-add"
                    onClick={addVar}
                >
                    <ObsidianIcon icon="plus" /> Add variable
                </button>
            </PropertyField>
        </PropertySection>
    );
}

// ---------------------------------------------------------------------------
// Canvas body (inline summary)
// ---------------------------------------------------------------------------

function SetVariableBody({ data }: { data: SetVariableNodeData }) {
    const vars = data.variables ?? [];
    if (vars.length === 0) {
        return (
            <div className="zotflow-wf-setvar-body zotflow-wf-setvar-body--empty">
                No variables defined
            </div>
        );
    }

    return (
        <div className="zotflow-wf-setvar-body">
            {vars.slice(0, 4).map((v, i) => (
                <div key={i} className="zotflow-wf-setvar-assignment">
                    <span className="zotflow-wf-setvar-name">
                        {v.name || "?"}
                    </span>
                    <span className="zotflow-wf-setvar-arrow">&larr;</span>
                    <span className="zotflow-wf-setvar-value">
                        {v.value || `(${v.type})`}
                    </span>
                </div>
            ))}
            {vars.length > 4 && (
                <span className="zotflow-wf-setvar-more">
                    +{vars.length - 4} more
                </span>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Node type definition
// ---------------------------------------------------------------------------

export const setVariableNode: NodeType<SetVariableNodeData> = {
    type: "set-variable",
    category: "control",
    displayName: "Set Variable",
    icon: "variable",
    description: "Writes values to context variables",
    outputs: [{ id: "flow-out" }],

    defaultData: {
        label: "Set Variable",
        description: "Writes values to context variables",
        variables: [],
        outputName: "variables",
    },

    getContextOutputs(data) {
        const key = data.outputName || "variables";
        const props: Record<string, TSchema> = {};
        for (const v of data.variables) {
            if (!v.name) continue;
            props[v.name] = buildTypeSchema(v.type);
        }
        return Type.Object({
            [key]: Type.Object(props),
        });
    },

    Body: SetVariableBody,
    Properties: SetVariableProperties,

    async execute(context, data, _signal) {
        for (const v of data.variables) {
            if (!v.name) continue;
            const raw = interpolate(v.value, context);
            let coerced: unknown;
            switch (v.type) {
                case "number": {
                    const n = Number(raw);
                    coerced = isNaN(n) ? 0 : n;
                    break;
                }
                case "boolean":
                    coerced = raw === true || raw === "true";
                    break;
                default:
                    coerced = typeof raw === "string" ? raw : String(raw ?? "");
                    break;
            }
            const key = data.outputName || "variables";
            context.set(`${key}.${v.name}`, coerced);
        }
        return "flow-out";
    },

    validate(data) {
        const errors: string[] = [];
        if (
            data.outputName !== undefined &&
            data.outputName !== "" &&
            !/^[a-zA-Z_]\w*$/.test(data.outputName)
        ) {
            errors.push(
                `Output name "${data.outputName}" is not a valid identifier.`,
            );
        }
        if (!data.variables || data.variables.length === 0) {
            errors.push("At least one variable is required.");
            return errors;
        }
        const names = new Set<string>();
        for (const v of data.variables) {
            if (!v.name) {
                errors.push("Variable name cannot be empty.");
            } else if (!/^[a-zA-Z_]\w*$/.test(v.name)) {
                errors.push(`"${v.name}" is not a valid identifier.`);
            } else if (names.has(v.name)) {
                errors.push(`Duplicate variable name: "${v.name}".`);
            }
            names.add(v.name);
        }
        return errors;
    },
};
