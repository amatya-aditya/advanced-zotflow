import { App, SuggestModal, setIcon } from "obsidian";
import { workerBridge } from "bridge";
import type { AnyIDBZoteroItem, IDBZoteroItem } from "types/db-schema";
import type { AttachmentData } from "types/zotero-item";
import { getItemTypeIcon } from "ui/icons";
import { openAttachment } from "utils/viewer";
import type { ZotFlowSettings } from "settings/types";
import { services } from "services/services";
import { AttachmentSelectModal } from "./attachment-suggest";

interface SearchHeader {
    isHeader: true;
    label: string;
}
export type SuggestionItem = AnyIDBZoteroItem | SearchHeader;

/**
 * Abstract base class for Zotero item search modals.
 * Provides shared query logic, rendering, and highlight helpers.
 * Subclasses implement `handleItemSelected()` to define the action.
 */
export abstract class BaseItemSearchModal extends SuggestModal<SuggestionItem> {
    protected itemPaths: Record<string, string[]> = {};

    constructor(app: App, placeholder = "Search Zotero Library...") {
        super(app);
        this.setPlaceholder(placeholder);
        this.modalEl.addClass("zotflow-search-modal");
        this.limit = 20;
    }

    protected abstract handleItemSelected(
        item: AnyIDBZoteroItem,
        evt: MouseEvent | KeyboardEvent,
    ): void;

    async getSuggestions(query: string): Promise<SuggestionItem[]> {
        try {
            let items: SuggestionItem[] = [];

            if (!query) {
                const recentItems =
                    await workerBridge.dbHelper.getRecentItems(20);

                if (recentItems.length > 0) {
                    items = [
                        { isHeader: true, label: "Recent Viewed" },
                        ...recentItems,
                    ];
                } else {
                    const fallbackItems =
                        await workerBridge.dbHelper.getRecentlyAddedItems(20);

                    if (fallbackItems.length > 0) {
                        items = [
                            { isHeader: true, label: "Recently Added" },
                            ...fallbackItems,
                        ];
                    }
                }
            } else {
                const searchResults = await workerBridge.dbHelper.searchItems(
                    query,
                    50,
                );

                if (searchResults.length > 0) {
                    items = [
                        { isHeader: true, label: "Best Match" },
                        ...searchResults,
                    ];
                }
            }

            const zItems = items.filter(
                (i) => !("isHeader" in i),
            ) as AnyIDBZoteroItem[];

            if (zItems.length > 0) {
                try {
                    this.itemPaths = await workerBridge.dbHelper.getItemPaths(
                        zItems.map((i) => ({
                            libraryID: i.libraryID,
                            key: i.key,
                            collections: i.collections,
                        })),
                    );
                } catch (pathErr) {
                    services.logService.error(
                        "Failed to fetch item paths",
                        "BaseItemSearchModal",
                        pathErr,
                    );
                }
            }

            return items;
        } catch (e) {
            services.logService.error(
                "Search failed",
                "BaseItemSearchModal",
                e,
            );
            return [];
        }
    }

    renderSuggestion(item: SuggestionItem, el: HTMLElement) {
        // Header
        if ("isHeader" in item && item.isHeader) {
            el.addClass("zotflow-suggestion-header");
            el.setText(item.label);
            return;
        }

        // Zotero Item
        const zItem = item as AnyIDBZoteroItem;
        const query = this.inputEl.value;

        el.addClass("zotflow-search-item");

        // Main Content Container
        const contentContainer = el.createDiv({ cls: "zotflow-item-content" });

        // Title Row
        const titleRow = contentContainer.createDiv({ cls: "zotflow-row-top" });
        const titleEl = titleRow.createDiv({ cls: "zotflow-title" });
        this.renderHighlight(titleEl, zItem.title || "Untitled", query);

        // Meta + Path Row
        const bottomRow = contentContainer.createDiv({
            cls: "zotflow-row-bottom",
        });

        // Author • Year
        const metaEl = bottomRow.createDiv({ cls: "zotflow-meta" });
        const authors = this.formatCreators(zItem.searchCreators);
        const year = this.extractYear((zItem.raw.data as any).date);

        let metaText = "";
        if (authors && year !== "n.d.") metaText = `${authors} (${year}).`;
        else if (authors) metaText = authors;
        else metaText = year;

        this.renderHighlight(metaEl, metaText, query);

        // Path pills
        const paths = this.itemPaths[`${zItem.libraryID}:${zItem.key}`];
        if (paths && paths.length > 0) {
            const pathsEl = bottomRow.createDiv({ cls: "zotflow-paths" });

            paths.forEach((path) => {
                const pill = pathsEl.createSpan({ cls: "zotflow-path-pill" });

                const segments = path.split("/");
                segments.forEach((seg, i) => {
                    pill.createSpan({ text: seg.trim() });
                    if (i < segments.length - 2) {
                        pill.createSpan({ cls: "path-sep", text: "/" });
                    }
                });
            });
        }
    }

    async onChooseSuggestion(
        item: SuggestionItem,
        evt: MouseEvent | KeyboardEvent,
    ) {}

    selectSuggestion(
        item: SuggestionItem,
        evt: MouseEvent | KeyboardEvent,
    ): void {
        if ("isHeader" in item) return;

        const zItem = item as AnyIDBZoteroItem;
        this.handleItemSelected(zItem, evt);
    }

    protected formatCreators(creators: string[]): string | null {
        if (!creators || creators.length === 0) return null;
        if (creators.length === 1) return creators[0]!;
        if (creators.length === 2) return `${creators[0]} & ${creators[1]}`;
        return `${creators[0]} et al.`;
    }

    protected extractYear(dateString: string): string {
        if (!dateString) return "n.d.";
        const match = dateString.match(/\d{4}/);
        return match ? match[0] : "n.d.";
    }

    protected renderHighlight(el: HTMLElement, text: string, query: string) {
        if (!query) {
            el.setText(text);
            return;
        }
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(${escapedQuery})`, "gi");

        text.split(regex).forEach((part) => {
            if (part.toLowerCase() === query.toLowerCase()) {
                el.createSpan({ cls: "suggestion-highlight", text: part });
            } else {
                el.createSpan({ text: part });
            }
        });
    }
}

export class ZoteroSearchModal extends BaseItemSearchModal {
    private settings: ZotFlowSettings;

    constructor(app: App, settings: ZotFlowSettings) {
        super(app);
        this.settings = settings;
    }

    protected handleItemSelected(
        item: AnyIDBZoteroItem,
        evt: MouseEvent | KeyboardEvent,
    ): void {
        this.handleSelection(item, evt);
    }

    private async handleSelection(
        item: AnyIDBZoteroItem,
        evt: MouseEvent | KeyboardEvent,
    ) {
        if (item.itemType === "attachment") {
            openAttachment(item.libraryID, item.key, this.app);
            this.close();
            return;
        }

        const attachments = await workerBridge.dbHelper.getAttachments(
            item.libraryID,
            item.key,
        );

        if (attachments.length === 0) {
            services.notificationService.notify(
                "warning",
                `No attachments found for item: ${item.title}`,
            );
        } else if (attachments.length === 1) {
            openAttachment(
                attachments[0]!.libraryID,
                attachments[0]!.key,
                this.app,
            );
            this.close();
        } else {
            new AttachmentSelectModal(
                this.app,
                item,
                attachments as IDBZoteroItem<AttachmentData>[],
                this,
            ).open();
        }
    }
}
