import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ObsidianIcon } from "ui/ObsidianIcon";

// `setIcon` writes into the container through a ref, which server rendering
// never runs. The markup is enough here: this test is about the container's
// own class and style attributes.
vi.mock("obsidian", () => ({ setIcon: vi.fn() }));

describe("ObsidianIcon", () => {
    it("carries its layout on a class, not an inline style", () => {
        const html = renderToStaticMarkup(
            createElement(ObsidianIcon, { icon: "file" }),
        );

        // An inline `display` would outrank every stylesheet rule, which is
        // what silently defeated the "Show item icons" setting: the tree's
        // `.zotflow-hide-tree-icons ... { display: none }` could never win.
        expect(html).not.toMatch(/display\s*:/);
        expect(html).toContain('class="zotflow-icon"');
    });

    it("keeps a caller's class alongside the base class", () => {
        const html = renderToStaticMarkup(
            createElement(ObsidianIcon, {
                icon: "file",
                className: "zotflow-file-icon",
            }),
        );

        expect(html).toContain('class="zotflow-icon zotflow-file-icon"');
    });

    it("still applies per-instance containerStyle", () => {
        const html = renderToStaticMarkup(
            createElement(ObsidianIcon, {
                icon: "chevron-right",
                containerStyle: { visibility: "hidden" },
            }),
        );

        expect(html).toContain("visibility:hidden");
    });
});
