import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";

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

/**
 * Returns a CM6 extension that makes the editor read-only when `zotflow-locked: true` is in frontmatter,
 * except for changes within the frontmatter itself.
 */
export function ZotFlowLockExtension(): Extension {
    return [
        EditorState.changeFilter.of((tr) => {
            if (!tr.docChanged) return true;
            if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return true;

            if (!isLocked(tr.startState)) return true;

            const fmEnd = getFrontmatterEnd(tr.startState);
            if (fmEnd === -1) return true;

            let allow = true;

            tr.changes.iterChanges((fromChange, toChange) => {
                if (!allow) return;

                // Block any change that touches content outside frontmatter
                if (toChange > fmEnd) {
                    allow = false;
                }
            });

            return allow;
        }),
    ];
}
