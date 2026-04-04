import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import {
    editableRegionsField,
    unlockedRegionsField,
} from "./zotflow-editable-region-extension";

interface FrontmatterInfo {
    locked: boolean;
    fmEnd: number;
    hasLibraryId: boolean;
}

/** Parse frontmatter once, extracting lock state, end offset, and library-id presence. */
function parseFrontmatter(state: EditorState): FrontmatterInfo {
    if (state.doc.sliceString(0, 3) !== "---") {
        return { locked: false, fmEnd: -1, hasLibraryId: false };
    }

    const head = state.doc.sliceString(0, 10000);

    const locked = /^---\s*[\s\S]*?zotflow-locked:\s*true/m.test(head);

    const fmMatch = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(
        head,
    );
    const fmEnd = fmMatch ? fmMatch[0].length : -1;

    const fm = fmMatch ? fmMatch[0] : "";
    const hasLibId = /^library-id:\s*\d+/m.test(fm);

    return { locked, fmEnd, hasLibraryId: hasLibId };
}

/**
 * Returns a CM6 extension that makes the editor read-only when `zotflow-locked: true` is in frontmatter,
 * except for changes within the frontmatter itself and editable regions (when `library-id` is present).
 *
 * @param isDefaultLocked — returns the current `defaultEditableRegionLocked` setting value.
 */
export function ZotFlowLockExtension(
    isDefaultLocked: () => boolean,
): Extension {
    return [
        EditorState.changeFilter.of((tr) => {
            if (!tr.docChanged) return true;
            if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return true;

            // Allow programmatic document updates (e.g. vault.modify() re-rendering
            // the source note).  Obsidian dispatches these with userEvent "set".
            if (tr.isUserEvent("set")) return true;

            const fm = parseFrontmatter(tr.startState);
            if (!fm.locked) return true;
            if (fm.fmEnd === -1) return true;

            const fmEnd = fm.fmEnd;

            // If library-id is present, editable regions are active
            const regionsEnabled = fm.hasLibraryId;
            const regions = regionsEnabled
                ? (tr.startState.field(editableRegionsField, false) ?? [])
                : [];
            const unlocked =
                tr.startState.field(unlockedRegionsField, false) ??
                new Set<string>();

            // When defaultEditableRegionLocked is false, regions start
            // unlocked and the toggle set tracks explicitly *locked* keys.
            // When true (default), the toggle set tracks explicitly *unlocked* keys.
            const defaultLocked = isDefaultLocked();

            let allow = true;

            tr.changes.iterChanges((fromChange, toChange) => {
                if (!allow) return;

                // Allow changes within frontmatter
                if (toChange <= fmEnd) return;

                // Check if change falls within an editable region that is unlocked
                if (regions.length > 0) {
                    const inUnlockedRegion = regions.some((r) => {
                        // Determine if this region is currently unlocked
                        const isUnlocked = defaultLocked
                            ? unlocked.has(r.key) // default locked → toggle unlocks
                            : !unlocked.has(r.key); // default unlocked → toggle locks

                        return (
                            isUnlocked &&
                            fromChange >= r.from &&
                            toChange <= r.to &&
                            // Protect BEG marker line
                            !(fromChange <= r.begTo && toChange >= r.begFrom) &&
                            // Protect END marker line
                            !(fromChange <= r.endTo && toChange >= r.endFrom)
                        );
                    });

                    if (inUnlockedRegion) return;
                }

                allow = false;
            });

            return allow;
        }),
    ];
}
