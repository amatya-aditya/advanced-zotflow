/**
 * Template expression interpolation — shared by all nodes that need to
 * resolve `{{path}}` references against the runtime workflow context.
 *
 * If the entire string is a single `{{path}}` reference, the raw context
 * value is returned (preserving its original type). Otherwise string
 * interpolation replaces each `{{path}}` with its stringified value.
 */

// @ts-ignore — generated Lezer parser has no type declarations
import { parser } from "./template";

import type { WorkflowContext } from "../types";

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
    tree.cursor().iterate((node: any) => {
        if (node.name === "Variable" || node.name === "EscapedBrace") {
            out += val.slice(lastPos, node.from);
            if (node.name === "Variable") {
                const pathNode = node.node.getChild("Path");
                if (pathNode) {
                    const pathStr = val
                        .slice(pathNode.from, pathNode.to)
                        .trim();
                    const res = context.get(pathStr);
                    out +=
                        typeof res === "object"
                            ? JSON.stringify(res)
                            : String(res ?? "");
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
