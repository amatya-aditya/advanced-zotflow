import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import {
    editableRegionsField,
    unlockedRegionsField,
} from "./zotflow-editable-region-extension";
import { services } from "services/services";

const USER_ZONE_MARKER = "%% ZOTFLOW_USER_START %%";

interface FrontmatterInfo {
    locked: boolean;
    fmEnd: number;
    hasLibraryId: boolean;
    libraryId: number | undefined;
}

/** Parse frontmatter once, extracting lock state, end offset, and library-id. */
function parseFrontmatter(state: EditorState): FrontmatterInfo {
    if (state.doc.sliceString(0, 3) !== "---") {
        return {
            locked: false,
            fmEnd: -1,
            hasLibraryId: false,
            libraryId: undefined,
        };
    }

    const head = state.doc.sliceString(0, 10000);
    const locked = /^---\s*[\s\S]*?zotflow-locked:\s*true/m.test(head);
    const fmMatch = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(
        head,
    );
    const fmEnd = fmMatch ? fmMatch[0].length : -1;
    const fm = fmMatch ? fmMatch[0] : "";
    const libIdMatch = /^library-id:\s*(\d+)/m.exec(fm);
    const libraryId = libIdMatch ? Number(libIdMatch[1]) : undefined;

    return {
        locked,
        fmEnd,
        hasLibraryId: libraryId !== undefined,
        libraryId,
    };
}

/** Returns the character offset of the user zone marker, or -1 if none. */
function getUserZoneStart(state: EditorState): number {
    const text = state.doc.toString();
    const idx = text.indexOf(USER_ZONE_MARKER);
    return idx === -1 ? -1 : idx;
}

/**
 * Makes locked source notes read-only except for frontmatter, unlocked editable regions,
 * and the preserved user-content zone.
 */
export function ZotFlowLockExtension(
    isDefaultLocked: () => boolean,
): Extension {
    return [
        EditorState.changeFilter.of((tr) => {
            if (!tr.docChanged) return true;
            if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return true;

            // Allow programmatic updates during note re-rendering.
            if (tr.isUserEvent("set")) return true;

            const fm = parseFrontmatter(tr.startState);
            if (!fm.locked || fm.fmEnd === -1) return true;

            const fmEnd = fm.fmEnd;

            // If the library-id resolves to a library where note edits are
            // disallowed (read-only sync mode, or API key lacks notes/write
            // permission), reject ALL non-frontmatter edits regardless of
            // editable-region state.
            if (
                fm.libraryId !== undefined &&
                !services.libraryCache.canEditNotes(fm.libraryId)
            ) {
                let allowFmOnly = true;
                tr.changes.iterChanges((fromChange, toChange) => {
                    if (!allowFmOnly) return;
                    if (toChange <= fmEnd) return;
                    allowFmOnly = false;
                });
                return allowFmOnly;
            }

            // If library-id is present, editable regions are active
            const userZoneStart = getUserZoneStart(tr.startState);
            const regionsEnabled = fm.hasLibraryId;
            const regions = regionsEnabled
                ? (tr.startState.field(editableRegionsField, false) ?? [])
                : [];
            const unlocked =
                tr.startState.field(unlockedRegionsField, false) ??
                new Set<string>();
            const defaultLocked = isDefaultLocked();

            let allow = true;

            tr.changes.iterChanges((fromChange, toChange) => {
                if (!allow) return;

                // Allow changes within frontmatter.
                if (toChange <= fm.fmEnd) return;

                // Allow changes within or after the preserved user zone.
                if (userZoneStart !== -1 && fromChange >= userZoneStart) {
                    return;
                }

                if (regions.length > 0) {
                    const inUnlockedRegion = regions.some((region) => {
                        const isUnlocked = defaultLocked
                            ? unlocked.has(region.key)
                            : !unlocked.has(region.key);

                        return (
                            isUnlocked &&
                            fromChange >= region.from &&
                            toChange <= region.to &&
                            !(fromChange <= region.begTo &&
                                toChange >= region.begFrom) &&
                            !(fromChange <= region.endTo &&
                                toChange >= region.endFrom)
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
