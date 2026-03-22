/**
 * Switch Node — routes execution to one of several output handles
 * based on matching an expression value against named cases.
 *
 * Uses `getOutputs(data)` to dynamically create one handle per case
 * plus an optional "Default" handle.
 */

import { Type } from "@sinclair/typebox";
import React from "react";

import { ObsidianIcon } from "ui/ObsidianIcon";
import { interpolate } from "../../context/interpolate";
import {
    PropertySection,
    PropertyField,
    PropertyInput,
    PropertyToggleField,
    PropertyCheckbox,
} from "../../properties/PropertyControls";

import type {
    BaseNodeData,
    HandleDef,
    NodePropertiesProps,
    NodeType,
} from "../../types";

// ---------------------------------------------------------------------------
// Data shape
// ---------------------------------------------------------------------------

interface SwitchCase {
    /** Stable ID used as the output handle identifier. */
    id: string;
    /** User-visible label. */
    label: string;
    /** Value to match against the expression result. */
    value: string;
}

interface SwitchNodeData extends BaseNodeData {
    expression: string;
    cases: SwitchCase[];
    hasDefault: boolean;
    outputName?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateCaseId(): string {
    return `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Properties panel
// ---------------------------------------------------------------------------

function SwitchProperties({ nodeId, data, updateData }: NodePropertiesProps) {
    const d = data as unknown as SwitchNodeData;
    const cases = d.cases ?? [];

    const setCases = (newCases: SwitchCase[]) =>
        updateData({ cases: newCases } as any);

    const addCase = () =>
        setCases([
            ...cases,
            {
                id: generateCaseId(),
                label: `Case ${cases.length + 1}`,
                value: "",
            },
        ]);

    const removeCase = (i: number) =>
        setCases(cases.filter((_, idx) => idx !== i));

    const updateCase = (i: number, patch: Partial<SwitchCase>) =>
        setCases(cases.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

    return (
        <PropertySection title="Switch">
            <PropertyField label="Expression" htmlFor="switch-expr">
                <PropertyInput
                    contextNodeId={nodeId}
                    id="switch-expr"
                    value={d.expression ?? ""}
                    placeholder="{{variable.path}}"
                    onChange={(e) =>
                        updateData({ expression: e.target.value } as any)
                    }
                />
            </PropertyField>

            <PropertyField label="Cases">
                {cases.map((c, i) => (
                    <div key={c.id} className="zotflow-wf-switch-row">
                        <input
                            type="text"
                            value={c.label}
                            placeholder="label"
                            onChange={(e) =>
                                updateCase(i, { label: e.target.value })
                            }
                        />
                        <PropertyInput
                            contextNodeId={nodeId}
                            value={c.value}
                            placeholder="value"
                            onChange={(e) =>
                                updateCase(i, { value: e.target.value })
                            }
                        />
                        <button
                            type="button"
                            className="clickable-icon"
                            onClick={() => removeCase(i)}
                            title="Remove case"
                        >
                            <ObsidianIcon icon="trash-2" />
                        </button>
                    </div>
                ))}
                <button
                    type="button"
                    className="zotflow-wf-switch-add"
                    onClick={addCase}
                >
                    <ObsidianIcon icon="plus" /> Add case
                </button>
            </PropertyField>

            <PropertyToggleField
                label="Default branch"
                htmlFor="switch-default"
            >
                <PropertyCheckbox
                    id="switch-default"
                    checked={d.hasDefault ?? true}
                    onChange={(e) =>
                        updateData({ hasDefault: e.target.checked } as any)
                    }
                />
            </PropertyToggleField>
        </PropertySection>
    );
}

// ---------------------------------------------------------------------------
// Canvas body
// ---------------------------------------------------------------------------

function SwitchBody({ data }: { data: SwitchNodeData }) {
    const cases = data.cases ?? [];
    const expr = data.expression || "(no expression)";

    return (
        <div className="zotflow-wf-switch-body">
            <div className="zotflow-wf-switch-expr">{expr}</div>
            <div className="zotflow-wf-switch-info">
                {cases.length} case{cases.length !== 1 ? "s" : ""}
                {data.hasDefault ? " + default" : ""}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Node type definition
// ---------------------------------------------------------------------------

export const switchNode: NodeType<SwitchNodeData> = {
    type: "switch",
    category: "control",
    displayName: "Switch",
    icon: "list-tree",
    description: "Routes to a matching case",

    getOutputs(data) {
        const handles: HandleDef[] = data.cases.map((c) => ({
            id: c.id,
            label: c.label || c.id,
        }));
        if (data.hasDefault) {
            handles.push({ id: "default", label: "Default" });
        }
        return handles;
    },

    getContextOutputs(data) {
        const key = data.outputName || "switch";

        return Type.Object({
            [key]: Type.Object({
                matched: Type.String({
                    description: "Label of the matched case",
                }),
            }),
        });
    },

    defaultData: {
        label: "Switch",
        description: "Routes to a matching case",
        expression: "",
        outputName: "switch",
        cases: [{ id: "case_1", label: "Case 1", value: "" }],
        hasDefault: true,
    },

    Body: SwitchBody,
    Properties: SwitchProperties,

    async execute(context, data, _signal) {
        const raw = interpolate(data.expression, context);
        const exprValue = String(raw ?? "");

        for (const c of data.cases) {
            const caseValue = String(interpolate(c.value, context) ?? "");
            if (exprValue === caseValue) {
                context.set(`${data.outputName}.matched`, c.label);
                return c.id;
            }
        }

        // No matching case — route to default (or dead end)
        context.set(`${data.outputName}.matched`, "");
        return "default";
    },

    validate(data) {
        const errors: string[] = [];
        if (!data.expression) {
            errors.push("Switch expression is required.");
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
        if (!data.cases || data.cases.length === 0) {
            errors.push("At least one case is required.");
        }
        return errors;
    },
};
