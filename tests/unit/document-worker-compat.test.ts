import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import {
    DOCUMENT_WORKER_PREAMBLE,
    patchDocumentWorkerScript,
} from "bundle-assets/patch-inlined-assets";

// Each VM has its own Promise constructor, like the nested Document Worker.
// Removing the API here reproduces the iPad failure without changing Vitest's realm.
function runWithoutNative(script: string): unknown {
    return runInNewContext(
        `delete Promise.withResolvers;
        const iteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
        for (const name of ["flatMap", "some", "find"]) delete iteratorPrototype[name];
        delete globalThis.Iterator;
        ${DOCUMENT_WORKER_PREAMBLE}\n${script}`,
    ) as unknown;
}

describe("Document Worker SDT layout fallback", () => {
    // The two recorders in the pinned worker differ in their local names and
    // return values. Keep both shapes here to exercise the resource patch.
    const recorders = `
        function recordInference(t,e,n) {
            const i={type:"text_only_layout",pageIndex:t.pageIndex,pageNumber:t.pageIndex+1,...n};
            return e&&(e.layoutFallbacks||=[],e.layoutFallbacks.push(i)),i;
        }
        function recordLimit(t,e,n) {
            const s={type:"text_only_layout",pageIndex:t.pageIndex,pageNumber:t.pageIndex+1,...n};
            e&&(e.layoutFallbacks||=[],e.layoutFallbacks.push(s));
        }
    `;

    function run(script: string): unknown {
        return runInNewContext(
            patchDocumentWorkerScript(
                new TextEncoder().encode(recorders + script),
            ),
        ) as unknown;
    }

    test("rejects a failed page instead of returning plain text after retries", async () => {
        const result = run(`
            async function infer() { throw new TypeError("unsupported model operation"); }
            async function extract() {
                try { return await infer(); }
                catch {
                    try { return await infer(); }
                    catch (error) {
                        recordInference({pageIndex:2},{},{reason:"inference_error",errorName:error.name,errorMessage:error.message});
                        return [{type:"body",text:"incomplete fallback"}];
                    }
                }
            }
            extract();
        `);
        await expect(result).rejects.toThrow(
            "SDT layout extraction failed on page 3 (inference_error): TypeError: unsupported model operation",
        );
    });

    test("reports the page and line limit when inference cannot run", () => {
        expect(() =>
            run(`
            recordLimit({pageIndex:4},{},{reason:"too_many_lines",lineCount:9999,limit:1000});
        `),
        ).toThrow("page 5 (too_many_lines): line count 9999 exceeds 1000");
    });

    test("preserves non-degrading bookkeeping and successful results", () => {
        expect(
            run(`
            const debug = {};
            recordInference({pageIndex:0},debug,{reason:"fallback_blocks_coalesced"});
            [debug.layoutFallbacks.length, {type:"image"}, {type:"math"}];
        `),
        ).toEqual([1, { type: "image" }, { type: "math" }]);
    });
});

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

describe("Document Worker iterator compatibility", () => {
    test("flattens nested Map values as used by PDF text extraction", () => {
        expect(
            runWithoutNative(`
            const groups = new Map([
                ["first", new Map([["a", 1], ["b", 2]])],
                ["empty", new Map()],
                ["last", new Map([["c", 3]])],
            ]);
            Array.from(groups.values().flatMap(group => group.values()));
        `),
        ).toEqual([1, 2, 3]);
    });

    test("flatMap is lazy and closes both iterators when stopped early", () => {
        expect(
            runWithoutNative(`
            const events = [];
            function* outer() {
                try { yield 10; yield 20; } finally { events.push("outer closed"); }
            }
            function* inner(value) {
                try { yield value; yield value + 1; } finally { events.push("inner closed"); }
            }
            const values = outer().flatMap((value, index) => {
                events.push(index);
                return inner(value);
            });
            const before = events.length;
            const first = values.next().value;
            values.return();
            [before, first, events];
        `),
        ).toEqual([0, 10, [0, "inner closed", "outer closed"]]);
    });

    test("supports some and find on built-in iterators, including no matches", () => {
        expect(
            runWithoutNative(`
            const map = new Map([["a", 1], ["b", 2]]);
            [
                map.values().some((value, index) => value === 2 && index === 1),
                map.keys().find((value, index) => index === 1),
                map.values().some(value => value === 3),
                map.keys().find(value => value === "missing"),
                new Set([1, 2]).values().some(value => value === 2),
            ];
        `),
        ).toEqual([true, "b", false, undefined, true]);
    });

    test("short-circuits predicates and closes the source on callback errors", () => {
        expect(
            runWithoutNative(`
            const events = [];
            function* source() {
                try { yield 1; yield 2; } finally { events.push("closed"); }
            }
            source().some(value => { events.push(value); return true; });
            source().find(value => { events.push(value); return true; });
            try {
                Array.from(source().flatMap(() => { throw new Error("mapper failed"); }));
            } catch (error) { events.push(error.message); }
            events;
        `),
        ).toEqual([1, "closed", 1, "closed", "closed", "mapper failed"]);
    });

    test("preserves native iterator helpers", () => {
        const result: unknown = runInNewContext(`
            const prototype = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
            const names = ["flatMap", "some", "find"];
            const originals = names.map(name => prototype[name]);
            ${DOCUMENT_WORKER_PREAMBLE}
            names.every((name, index) => prototype[name] === originals[index]);
        `);
        expect(result).toBe(true);
    });
});
