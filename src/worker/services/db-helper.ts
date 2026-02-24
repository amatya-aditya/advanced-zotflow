import { db } from "db/db";

import type { IParentProxy } from "bridge/types";
import type { IDBZoteroItem } from "types/db-schema";
import type { AttachmentData } from "types/zotero-item";

/**
 * Worker-side helper service for general-purpose DB operations that
 * don't belong to a domain-specific service.
 */
export class DbHelperService {
    constructor(private parentHost: IParentProxy) {}

    /**
     * Look up an attachment item by library + key.
     * Returns `undefined` if the item doesn't exist or isn't an attachment.
     */
    async getAttachmentItem(
        libraryID: number,
        itemKey: string,
    ): Promise<IDBZoteroItem<AttachmentData> | undefined> {
        const item = await db.items.get([libraryID, itemKey]);
        if (!item || item.itemType !== "attachment") return undefined;
        return item as IDBZoteroItem<AttachmentData>;
    }

    /**
     * Persist the reader's scroll/position state for an attachment item.
     * Called from the main thread whenever the reader emits `viewStateChanged`.
     * Stored on the `items` record so it survives plugin reloads without any
     * additional schema version bump (non-indexed optional field).
     */
    async saveViewState(
        libraryID: number,
        key: string,
        primary: boolean,
        state: Record<string, unknown>,
    ): Promise<void> {
        try {
            await db.items.update(
                [libraryID, key],
                primary
                    ? { primaryViewState: state }
                    : { secondaryViewState: state },
            );
        } catch (e) {
            this.parentHost.log(
                "warn",
                `Failed to persist ${primary ? "primaryViewState" : "secondaryViewState"} for item ${key}`,
                "DbHelperService",
                e,
            );
        }
    }
}
