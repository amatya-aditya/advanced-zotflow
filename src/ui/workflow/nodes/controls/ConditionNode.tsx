/**
 * Condition Node — branches execution based on a condition expression.
 *
 * Routes execution to the "True" or "False" output handle depending
 * on the evaluated `condition` expression at runtime.
 */

import { Type } from "@sinclair/typebox";
import React from "react";
import { QueryBuilder, ValueEditor } from "react-querybuilder";
import { formatQuery } from "react-querybuilder/formatQuery";
import type { RuleGroupType, ValueEditorProps } from "react-querybuilder";
import { useStore } from "zustand";

import { useWorkflowStoreApi } from "../../store-context";
import { getAvailableContextPaths } from "../../context/context-query";
import { resolvePathSchema } from "../../context/schema";
import { ObsidianIcon } from "ui/ObsidianIcon";
import { PropertyInput } from "../../properties/PropertyControls";
import { interpolate } from "../../context/interpolate";

import type { BaseNodeData, NodePropertiesProps, NodeType } from "../../types";
import type { RuleType } from "react-querybuilder";
import type { TSchema } from "@sinclair/typebox";
import { Kind } from "@sinclair/typebox";

interface ConditionNodeData extends BaseNodeData {
    condition: RuleGroupType;
}

import {
    PropertySection,
    PropertyField,
} from "../../properties/PropertyControls";

// ---------------------------------------------------------------------------
// Properties panel
// ---------------------------------------------------------------------------

const RemoveAction = (props: any) => (
    <button
        type="button"
        className={props.className}
        title={props.title}
        onClick={(e) => props.handleOnClick(e)}
        disabled={props.disabled}
    >
        <ObsidianIcon icon="trash-2" />
    </button>
);

const CustomValueEditor = (props: ValueEditorProps) => {
    const nodeId = props.context?.nodeId;

    if (props.operator === "null" || props.operator === "notNull") {
        return null;
    }

    if (props.operator === "between" || props.operator === "notBetween") {
        const valArray = Array.isArray(props.value)
            ? props.value
            : typeof props.value === "string"
              ? props.value.split(",")
              : ["", ""];
        const v1 = valArray[0] ?? "";
        const v2 = valArray[1] ?? "";

        return (
            <div
                style={{
                    display: "flex",
                    gap: "var(--rqb-spacing, 8px)",
                    width: "100%",
                }}
            >
                <PropertyInput
                    contextNodeId={nodeId}
                    value={v1}
                    onChange={(e) => props.handleOnChange([e.target.value, v2])}
                />
                <PropertyInput
                    contextNodeId={nodeId}
                    value={v2}
                    onChange={(e) => props.handleOnChange([v1, e.target.value])}
                />
            </div>
        );
    }

    if (props.type !== "text") {
        return <ValueEditor {...props} />;
    }

    return (
        <PropertyInput
            contextNodeId={nodeId}
            value={props.value || ""}
            onChange={(e) => props.handleOnChange(e.target.value)}
        />
    );
};

const CustomFieldSelector = (props: any) => {
    const nodeId: string | undefined = props.context?.nodeId;
    const store = useWorkflowStoreApi();
    const nodes = useStore(store, (s) => s.nodes);
    const edges = useStore(store, (s) => s.edges);

    const paths = React.useMemo(
        () => (nodeId ? getAvailableContextPaths(nodeId, nodes, edges) : []),
        [nodeId, nodes, edges],
    );

    return (
        <select
            className={props.className}
            value={props.value || ""}
            onChange={(e) => props.handleOnChange(e.target.value)}
        >
            <option value="">Select field…</option>
            {paths.map((p) => (
                <option key={p.path} value={p.path}>
                    {p.path} ({p.type})
                </option>
            ))}
        </select>
    );
};

function ConditionProperties({
    nodeId,
    data,
    updateData,
}: NodePropertiesProps) {
    const d = data as unknown as ConditionNodeData;

    const handleQueryChange = (query: RuleGroupType) => {
        updateData({ condition: query as any });
    };

    const initialQuery: RuleGroupType =
        typeof d.condition === "object"
            ? d.condition
            : { combinator: "and", rules: [] };

    return (
        <PropertySection title="Branching">
            <PropertyField label="Condition" htmlFor="node-condition">
                <div className="zotflow-query-builder">
                    <QueryBuilder
                        context={{ nodeId }}
                        fields={[]}
                        query={initialQuery}
                        onQueryChange={handleQueryChange}
                        resetOnFieldChange={false}
                        resetOnOperatorChange={false}
                        controlClassnames={{
                            valueSelector: "dropdown",
                            operators: "dropdown",
                            combinators: "dropdown",
                        }}
                        controlElements={{
                            removeRuleAction: RemoveAction,
                            removeGroupAction: RemoveAction,
                            valueEditor: CustomValueEditor,
                            fieldSelector: CustomFieldSelector,
                        }}
                    />
                </div>
            </PropertyField>
        </PropertySection>
    );
}

// ---------------------------------------------------------------------------
// Canvas body (inline summary)
// ---------------------------------------------------------------------------

const OPERATOR_LABELS: Record<string, string> = {
    "=": "=",
    "!=": "\u2260",
    "<": "<",
    ">": ">",
    "<=": "\u2264",
    ">=": "\u2265",
    contains: "contains",
    beginsWith: "starts with",
    endsWith: "ends with",
    doesNotContain: "\u2209",
    null: "is null",
    notNull: "is not null",
    in: "in",
    notIn: "not in",
    between: "between",
    notBetween: "not between",
};

