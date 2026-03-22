import { App } from "obsidian";
import { ZOTERO_READER_VIEW_TYPE, ZoteroReaderView } from "../ui/reader/view";
import { workerBridge } from "../bridge";

/**
 * Open an attachment in the default application.
 * @param libraryID The library ID of the attachment.
 * @param key The item key of the attachment.
 * @param app The Obsidian App instance.
 * @param navigationInfo Optional navigation info.
 */
export async function openAttachment(
    libraryID: number,
    key: string,
    app: App,
    navigationInfo?: any,
) {
    // Update last accessed timestamp
    workerBridge.dbHelper.updateLastAccessed(libraryID, key).catch(() => {
        // Silent catch: timestamp update shouldn't block opening
    });

    let activeLeaf;
    const leaves = app.workspace.getLeavesOfType(ZOTERO_READER_VIEW_TYPE);

    for (const leaf of leaves) {
        const view = leaf.view as ZoteroReaderView;
        if (
            view &&
            view.getState().libraryID === libraryID &&
            view.getState().itemKey === key
        ) {
            activeLeaf = leaf;
        }
    }

    if (activeLeaf) {
        app.workspace.setActiveLeaf(activeLeaf);
    } else {
        activeLeaf = app.workspace.getLeaf("tab");

        await activeLeaf.setViewState({
            type: ZOTERO_READER_VIEW_TYPE,
            active: true,
            state: {
                libraryID: libraryID,
                itemKey: key,
            },
        });

        app.workspace.revealLeaf(activeLeaf);
    }

    if (navigationInfo) {
        (activeLeaf.view as ZoteroReaderView).readerNavigate(
            JSON.parse(navigationInfo),
        );
    }
}
