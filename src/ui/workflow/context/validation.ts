/**
 * Design-time workflow validation.
 *
 * Combines schema propagation with expression analysis to detect errors
 * before the workflow is executed (undefined variable references, missing
 * trigger, graph cycles, per-node validation, etc.).
 */

import { resolvePathSchema } from "./schema";
import { propagateSchemas, topologicalSort } from "./propagation";
import { getNodeType } from "../node-registry";
// @ts-ignore
import { parser } from "./template";

import type { WorkflowNode, WorkflowEdge, BaseNodeData } from "../types";
import type { PropagatedSchema } from "./propagation";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Severity of a validation issue. */
export type ValidationLevel = "error" | "warning";

/** A single validation result attached to a specific node. */
export interface ValidationResult {
    /** The node this issue belongs to, or `undefined` for graph-level issues. */
    nodeId?: string;
    /** Severity. */
    level: ValidationLevel;
    /** Human-readable description. */
    message: string;
}

// ---------------------------------------------------------------------------
// Expression variable extraction
// ---------------------------------------------------------------------------

/**
 * Extract all dot-path variable references from template expressions.
 *
 * Finds all `{{ varPath }}` blocks and returns the trimmed variable path.
 * Does **not** attempt to parse filters or complex Liquid expressions —
 * it extracts the first dot-separated identifier from each block.
 *
 * ```
 * extractVariableRefs('{{trigger.itemType}} == "book"')
 * // → ["trigger.itemType"]
 *
 * extractVariableRefs('{{a.b}} and {{c.d}}')
 * // → ["a.b", "c.d"]
 * ```
 */
function extractVariableRefs(expression: string): string[] {
    const refs: string[] = [];
    try {
        const tree = parser.parse(expression);
        tree.cursor().iterate((node: any) => {
            if (node.name === "Path") {
                const pathStr = expression.slice(node.from, node.to).trim();
                refs.push(pathStr);
            }
        });
    } catch (e) {
        console.warn("Failed to parse expression with Lezer:", expression, e);
    }
    return refs;
}

// ---------------------------------------------------------------------------
// Collect template fields from node data
// ---------------------------------------------------------------------------

/**
 * Helper to recursively traverse a react-querybuilder RuleGroupType and extract
 * all 'field' names.
 */
function extractRulesVariableRefs(ruleObj: any): string[] {
    const refs: string[] = [];
    if (!ruleObj || typeof ruleObj !== "object") return refs;

    // Is it a RuleGroup?
    if (Array.isArray(ruleObj.rules)) {
        for (const rule of ruleObj.rules) {
            refs.push(...extractRulesVariableRefs(rule));
        }
    }
    // Is it a Rule?
    else if (typeof ruleObj.field === "string") {
        const fieldRefs = extractVariableRefs(ruleObj.field);
        if (fieldRefs.length > 0) {
            refs.push(fieldRefs[0]!);
        }

        if (typeof ruleObj.value === "string" && ruleObj.value.includes("{{")) {
            refs.push(...extractVariableRefs(ruleObj.value));
        } else if (Array.isArray(ruleObj.value)) {
            for (const v of ruleObj.value) {
                if (typeof v === "string" && v.includes("{{")) {
                    refs.push(...extractVariableRefs(v));
                }
            }
        }
    }

    return refs;
}

/**
 * Scan a node's data payload for variable dependencies.
 * Also checks if the payload has a 'rules' array characteristic of a QueryBuilder condition.
 */
function collectDataVariableRefs(data: BaseNodeData): string[] {
    const refs: string[] = [];
    for (const value of Object.values(data)) {
        if (typeof value === "string" && value.includes("{{")) {
            refs.push(...extractVariableRefs(value));
        } else if (
            value &&
            typeof value === "object" &&
            Array.isArray((value as any).rules)
        ) {
            // It looks like a RuleGroupType object from react-querybuilder
            refs.push(...extractRulesVariableRefs(value));
        }
    }
    return refs;
}

// ---------------------------------------------------------------------------
// Main validation entry point
// ---------------------------------------------------------------------------

/**
 * Validate an entire workflow at design time.
 *
 * Checks performed:
 * 1. **Trigger count** — exactly one trigger node required.
 * 2. **Cycle detection** — graph must be a DAG.
 * 3. **Per-node `validate()`** — delegate to each node type's validator.
 * 4. **Undefined variable references** — template expressions must only
 *    reference variables available from upstream context outputs.
 *
 * Returns an array of `ValidationResult` (empty = no issues).
 */
export function validateWorkflow(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
): ValidationResult[] {
    const results: ValidationResult[] = [];

    // 1. Trigger count
    const triggers = nodes.filter(
        (n) => getNodeType(n.type)?.category === "trigger",
    );
    if (triggers.length === 0) {
        results.push({
            level: "error",
            message: "Workflow must have at least one trigger node.",
        });
    } else if (triggers.length > 1) {
        for (const t of triggers.slice(1)) {
            results.push({
                nodeId: t.id,
                level: "error",
                message: "Only one trigger node is allowed per workflow.",
            });
        }
    }

    // 2. Cycle detection
    const sorted = topologicalSort(nodes, edges);
    if (sorted.length < nodes.length) {
        const inCycle = new Set(
            nodes.map((n) => n.id).filter((id) => !sorted.includes(id)),
        );
        for (const id of inCycle) {
            results.push({
                nodeId: id,
                level: "error",
                message: "Node is part of a cycle — workflows must be acyclic.",
            });
        }
    }

    // 3–4. Per-node checks (need propagated schemas for variable validation)
    let schemas: Map<string, PropagatedSchema>;
    try {
        schemas = propagateSchemas(nodes, edges);
    } catch {
        results.push({
            level: "error",
            message: "Failed to propagate context schemas.",
        });
        return results;
    }

    for (const node of nodes) {
        const def = getNodeType(node.type);
        if (!def) {
            results.push({
                nodeId: node.id,
                level: "error",
                message: `Unknown node type "${node.type}".`,
            });
            continue;
        }

        // 3. Per-node validate()
        if (def.validate) {
            const nodeErrors = def.validate(node.data);
            for (const msg of nodeErrors) {
                results.push({ nodeId: node.id, level: "error", message: msg });
            }
        }

        // 4. Undefined variable references
        const prop = schemas.get(node.id);
        if (!prop) continue;

        const refs = collectDataVariableRefs(node.data);
        for (const ref of refs) {
            const resolved = resolvePathSchema(prop.available, ref);
            if (!resolved) {
                results.push({
                    nodeId: node.id,
                    level: "error",
                    message: `Variable "{{${ref}}}" is not available — no upstream node provides it.`,
                });
            }
        }
    }

    return results;
}