function summarizeRule(rule: RuleType): string {
    const field = rule.field || "?";
    const op = OPERATOR_LABELS[rule.operator] ?? rule.operator;
    if (rule.operator === "null" || rule.operator === "notNull") {
        return `${field} ${op}`;
    }
    const val = Array.isArray(rule.value)
        ? rule.value.join(", ")
        : String(rule.value ?? "");
    return `${field} ${op} ${val}`;
}

function countRules(group: RuleGroupType): number {
    let count = 0;
    for (const r of group.rules) {
        if ("rules" in r) count += countRules(r as RuleGroupType);
        else count++;
    }
    return count;
}

function ConditionBody({ data }: { data: ConditionNodeData }) {
    const cond = data.condition;
    if (!cond?.rules?.length) {
        return (
            <div className="zotflow-wf-condition-summary zotflow-wf-condition-summary--empty">
                No rules defined
            </div>
        );
    }

    const total = countRules(cond);
    // Show up to 3 top-level rules inline
    const MAX_VISIBLE = 3;
    const topRules = cond.rules.filter((r): r is RuleType => !("rules" in r));
    const topGroups = cond.rules.filter(
        (r): r is RuleGroupType => "rules" in r,
    );

    return (
        <div className="zotflow-wf-condition-summary">
            {topRules.slice(0, MAX_VISIBLE).map((rule, i) => (
                <React.Fragment key={i}>
                    {i > 0 && (
                        <span className="zotflow-wf-condition-combinator">
                            {cond.combinator}
                        </span>
                    )}
                    <div className="zotflow-wf-condition-rule">
                        {summarizeRule(rule)}
                    </div>
                </React.Fragment>
            ))}
            {topGroups.length > 0 && (
                <span className="zotflow-wf-condition-more">
                    +{topGroups.length} group{topGroups.length > 1 ? "s" : ""}
                </span>
            )}
            {topRules.length > MAX_VISIBLE && (
                <span className="zotflow-wf-condition-more">
                    +{topRules.length - MAX_VISIBLE} more
                </span>
            )}
            {total > 1 && (
                <span className="zotflow-wf-condition-count">
                    {total} rule{total > 1 ? "s" : ""} total
                </span>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Node type definition
// ---------------------------------------------------------------------------

export const conditionNode: NodeType<ConditionNodeData> = {
    type: "condition",
    category: "control",
    displayName: "Condition",
    icon: "git-branch",
    description: "Branches based on a condition",
    outputs: [
        { id: "true", label: "True" },
        { id: "false", label: "False" },
    ],

    contextOutputs: Type.Object({
        result: Type.Boolean({
            description: "Result of the condition evaluation",
        }),
    }),

    defaultData: {
        label: "Condition",
        description: "Branches based on a condition",
        condition: { combinator: "and", rules: [] },
    },

    Body: ConditionBody,
    Properties: ConditionProperties,

    async execute(context, data, _signal) {
        if (!data.condition || typeof data.condition !== "object") {
            context.set("result", false);
            return "false";
        }

        const sanitizeCondition = (ruleObj: any): any => {
            if (!ruleObj || typeof ruleObj !== "object") return ruleObj;
            if (Array.isArray(ruleObj.rules)) {
                return {
                    ...ruleObj,
                    rules: ruleObj.rules.map(sanitizeCondition),
                };
            }
            const newObj = { ...ruleObj };

            // Field is always a context variable path (selected from dropdown).
            // No transformation needed — formatQuery will wrap it in {"var": ...}.

            // Coerce the value to match the field's schema type so that
            // jsonlogic comparisons (=, <, in, contains, etc.) work correctly.
            const coerceValue = (raw: any): any => {
                if (typeof newObj.field !== "string" || !newObj.field)
                    return raw;
                const fieldSchema = resolvePathSchema(
                    context.getSchema(),
                    newObj.field,
                );
                if (!fieldSchema) return raw;

                // For array fields, coerce against the element type
                const targetSchema: TSchema =
                    (fieldSchema as any)[Kind] === "Array" &&
                    (fieldSchema as any).items
                        ? (fieldSchema as any).items
                        : fieldSchema;
                const targetKind = (targetSchema as any)[Kind] as string;

                if (typeof raw === "string") {
                    switch (targetKind) {
                        case "Number":
                        case "Integer": {
                            const n = Number(raw);
                            return isNaN(n) ? raw : n;
                        }
                        case "Boolean":
                            return raw === "true";
                        default:
                            return raw;
                    }
                }
                return raw;
            };

            // Interpolate Value then coerce to field's schema type
            if (typeof newObj.value === "string") {
                newObj.value = coerceValue(interpolate(newObj.value, context));
            } else if (Array.isArray(newObj.value)) {
                newObj.value = newObj.value.map((v: any) =>
                    typeof v === "string"
                        ? coerceValue(interpolate(v, context))
                        : v,
                );
            }
            return newObj;
        };

        const sanitizedCondition = sanitizeCondition(data.condition);
        const jsonLogic = formatQuery(sanitizedCondition, "jsonlogic");
        const result = context.evaluateJsonLogic(jsonLogic);
        const boolResult = Boolean(result);
        context.set("result", boolResult);
        console.log("Condition evaluated:", {
            condition: data.condition,
            sanitizedCondition,
            jsonLogic,
            result,
        });
        return boolResult ? "true" : "false";
    },

    validate(data) {
        if (
            !data.condition ||
            typeof data.condition !== "object" ||
            !data.condition.rules ||
            data.condition.rules.length === 0
        ) {
            return ["Condition expression is required"];
        }
        return [];
    },
};
