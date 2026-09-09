/**
 * Template expression interpolation — shared by all nodes that need to
 * resolve `{{path}}` references against the runtime workflow context.
 *
 * If the entire string is a single `{{path}}` reference, the raw context
 * value is returned (preserving its original type). Otherwise string
 * interpolation replaces each `{{path}}` with its stringified value.
 */

import { parser } from "./template";

import type { SyntaxNodeRef } from "@lezer/common";
import type { WorkflowContext } from "../types";

/** Renders a context value for inline `{{…}}` substitution. */
export function stringifyContextValue(value: unknown): string {
    if (typeof value === "object") return JSON.stringify(value);
    if (typeof value === "string") return value;
    if (
        typeof value === "number" ||
        typeof value === "bigint" ||
        typeof value === "boolean"
    ) {
        return String(value);
    }
    return "";
}

/**
 * Interpolate template expressions in a string value against the workflow context.
 *
 * @returns The raw context value when `val` is exactly `{{path}}`, otherwise
 *          a string with all `{{…}}` blocks replaced.
 */
export function interpolate(val: string, context: WorkflowContext): unknown {
    const tree = parser.parse(val);
    const rootNode = tree.topNode;

    // If the *entire* string is just a single Variable tag (exact match),
    // return the raw context value to preserve its type (number, boolean, etc.)
    if (
        rootNode?.firstChild?.name === "Variable" &&
        rootNode.firstChild.from === 0 &&
        rootNode.firstChild.to === val.length
    ) {
        const pathNode = rootNode.firstChild.getChild("Path");
        if (pathNode) {
            return context.get(val.slice(pathNode.from, pathNode.to).trim());
        }
    }

    // Otherwise, perform string interpolation
    let out = "";
    let lastPos = 0;
    tree.cursor().iterate((node: SyntaxNodeRef) => {
        if (node.name === "Variable" || node.name === "EscapedBrace") {
            out += val.slice(lastPos, node.from);
            if (node.name === "Variable") {
                const pathNode = node.node.getChild("Path");
                if (pathNode) {
                    const pathStr = val
                        .slice(pathNode.from, pathNode.to)
                        .trim();
                    out += stringifyContextValue(context.get(pathStr));
                }
            } else if (node.name === "EscapedBrace") {
                out += "{{";
            }
            lastPos = node.to;
            return false; // Skip children of this token
        }
        return true;
    });
    out += val.slice(lastPos);
    return out;
}

/**
 * Interpolate a template expression and render the result as a string.
 *
 * Use this where a node needs text rather than the raw context value; objects
 * are rendered as JSON, matching inline `{{…}}` substitution.
 */
export function interpolateToString(
    val: string,
    context: WorkflowContext,
): string {
    return stringifyContextValue(interpolate(val, context));
}
