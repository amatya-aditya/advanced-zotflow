import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const html = readFileSync(
    new URL("../../reader/reader/index.obsidian.reader.html", import.meta.url),
    "utf8",
);
const setup = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;

describe("reader environment bootstrap", () => {
    it.each([undefined, {}, { config: {} }, { config: { loader: {} } }])(
        "starts when host math configuration is unavailable: %j",
        (MathJax) => {
            const attributes = new Map<string, string>();
            const parent = {
                location: { origin: "app://obsidian.md" },
                MathJax,
                opener: { closed: false, location: { origin: "wrong-window" } },
            };
            const window = { parent } as {
                parent: typeof parent;
                findParentWindow?: () => unknown;
                MathJax?: { loader: { paths: object } };
            };
            expect(() => runInNewContext(setup, {
                window,
                document: { querySelector: () => ({
                    setAttribute: (key: string, value: string) => attributes.set(key, value),
                }) },
            })).not.toThrow();
            expect(window.findParentWindow!()).toBe(parent);
            expect(attributes.get("href")).toBe("app://obsidian.md/");
            expect(window.MathJax).toBeUndefined();
        },
    );
});
