import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { DOCUMENT_WORKER_PREAMBLE } from "../../scripts/document-worker-compat.mjs";

// Each VM has its own Promise constructor, like the nested Document Worker.
// Removing the API here reproduces the iPad failure without changing Vitest's realm.
function runWithoutNative(script: string): unknown {
    return runInNewContext(
        `delete Promise.withResolvers;\n${DOCUMENT_WORKER_PREAMBLE}\n${script}`,
    ) as unknown;
}

describe("Document Worker Promise.withResolvers compatibility", () => {
    test("supports immediate upstream calls and independent resolver pairs", async () => {
        const result = runWithoutNative(`
            const first = Promise.withResolvers();
            const second = Promise.withResolvers();
            second.resolve(2);
            first.resolve(Promise.resolve(1));
            Promise.all([first.promise, second.promise]);
        `);
        await expect(result).resolves.toEqual([1, 2]);
    });

    test("propagates rejection through the returned promise", async () => {
        const result = runWithoutNative(`
            const pending = Promise.withResolvers();
            pending.reject(new Error("worker failed"));
            pending.promise;
        `);
        await expect(result).rejects.toThrow("worker failed");
    });

    test("uses the calling Promise subclass and a non-enumerable method", () => {
        expect(
            runWithoutNative(`
            class WorkerPromise extends Promise {}
            WorkerPromise.withResolvers().promise instanceof WorkerPromise
                && !Object.getOwnPropertyDescriptor(Promise, "withResolvers").enumerable;
        `),
        ).toBe(true);
    });

    test("preserves an existing implementation", () => {
        const result: unknown = runInNewContext(`
            const original = function withResolvers() {};
            Promise.withResolvers = original;
            ${DOCUMENT_WORKER_PREAMBLE}
            Promise.withResolvers === original;
        `);
        expect(result).toBe(true);
    });
});
