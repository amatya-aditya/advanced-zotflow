import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";

const USER_ZONE_MARKER = "%% ZOTFLOW_USER_START %%";

function isLocked(state: EditorState): boolean {
    if (state.doc.sliceString(0, 3) !== "---") return false;

    const head = state.doc.sliceString(0, 10000);

    return /^---\s*[\s\S]*?zotflow-locked:\s*true/m.test(head);
}

/** Returns the character offset just past the closing `---` of YAML frontmatter, or -1 if none. */
function getFrontmatterEnd(state: EditorState): number {
    if (state.doc.sliceString(0, 3) !== "---") return -1;

    const text = state.doc.sliceString(0, 10000);
    const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);

    return match ? match[0].length : -1;
}

/** Returns the character offset of the user zone marker, or -1 if none. */
function getUserZoneStart(state: EditorState): number {
    const text = state.doc.toString();
    const idx = text.indexOf(USER_ZONE_MARKER);
    return idx === -1 ? -1 : idx;
}

/**
 * Returns a CM6 extension that makes the editor read-only when `zotflow-locked: true` is in frontmatter,
 * except for changes within the frontmatter itself or within the user content zone.
 */
export function ZotFlowLockExtension(): Extension {
    return [
        EditorState.changeFilter.of((tr) => {
            if (!tr.docChanged) return true;
            if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return true;

            if (!isLocked(tr.startState)) return true;

            const fmEnd = getFrontmatterEnd(tr.startState);
            if (fmEnd === -1) return true;

            const userZoneStart = getUserZoneStart(tr.startState);

            let allow = true;

            tr.changes.iterChanges((fromChange, toChange) => {
                if (!allow) return;

                // Allow changes within frontmatter
                if (toChange <= fmEnd) return;

                // Allow changes within or after user zone marker
                if (userZoneStart !== -1 && fromChange >= userZoneStart) return;

                // Block everything else (the auto-generated zone)
                allow = false;
            });

            return allow;
        }),
    ];
}
