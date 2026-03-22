/**
 * Context schema utilities built on TypeBox.
 *
 * Each workflow node declares the context variables it produces
 * (and optionally consumes) as TypeBox `TObject` schemas.  Utilities
 * here merge, flatten, and query those schemas so the editor and
 * runtime engine can validate context access.
 */

import { Type, Kind, OptionalKind } from "@sinclair/typebox";

import type { TObject, TSchema, TProperties } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single flattened context variable path with its schema metadata. */
export interface ContextPath {
    /** Dot-separated path (e.g. `"trigger.var"`). */
    path: string;
    /** JSON Schema `type` keyword (e.g. `"string"`, `"number"`, `"object"`). */
    type: string;
    /** Whether this path is optional (wrapped in `Type.Optional`). */
    optional: boolean;
    /** Description from the schema annotation, if any. */
    description?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the TypeBox Kind from a schema. */
function getKind(schema: TSchema): string {
    return (schema as any)[Kind] as string;
}

/** Unwrap `Type.Optional(...)` to get the inner schema. */
function unwrapOptional(schema: TSchema): {
    inner: TSchema;
    optional: boolean;
} {
    if (
        (schema as unknown as Record<symbol, unknown>)[OptionalKind] ===
        "Optional"
    ) {
        return { inner: schema, optional: true };
    }
    return { inner: schema, optional: false };
}

/** Get a human-friendly type label from a TypeBox schema. */
function schemaTypeLabel(schema: TSchema): string {
    const kind = getKind(schema);
    switch (kind) {
        case "String":
            return "string";
        case "Number":
            return "number";
        case "Integer":
            return "integer";
        case "Boolean":
            return "boolean";
        case "Array":
            return "array";
        case "Object":
            return "object";
        case "Union":
            return "union";
        case "Literal":
            return `literal`;
        default:
            return (schema.type as string) ?? "unknown";
    }
}

// ---------------------------------------------------------------------------
// extractPaths — recursively flatten a schema to dot-paths
// ---------------------------------------------------------------------------

/**
 * Recursively walk a TypeBox schema and return a flat list of all reachable
 * dot-paths with their type metadata.
 *
 * For `Type.Object({ trigger: Type.Object({ var1: Type.String() }) })`,
 * returns:
 * ```
 * [
 *   { path: "trigger",          type: "object",  optional: false },
 *   { path: "trigger.var1",  type: "string",  optional: false },
 * ]
 * ```
 */
export function extractPaths(schema: TSchema, prefix = ""): ContextPath[] {
    const paths: ContextPath[] = [];
    const kind = getKind(schema);

    if (kind === "Object" && schema.properties) {
        const props = schema.properties as TProperties;
        for (const [key, sub] of Object.entries(props)) {
            const fullPath = prefix ? `${prefix}.${key}` : key;
            const { inner, optional } = unwrapOptional(sub);
            const innerKind = getKind(inner);

            paths.push({
                path: fullPath,
                type: schemaTypeLabel(inner),
                optional,
                description: (inner.description as string) ?? undefined,
            });

            // Recurse into nested objects
            if (innerKind === "Object" && inner.properties) {
                paths.push(...extractPaths(inner, fullPath));
            }
        }
    }

    return paths;
}

// ---------------------------------------------------------------------------
// resolvePathSchema — drill into a schema by dot-path
// ---------------------------------------------------------------------------

/**
 * Given a dot-path like `"trigger.var1"`, resolve the sub-schema at that
 * location within the root `TObject`.
 *
 * Returns `undefined` if any segment along the path does not exist.
 */
export function resolvePathSchema(
    schema: TObject,
    dotPath: string,
): TSchema | undefined {
    const segments = dotPath.split(".");
    let current: TSchema = schema;

    for (const seg of segments) {
        const { inner } = unwrapOptional(current);
        const kind = getKind(inner);

        if (kind !== "Object" || !inner.properties) return undefined;

        const next = (inner.properties as TProperties)[seg];
        if (!next) return undefined;

        current = next;
    }

    return current;
}

// ---------------------------------------------------------------------------
// mergeSchemas — deep-merge two TObject schemas
// ---------------------------------------------------------------------------

/**
 * Deep-merge two `TObject` schemas.  When both contain a property with the
 * same key:
 *
 * - If both are `TObject`, recurse.
 * - If one is optional and the other is not, the result is the required one
 *   (widening: if it exists in *any* branch it could be present).
 * - Otherwise the `b` schema wins (last-writer-wins at the same path).
 *
 * This is used to combine upstream node outputs during schema propagation.
 */
export function mergeSchemas(a: TObject, b: TObject): TObject {
    const aProps = (a.properties ?? {}) as TProperties;
    const bProps = (b.properties ?? {}) as TProperties;
    const merged: Record<string, TSchema> = {};

    // Start with all keys from a
    for (const [key, aSchema] of Object.entries(aProps)) {
        const bSchema = bProps[key];
        if (bSchema) {
            merged[key] = mergeProperty(aSchema, bSchema);
        } else {
            merged[key] = aSchema;
        }
    }

    // Add keys only in b
    for (const [key, bSchema] of Object.entries(bProps)) {
        if (!(key in merged)) {
            merged[key] = bSchema;
        }
    }

    return Type.Object(merged);
}

/** Merge two property schemas at the same key. */
function mergeProperty(a: TSchema, b: TSchema): TSchema {
    const aUnwrap = unwrapOptional(a);
    const bUnwrap = unwrapOptional(b);
    const aKind = getKind(aUnwrap.inner);
    const bKind = getKind(bUnwrap.inner);

    // Both objects → deep merge recursively
    if (
        aKind === "Object" &&
        bKind === "Object" &&
        aUnwrap.inner.properties &&
        bUnwrap.inner.properties
    ) {
        const inner = mergeSchemas(
            aUnwrap.inner as TObject,
            bUnwrap.inner as TObject,
        );
        // Optional if *both* sides are optional
        if (aUnwrap.optional && bUnwrap.optional) {
            return Type.Optional(inner);
        }
        return inner;
    }

    // Different types or leaves — b wins
    return b;
}

// ---------------------------------------------------------------------------
// mergeBranchSchemas — merge schemas across conditional branches
// NOT REALLY USED, KEEP FOR LATER JUST IN CASE
// ---------------------------------------------------------------------------

/**
 * Deep-merge two schemas where the second represents a branch that may
 * not execute (conditional path).  Variables only in `branch` become
 * optional; variables in both keep the wider (required) type.
 */
export function mergeBranchSchemas(base: TObject, branch: TObject): TObject {
    const baseProps = (base.properties ?? {}) as TProperties;
    const branchProps = (branch.properties ?? {}) as TProperties;
    const merged: Record<string, TSchema> = {};

    // All base props survive as-is
    for (const [key, schema] of Object.entries(baseProps)) {
        merged[key] = schema;
    }

    // Branch-only props become optional
    for (const [key, schema] of Object.entries(branchProps)) {
        if (key in merged) {
            merged[key] = mergeProperty(merged[key]!, schema);
        } else {
            const { inner } = unwrapOptional(schema);
            merged[key] = Type.Optional(inner);
        }
    }

    return Type.Object(merged);
}

/** Empty context schema. */
export const EMPTY_SCHEMA: TObject = Type.Object({});
