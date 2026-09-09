import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

const state = vi.hoisted(() => ({
    bookmarked: false,
    entries: [] as { title: string; click?: () => Promise<void> }[],
    toggleBookmark: vi.fn(),
}));
vi.mock("react", async (original) => ({
    ...await original<typeof import("react")>(),
    useContext: () => ({ freeTokens: [] }),
}));
vi.mock("ui/tree-view/TreeView", () => ({ TreeSearchContext: {} }));
vi.mock("services/services", () => ({ services: {
    isBookmarked: () => state.bookmarked,
    toggleBookmark: state.toggleBookmark,
    libraryCache: { canEditNotes: () => false },
} }));
vi.mock("bridge", () => ({ workerBridge: {} }));
vi.mock("utils/viewer", () => ({}));
vi.mock("utils/base-generator", () => ({}));
vi.mock("ui/editor/citation-helper", () => ({ ZOTFLOW_CITATION_MIME: "citation" }));
vi.mock("ui/search/autocomplete-data", () => ({}));
vi.mock("ui/modals/tag-edit", () => ({}));
vi.mock("obsidian", () => ({
    Menu: class {
        addItem(callback: (item: object) => void) {
            const entry = { title: "", click: undefined as (() => Promise<void>) | undefined };
            const item = {
                setTitle(title: string) { entry.title = title; return item; },
                setIcon() { return item; },
                setDisabled() { return item; },
                onClick(click: () => Promise<void>) { entry.click = click; return item; },
            };
            callback(item);
            state.entries.push(entry);
            return this;
        }
        addSeparator() { return this; }
        showAtMouseEvent() {}
    },
    setIcon: vi.fn(),
}));

import { NodeItem } from "ui/tree-view/Node";

describe("PDF attachment bookmarks", () => {
    beforeEach(() => { state.entries = []; state.toggleBookmark.mockReset(); });

    it.each([false, true])("offers a bookmark toggle for a nested PDF (bookmarked: %s)", async (bookmarked) => {
        state.bookmarked = bookmarked;
        const node = {
            data: { nodeType: "item", name: "paper.pdf", itemType: "attachment", contentType: "application/pdf", libraryID: 42, key: "PDFKEY", children: [] },
            parent: { data: { nodeType: "item", key: "REFERENCE" } },
            level: 2,
            select: vi.fn(),
        };
        const row = NodeItem({ node, style: {} } as unknown as ComponentProps<typeof NodeItem>);
        row.props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
        const entries = state.entries.filter(entry => /bookmark/i.test(entry.title));
        expect(entries).toHaveLength(1);
        expect(entries[0]!.title).toBe(bookmarked ? "Remove bookmark" : "Bookmark item");
        await entries[0]!.click!();
        expect(state.toggleBookmark).toHaveBeenCalledWith({ libraryID: 42, key: "PDFKEY", name: "paper.pdf", itemType: "attachment", contentType: "application/pdf" });
    });
});
