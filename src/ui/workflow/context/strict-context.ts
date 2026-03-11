/**
 * StrictWorkflowContext — runtime implementation of `WorkflowContext`.
 *
 * Enforces declared schemas: `set()` rejects undeclared paths and type
 * mismatches.  `get()` is permissive (returns `undefined` for missing
 * paths without throwing).
 *
 * The internal store is a nested JS object so that `get("trigger")`
 * returns the full trigger namespace while `get("trigger.var1")`
 * returns the specific value.
 */

import { Value } from "@sinclair/typebox/value";
import { Type } from "@sinclair/typebox";
import { LogicEngine } from "json-logic-engine";

const logicEngine = new LogicEngine();

import { resolvePathSchema, mergeSchemas, EMPTY_SCHEMA } from "./schema";
import { ZotFlowError, ZotFlowErrorCode } from "utils/error";

import type { TObject, TSchema } from "@sinclair/typebox";
import type { WorkflowContext } from "../types";

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class StrictWorkflowContext implements WorkflowContext {
    /** Nested object store — mirrors the TObject namespace structure. */
    private store: Record<string, unknown> = {};

    /**
     * Schema describing the variables this node is allowed to write.
     * Set before each node's `execute()` call.
     */
    private allowedOutputs: TObject;

    /** Cumulative schema (available + this node's outputs). For introspection. */
    private cumulativeSchema: TObject;

    constructor(
        allowedOutputs: TObject,
        cumulativeSchema: TObject,
        initialStore?: Record<string, unknown>,
    ) {
        this.allowedOutputs = allowedOutputs;
        this.cumulativeSchema = cumulativeSchema;
        if (initialStore) {
            this.store = structuredClone(initialStore);
        }
    }

    // -----------------------------------------------------------------------
    // WorkflowContext interface
    // -----------------------------------------------------------------------

    get(key: string): unknown {
        return this.resolvePath(key);
    }

    set(key: string, value: unknown): void {
        // Check declaration
        const subSchema = resolvePathSchema(this.allowedOutputs, key);
        if (!subSchema) {
            throw new ZotFlowError(
                ZotFlowErrorCode.CONTEXT_UNDECLARED_WRITE,
                "WorkflowContext",
                `Cannot set "${key}", path is not declared in contextOutputs.`,
            );
        }

        // Type-check against declared schema
        if (!Value.Check(subSchema, value)) {
            const expected = schemaLabel(subSchema);
            throw new ZotFlowError(
                ZotFlowErrorCode.CONTEXT_TYPE_MISMATCH,
                "WorkflowContext",
                `Type mismatch for "${key}": expected ${expected}, got ${typeof value}.`,
            );
        }

        // Write to nested store
        this.setPath(key, value);
    }

    evaluateJsonLogic(logic: unknown): unknown {
        if (!logic) return false;
        try {
            const execute = logicEngine.build(logic);
            return execute(this.store);
        } catch (error) {
            console.error("JsonLogic evaluation error:", error);
            return false;
        }
    }

    getSchema(): TObject {
        return this.cumulativeSchema;
    }

    // -----------------------------------------------------------------------
    // Execution engine helpers
    // -----------------------------------------------------------------------

    /**
     * Create a child context for the next node in execution.
     *
     * Carries forward the current store contents but swaps the allowed
     * output schema for the next node's declarations.
     */
    fork(
        nextAllowedOutputs: TObject,
        nextCumulative: TObject,
    ): StrictWorkflowContext {
        return new StrictWorkflowContext(
            nextAllowedOutputs,
            nextCumulative,
            this.store,
        );
    }

    /** Return a deep clone of the current store (for debugging / logging). */
    snapshot(): Record<string, unknown> {
        return structuredClone(this.store);
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    /** Resolve a dot-path against the nested store. */
    private resolvePath(dotPath: string): unknown {
        const segments = dotPath.split(".");
        let current: unknown = this.store;

        for (const seg of segments) {
            if (current === null || current === undefined) return undefined;
            if (typeof current !== "object") return undefined;
            current = (current as Record<string, unknown>)[seg];
        }

        return current;
    }

    /** Set a value at a dot-path in the nested store, creating intermediaries. */
    private setPath(dotPath: string, value: unknown): void {
        const segments = dotPath.split(".");
        let current: Record<string, unknown> = this.store;

        for (let i = 0; i < segments.length - 1; i++) {
            const seg = segments[i]!;
            if (
                !(seg in current) ||
                typeof current[seg] !== "object" ||
                current[seg] === null
            ) {
                current[seg] = {};
            }
            current = current[seg] as Record<string, unknown>;
        }

        const lastSeg = segments[segments.length - 1]!;
        current[lastSeg] = value;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Produce a human-readable label for a TypeBox schema. */
function schemaLabel(schema: TSchema): string {
    return ((schema as Record<string, unknown>).type as string) ?? "unknown";
}

// ---------------------------------------------------------------------------
// Factory helper for the execution engine
// ---------------------------------------------------------------------------

/**
 * Create an initial `StrictWorkflowContext` for the first node in execution
 * (typically a trigger).
 */
export function createInitialContext(
    allowedOutputs: TObject,
    cumulativeSchema?: TObject,
): StrictWorkflowContext {
    return new StrictWorkflowContext(
        allowedOutputs,
        cumulativeSchema ?? allowedOutputs,
    );
}
