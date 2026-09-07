import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { DOCUMENT_WORKER_PREAMBLE } from "bundle-assets/patch-inlined-assets";

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
