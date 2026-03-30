import React, {
    useState,
    useRef,
    useLayoutEffect,
    useEffect,
    useMemo,
    useCallback,
} from "react";
import { Menu } from "obsidian";
import { NodeApi, Tree } from "react-arborist";
import { workerBridge } from "bridge";
import { ObsidianIcon } from "../ObsidianIcon";
import { NodeItem, INDENT_SIZE } from "./Node";
import { services } from "services/services";
import { getAttachmentFileIcon, getItemTypeIcon } from "ui/icons";
import { openAttachment } from "utils/viewer";

import type { TreeTransferPayload } from "worker/services/tree-view";
import type {
    BookmarkedItem,
    RecentItem,
    CollectionSortOrder,
    ItemSortOrder,
} from "settings/types";
import type { TFile, TAbstractFile } from "obsidian";
import { normalizePath } from "obsidian";

/* ================================================================ */
/*  Types                                                          */
/* ================================================================ */

type ViewMode = "library" | "bookmarks" | "recent" | "notes" | "bases";

/** Tree node representing a library, collection, item, or spacer in the tree view. */
export type ViewNode = {
    id: string;
    parent?: string | null;
    children: ViewNode[];
    name: string;
    itemType: string;
    contentType?: string;
    libraryID: number;
    libraryName: string;
    citationKey?: string;
    key: string;
    nodeType: "library" | "collection" | "item" | "spacer";
    dateAdded?: string;
    dateModified?: string;
};

function rebuildTreeFromWorker(payload: TreeTransferPayload): ViewNode[] {
    const { entities, topology } = payload;

    // Lookup table for quick parent node lookup
    const nodeMap = new Map<string, ViewNode>();

    // Root nodes collection
    const roots: ViewNode[] = [];

    // Single pass
    for (let i = 0; i < topology.length; i++) {
        const nodeRef = topology[i]!;

        // Get metadata O(1)
        const entity = entities[nodeRef.key];

        // If data is missing (extreme case), skip
        if (!entity) continue;

        // Create complete ViewNode object
        const node: ViewNode = {
            id: nodeRef.id,
            key: nodeRef.key,
            parent: nodeRef.parentId,
            nodeType: nodeRef.nodeType,

            // Mix in Entity data
            name: entity.name,
            itemType: entity.itemType,
            libraryID: entity.libraryID,
            libraryName: entity.libraryName,
            citationKey: entity.citationKey,
            contentType: entity.contentType,
            dateAdded: entity.dateAdded,
            dateModified: entity.dateModified,

            // Initialize Children
            children: [],
        };

        // Store in Map
        nodeMap.set(node.id, node);

        // Mount logic
        if (nodeRef.parentId) {
            // Since Worker is DFS generated, when processing child nodes, parent node must already be in Map
            const parent = nodeMap.get(nodeRef.parentId);
            if (parent) {
                parent.children.push(node);
            } else {
                // If parent node not found (possible data consistency issue), handle gracefully by placing at root
                roots.push(node);
            }
        } else {
            // No parentId means root node (Libraries)
            roots.push(node);
        }
    }

    // Add 1 spacer nodes at the bottom
    roots.push({
        id: `spacer`,
        key: `spacer`,
        parent: null,
        nodeType: "spacer",
        name: "",
        itemType: "",
        libraryName: "",
        libraryID: 0,
        children: [],
    });

    return roots;
}

/* ================================================================ */
/*  Sidebar Item (for bookmarks & recents)                         */
/* ================================================================ */

const SidebarItem = ({
    name,
    itemType,
    contentType,
    libraryID,
    itemKey,
    onRemove,
    removeIcon,
    removeLabel,
}: {
    name: string;
    itemType: string;
    contentType?: string;
    libraryID: number;
    itemKey: string;
    onRemove?: () => void;
    removeIcon: string;
    removeLabel: string;
}) => {
    const iconName =
        itemType === "attachment"
            ? getAttachmentFileIcon(contentType)
            : getItemTypeIcon(itemType);

    const handleClick = async () => {
        services.addRecentItem({
            libraryID,
            key: itemKey,
            name,
            itemType,
            contentType,
        });
        if (itemType === "attachment") {
            await openAttachment(libraryID, itemKey, services.app);
        } else {
            await workerBridge.libraryNote.openNote(libraryID, itemKey, {
                forceUpdateContent: true,
                forceUpdateImages: false,
            });
        }
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const menu = new Menu();

        // Open source note — always available
        menu.addItem((item) => {
            item.setTitle("Open source note")
                .setIcon("file-badge")
                .onClick(async () => {
                    services.addRecentItem({
                        libraryID,
                        key: itemKey,
                        name,
                        itemType,
                        contentType,
                    });
                    try {
                        await workerBridge.libraryNote.openNote(
                            libraryID,
                            itemKey,
                            {
                                forceUpdateContent: true,
                                forceUpdateImages: false,
                            },
                        );
                    } catch (err) {
                        services.logService.error(
                            "Failed to open note",
                            "SidebarItem",
                            err,
                        );
                        services.notificationService.notify(
                            "error",
                            "Failed to open source note.",
                        );
                    }
                });
        });

        // Extract annotation images — always available
        menu.addItem((item) => {
            item.setTitle("Extract annotation images")
                .setIcon("image")
                .onClick(async () => {
                    try {
                        workerBridge.libraryNote.openNote(libraryID, itemKey, {
                            forceUpdateContent: true,
                            forceUpdateImages: false,
                        });
                        const taskId =
                            await workerBridge.createBatchExtractImagesTask({
                                items: [{ libraryID, itemKey }],
                                forceUpdate: true,
                            });
                        services.notificationService.notify(
                            "success",
                            `Image extraction started (task ${taskId.slice(0, 8)})`,
                        );
                    } catch (err) {
                        services.logService.error(
                            "Failed to extract images",
                            "SidebarItem",
                            err,
                        );
                        services.notificationService.notify(
                            "error",
                            "Failed to start image extraction.",
                        );
                    }
                });
        });

        // Open in reader (for attachment items)
        if (itemType === "attachment") {
            menu.addItem((item) => {
                item.setTitle("Open in reader")
                    .setIcon("book-open")
                    .onClick(async () => {
                        services.addRecentItem({
                            libraryID,
                            key: itemKey,
                            name,
                            itemType,
                            contentType,
                        });
                        await openAttachment(
                            libraryID,
                            itemKey,
                            services.app,
                        );
                    });
            });
        }

        // Bookmark toggle
        const isBookmarked = services.isBookmarked(libraryID, itemKey);
        menu.addItem((item) => {
            item.setTitle(isBookmarked ? "Remove bookmark" : "Bookmark item")
                .setIcon(isBookmarked ? "bookmark-minus" : "bookmark-plus")
                .onClick(async () => {
                    await services.toggleBookmark({
                        libraryID,
                        key: itemKey,
                        name,
                        itemType,
                        contentType,
                    });
                });
        });

        // Create companion note (for non-attachment items)
        if (itemType !== "attachment") {
            menu.addItem((item) => {
                item.setTitle("Create Companion Note")
                    .setIcon("file-plus-2")
                    .onClick(async () => {
                        try {
                            // Ensure source note exists first
                            await workerBridge.libraryNote.openNote(
                                libraryID,
                                itemKey,
                                {
                                    forceUpdateContent: false,
                                    forceUpdateImages: false,
                                },
                            );
                            const file =
                                services.indexService.getFileByKey(itemKey);
                            if (file) {
                                services.plugin.promptCompanionNote(file);
                            } else {
                                services.notificationService.notify(
                                    "error",
                                    "Source note not found.",
                                );
                            }
                        } catch (err) {
                            services.logService.error(
                                "Failed to create companion note",
                                "SidebarItem",
                                err,
                            );
                            services.notificationService.notify(
                                "error",
                                "Failed to create companion note.",
                            );
                        }
                    });
            });
        }

        // Remove from recents (only for recent items, not bookmarks — avoid duplicate)
        if (onRemove && removeIcon !== "bookmark-minus") {
            menu.addItem((item) => {
                item.setTitle(removeLabel)
                    .setIcon(removeIcon)
                    .onClick(() => onRemove());
            });
        }

        menu.showAtMouseEvent(e.nativeEvent);
    };

    return (
        <div
            className="zotflow-sidebar-item"
            onClick={handleClick}
            onContextMenu={handleContextMenu}
        >
            {iconName && (
                <ObsidianIcon icon={iconName} className="zotflow-file-icon" />
            )}
            <span className="zotflow-sidebar-item-name">{name}</span>
            {onRemove && (
                <div
                    className="zotflow-sidebar-item-action clickable-icon"
                    aria-label={removeLabel}
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove();
                    }}
                >
                    <ObsidianIcon icon={removeIcon} />
                </div>
            )}
        </div>
    );
};

/* ================================================================ */
/*  Sorting                                                        */
/* ================================================================ */

const COLLECTION_SORT_OPTIONS: {
    label: string;
    value: CollectionSortOrder;
}[] = [
    { label: "Name (A to Z)", value: "name-asc" },
    { label: "Name (Z to A)", value: "name-desc" },
];

const ITEM_SORT_OPTIONS: { label: string; value: ItemSortOrder }[] = [
    { label: "Title (A to Z)", value: "title-asc" },
    { label: "Title (Z to A)", value: "title-desc" },
    { label: "Modified time (new to old)", value: "modified-new" },
    { label: "Modified time (old to new)", value: "modified-old" },
    { label: "Created time (new to old)", value: "added-new" },
    { label: "Created time (old to new)", value: "added-old" },
];

/** Compare two strings using natural sort (numeric-aware, case-insensitive). */
function cmpStr(a: string, b: string): number {
    return a.localeCompare(b, undefined, {
        sensitivity: "base",
        numeric: true,
    });
}

/** Compare two ISO date strings. Missing dates sort last. */
function cmpDate(a: string | undefined, b: string | undefined): number {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Recursively sort every `children` array in-place-free (returns new arrays).
 * Libraries (roots) keep their original order.
 * Within a parent: collections always appear before items, then each group is
 * sorted independently by the matching sort order.
 * Spacers always stay at the end.
 */
function sortTree(
    roots: ViewNode[],
    collectionSort: CollectionSortOrder,
    itemSort: ItemSortOrder,
): ViewNode[] {
    const sortChildren = (nodes: ViewNode[]): ViewNode[] => {
        // Partition into collections, items, and spacers
        const collections: ViewNode[] = [];
        const items: ViewNode[] = [];
        const spacers: ViewNode[] = [];

        for (const n of nodes) {
            if (n.nodeType === "spacer") spacers.push(n);
            else if (n.nodeType === "collection") collections.push(n);
            else items.push(n);
        }

        // Sort collections by name
        const colDir = collectionSort === "name-asc" ? 1 : -1;
        collections.sort((a, b) => colDir * cmpStr(a.name, b.name));

        // Sort items
        items.sort((a, b) => {
            switch (itemSort) {
                case "title-asc":
                    return cmpStr(a.name, b.name);
                case "title-desc":
                    return -cmpStr(a.name, b.name);
                case "modified-new":
                    return -cmpDate(a.dateModified, b.dateModified);
                case "modified-old":
                    return cmpDate(a.dateModified, b.dateModified);
                case "added-new":
                    return -cmpDate(a.dateAdded, b.dateAdded);
                case "added-old":
                    return cmpDate(a.dateAdded, b.dateAdded);
                default:
                    return 0;
            }
        });

        // Recurse into children (collections have child collections + items)
        const sorted = [...collections, ...items, ...spacers];
        return sorted.map((node) => {
            if (node.children.length === 0) return node;
            return { ...node, children: sortChildren(node.children) };
        });
    };

    // For root level: keep library order, but sort each library's children
    return roots.map((root) => {
        if (root.nodeType === "spacer" || root.children.length === 0)
            return root;
        return { ...root, children: sortChildren(root.children) };
    });
}

/* ================================================================ */
/*  Toolbar Icon Button                                            */
/* ================================================================ */

const ToolbarButton = ({
    icon,
    label,
    active = false,
    onClick,
}: {
    icon: string;
    label: string;
    active?: boolean;
    onClick: (e: React.MouseEvent) => void;
}) => (
    <div
        className={`clickable-icon zotflow-toolbar-btn ${active ? "is-active" : ""}`}
        aria-label={label}
        onClick={onClick}
    >
        <ObsidianIcon icon={icon} />
    </div>
);

/* ================================================================ */
/*  Persisted open-state (survives unmount / remount)               */
/* ================================================================ */

/**
 * Module-level map tracking which tree nodes are expanded.
 * Persists across React unmount/remount cycles so the tree doesn't
 * collapse when the sidebar loses focus.
 */
const persistedOpenState: Record<string, boolean> = {};

/* ================================================================ */
/*  Main Tree Component                                            */
/* ================================================================ */

/** Root React component for the Zotero library tree with search, refresh, and virtual scrolling. */
export const ZotFlowTree = () => {
    const [rawData, setRawData] = useState<TreeTransferPayload | null>(null);
    const [term, setTerm] = useState("");
    const [loading, setLoading] = useState(true);
    const containerRef = useRef<HTMLDivElement>(null);
    const [dims, setDims] = useState({ w: 300, h: 500 });
    const [bookmarks, setBookmarks] = useState<BookmarkedItem[]>(
        services.getBookmarkedItems(),
    );
    const [recents, setRecents] = useState<RecentItem[]>(
        services.getRecentItems(),
    );
    const [viewMode, setViewMode] = useState<ViewMode>("library");
    const [searchOpen, setSearchOpen] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const [noteFiles, setNoteFiles] = useState<TFile[]>([]);
    const [baseFiles, setBaseFiles] = useState<TFile[]>([]);

    // Sort state — initialised from persisted settings
    const [collectionSort, setCollectionSort] = useState<CollectionSortOrder>(
        () => services.settings.treeCollectionSort,
    );
    const [itemSort, setItemSort] = useState<ItemSortOrder>(
        () => services.settings.treeItemSort,
    );

    // Subscribe to bookmark/recent changes
    useEffect(() => {
        const unsubBookmarks = services.onBookmarksChanged(() => {
            setBookmarks(services.getBookmarkedItems());
        });
        const unsubRecents = services.onRecentsChanged(() => {
            setRecents(services.getRecentItems());
        });
        return () => {
            unsubBookmarks();
            unsubRecents();
        };
    }, []);

    // Load note files when switching to notes view
    useEffect(() => {
        if (viewMode === "notes") {
            setNoteFiles(services.indexService.getAllIndexedFiles());
        }
    }, [viewMode]);

    // Load base files when switching to bases view
    useEffect(() => {
        if (viewMode !== "bases") return;

        const loadBases = () => {
            const folder = normalizePath(
                services.settings.baseViewFolder || "ZotFlow/Bases",
            );
            const abstractFolder =
                services.app.vault.getFolderByPath(folder);
            if (!abstractFolder) {
                setBaseFiles([]);
                return;
            }
            const files: TFile[] = [];
            const collectFiles = (f: TAbstractFile) => {
                if ("extension" in f && (f as TFile).extension === "base") {
                    files.push(f as TFile);
                }
                if ("children" in f) {
                    (f as any).children.forEach(collectFiles);
                }
            };
            collectFiles(abstractFolder);
            files.sort((a, b) =>
                a.basename.localeCompare(b.basename, undefined, {
                    sensitivity: "base",
                    numeric: true,
                }),
            );
            setBaseFiles(files);
        };

        loadBases();

        // Re-scan when vault changes
        const ref = services.app.vault.on("create", loadBases);
        const ref2 = services.app.vault.on("delete", loadBases);
        const ref3 = services.app.vault.on("rename", loadBases);
        return () => {
            services.app.vault.offref(ref);
            services.app.vault.offref(ref2);
            services.app.vault.offref(ref3);
        };
    }, [viewMode]);

    // Auto-focus search input when opened
    useEffect(() => {
        if (searchOpen && searchInputRef.current) {
            searchInputRef.current.focus();
        }
        if (!searchOpen) {
            setTerm("");
        }
    }, [searchOpen]);

    const handleRemoveBookmark = useCallback(
        async (item: BookmarkedItem) => {
            await services.toggleBookmark(item);
        },
        [],
    );

    // Resize Observer
    useLayoutEffect(() => {
        if (!containerRef.current) return;
        const obs = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                setDims({
                    w: entry.contentRect.width,
                    h: entry.contentRect.height,
                });
            }
        });
        obs.observe(containerRef.current);
        return () => obs.disconnect();
    }, []);

    useEffect(() => {
        const loadTree = async () => {
            setLoading(true);
            try {
                const flat = await workerBridge.treeView.getOptimizedTree();
                setRawData(flat);
            } catch (err) {
                services.logService.error(
                    "Failed to load tree",
                    "TreeView",
                    err,
                );
            } finally {
                setLoading(false);
            }
        };

        loadTree();
    }, []);

    // Prevent react-dnd from interfering with global events
    const voidElement = useMemo(() => document.createElement("div"), []);

    const handleRefresh = async () => {
        setLoading(true);
        try {
            await workerBridge.treeView.refreshTree();
            const flat = await workerBridge.treeView.getOptimizedTree();
            setRawData(flat);
        } catch (err) {
            services.logService.error(
                "Failed to refresh tree",
                "TreeView",
                err,
            );
        } finally {
            setLoading(false);
        }
    };

    const handleToggleSearch = () => {
        setSearchOpen((prev) => !prev);
    };

    /** Open the Obsidian-native sort menu with collection and item sort options. */
    const handleSortMenu = useCallback(
        (e: React.MouseEvent) => {
            const menu = new Menu();

            for (const opt of COLLECTION_SORT_OPTIONS) {
                menu.addItem((item) =>
                    item
                        .setTitle(`Collection: ${opt.label}`)
                        .setChecked(collectionSort === opt.value)
                        .setSection("collections")
                        .onClick(() => {
                            setCollectionSort(opt.value);
                            services.settings.treeCollectionSort = opt.value;
                            services.saveSettings();
                        }),
                );
            }

            for (const opt of ITEM_SORT_OPTIONS) {
                menu.addItem((item) =>
                    item
                        .setTitle(`Item: ${opt.label}`)
                        .setChecked(itemSort === opt.value)
                        .setSection("items")
                        .onClick(() => {
                            setItemSort(opt.value);
                            services.settings.treeItemSort = opt.value;
                            services.saveSettings();
                        }),
                );
            }

            menu.showAtMouseEvent(e.nativeEvent);
        },
        [collectionSort, itemSort],
    );

    const treeData = useMemo(() => {
        if (!rawData) return [];
        const tree = rebuildTreeFromWorker(rawData);
        return sortTree(tree, collectionSort, itemSort);
    }, [rawData, collectionSort, itemSort]);

    // Sort helper for bookmark/recent lists
    const sortBookmarkRecent = <
        T extends { name: string; addedAt?: number; openedAt?: number },
    >(
        items: T[],
    ): T[] => {
        const sorted = [...items];
        // Use the same item sort for bookmarks/recents
        switch (itemSort) {
            case "title-asc":
                sorted.sort((a, b) => cmpStr(a.name, b.name));
                break;
            case "title-desc":
                sorted.sort((a, b) => -cmpStr(a.name, b.name));
                break;
            case "added-new":
            case "modified-new":
                sorted.sort(
                    (a, b) =>
                        (b.addedAt ?? b.openedAt ?? 0) -
                        (a.addedAt ?? a.openedAt ?? 0),
                );
                break;
            case "added-old":
            case "modified-old":
                sorted.sort(
                    (a, b) =>
                        (a.addedAt ?? a.openedAt ?? 0) -
                        (b.addedAt ?? b.openedAt ?? 0),
                );
                break;
        }
        return sorted;
    };

    // Filter bookmarks/recents by search term
    const filterByTerm = <T extends { name: string }>(items: T[]): T[] => {
        if (!term) return items;
        const lower = term.toLowerCase();
        return items.filter((i) => i.name.toLowerCase().includes(lower));
    };

    const handleToggle = useCallback((id: string) => {
        if (persistedOpenState[id]) {
            delete persistedOpenState[id];
        } else {
            persistedOpenState[id] = true;
        }
    }, []);

    const handleSearch = (node: NodeApi<ViewNode>, term: string) => {
        const lowerTerm = term.toLowerCase();

        /* ================================================================ */
        /*  Case A: Item (Parent Node)                                     */
        /* ================================================================ */
        if (node.data.nodeType === "item") {
            // Does it match itself?
            if (node.data.name.toLowerCase().includes(lowerTerm)) return true;

            // Only "real attachments" count as a match, Source Note does not count
            if (node.data.children) {
                const hasValidChild = node.data.children.some((child) =>
                    child.name.toLowerCase().includes(lowerTerm),
                );
                if (hasValidChild) return true;
            }

            return false;
        }

        /* ================================================================ */
        /*  Case B: Child Node (Source Note or PDF)                        */
        /* ================================================================ */
        if (node.parent && node.parent.data.nodeType === "item") {
            const parent = node.parent;

            // Does the parent match?
            if (parent.data.name.toLowerCase().includes(lowerTerm)) {
                return true;
            }

            // Check if any sibling matches (or if I match myself)
            const hasValidSibling = parent.data.children.some((sibling) =>
                sibling.name.toLowerCase().includes(lowerTerm),
            );

            if (hasValidSibling) {
                return true;
            }

            return false;
        }

        /* ================================================================ */
        /*  Case C: Standalone Attachment                                  */
        /* ================================================================ */
        return node.data.name.toLowerCase().includes(lowerTerm);
    };

    // --- Render content based on view mode ---

    const renderContent = () => {
        if (viewMode === "library") {
            return (
                <div
                    className="zotflow-tree-view-container"
                    ref={containerRef}
                >
                    {loading && (
                        <div className="zotflow-tree-loading">
                            <ObsidianIcon
                                icon="loader"
                                className="zotflow-spin"
                            />
                        </div>
                    )}
                    {!loading && (
                        <Tree
                            data={treeData}
                            width={dims.w}
                            height={dims.h}
                            rowHeight={28}
                            indent={INDENT_SIZE}
                            searchTerm={term}
                            searchMatch={handleSearch}
                            openByDefault={false}
                            initialOpenState={persistedOpenState}
                            onToggle={handleToggle}
                            disableDrag={true}
                            disableDrop={true}
                            disableMultiSelection={true}
                            dndRootElement={voidElement}
                        >
                            {NodeItem}
                        </Tree>
                    )}
                </div>
            );
        }

        if (viewMode === "bookmarks") {
            const items = filterByTerm(sortBookmarkRecent(bookmarks));
            return (
                <div className="zotflow-sidebar-list">
                    {items.length === 0 && (
                        <div className="zotflow-sidebar-empty">
                            {bookmarks.length === 0
                                ? "No bookmarks yet. Right-click an item to bookmark it."
                                : "No matching bookmarks."}
                        </div>
                    )}
                    {items.map((b) => (
                        <SidebarItem
                            key={b.id}
                            name={b.name}
                            itemType={b.itemType}
                            contentType={b.contentType}
                            libraryID={b.libraryID}
                            itemKey={b.key}
                            onRemove={() => handleRemoveBookmark(b)}
                            removeIcon="bookmark-minus"
                            removeLabel="Remove bookmark"
                        />
                    ))}
                </div>
            );
        }

        if (viewMode === "recent") {
            const items = filterByTerm(sortBookmarkRecent(recents));
            return (
                <div className="zotflow-sidebar-list">
                    {items.length === 0 && (
                        <div className="zotflow-sidebar-empty">
                            {recents.length === 0
                                ? "No recent items."
                                : "No matching items."}
                        </div>
                    )}
                    {items.map((r) => (
                        <SidebarItem
                            key={r.id}
                            name={r.name}
                            itemType={r.itemType}
                            contentType={r.contentType}
                            libraryID={r.libraryID}
                            itemKey={r.key}
                            removeIcon="x"
                            removeLabel="Remove from recent"
                        />
                    ))}
                </div>
            );
        }

        if (viewMode === "notes") {
            const lower = term.toLowerCase();
            const filtered = term
                ? noteFiles.filter((f) =>
                      f.basename.toLowerCase().includes(lower),
                  )
                : noteFiles;
            const sorted = [...filtered].sort((a, b) =>
                itemSort === "title-desc"
                    ? -cmpStr(a.basename, b.basename)
                    : itemSort === "modified-new"
                      ? b.stat.mtime - a.stat.mtime
                      : itemSort === "modified-old"
                        ? a.stat.mtime - b.stat.mtime
                        : itemSort === "added-new"
                          ? b.stat.ctime - a.stat.ctime
                          : itemSort === "added-old"
                            ? a.stat.ctime - b.stat.ctime
                            : cmpStr(a.basename, b.basename),
            );
            return (
                <div className="zotflow-sidebar-list">
                    {sorted.length === 0 && (
                        <div className="zotflow-sidebar-empty">
                            {noteFiles.length === 0
                                ? "No source notes found."
                                : "No matching notes."}
                        </div>
                    )}
                    {sorted.map((f) => (
                        <div
                            key={f.path}
                            className="zotflow-sidebar-item"
                            onClick={() => {
                                services.app.workspace
                                    .getLeaf(false)
                                    .openFile(f);
                            }}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const menu = new Menu();
                                menu.addItem((item) => {
                                    item.setTitle("Create Companion Note")
                                        .setIcon("file-plus-2")
                                        .onClick(() => {
                                            services.plugin.promptCompanionNote(
                                                f,
                                            );
                                        });
                                });
                                menu.addItem((item) => {
                                    item.setTitle("Toggle lock")
                                        .setIcon("lock")
                                        .onClick(() => {
                                            services.app.fileManager.processFrontMatter(
                                                f,
                                                (fm) => {
                                                    fm["zotflow-locked"] =
                                                        !fm["zotflow-locked"];
                                                },
                                            );
                                        });
                                });
                                menu.showAtMouseEvent(e.nativeEvent);
                            }}
                        >
                            <ObsidianIcon
                                icon="file-text"
                                className="zotflow-file-icon"
                            />
                            <span className="zotflow-sidebar-item-name">
                                {f.basename}
                            </span>
                        </div>
                    ))}
                </div>
            );
        }

        if (viewMode === "bases") {
            const lower = term.toLowerCase();
            const filtered = term
                ? baseFiles.filter((f) =>
                      f.basename.toLowerCase().includes(lower),
                  )
                : baseFiles;

            const handleBaseContextMenu = (
                e: React.MouseEvent,
                file: TFile,
            ) => {
                e.preventDefault();
                e.stopPropagation();

                const menu = new Menu();

                menu.addItem((item) => {
                    item.setTitle("Open in new tab")
                        .setIcon("external-link")
                        .onClick(() => {
                            services.app.workspace
                                .getLeaf("tab")
                                .openFile(file);
                        });
                });

                menu.addItem((item) => {
                    item.setTitle("Delete base")
                        .setIcon("trash")
                        .onClick(async () => {
                            await services.app.vault.trash(file, true);
                        });
                });

                menu.showAtMouseEvent(e.nativeEvent);
            };

            return (
                <div className="zotflow-sidebar-list">
                    {filtered.length === 0 && (
                        <div className="zotflow-sidebar-empty">
                            {baseFiles.length === 0
                                ? "No base views yet. Right-click a collection to create one."
                                : "No matching bases."}
                        </div>
                    )}
                    {filtered.map((f) => (
                        <div
                            key={f.path}
                            className="zotflow-sidebar-item"
                            onClick={() => {
                                services.app.workspace
                                    .getLeaf(false)
                                    .openFile(f);
                            }}
                            onContextMenu={(e) =>
                                handleBaseContextMenu(e, f)
                            }
                        >
                            <ObsidianIcon
                                icon="table"
                                className="zotflow-file-icon"
                            />
                            <span className="zotflow-sidebar-item-name">
                                {f.basename}
                            </span>
                        </div>
                    ))}
                </div>
            );
        }

        return null;
    };

    return (
        <div className="zotflow-tree-view-layout">
            {/* Toolbar */}
            <div className="zotflow-toolbar">
                <div className="zotflow-toolbar-group">
                    <ToolbarButton
                        icon="library"
                        label="My Library"
                        active={viewMode === "library"}
                        onClick={() => setViewMode("library")}
                    />
                    <ToolbarButton
                        icon="clock"
                        label="Recent Items"
                        active={viewMode === "recent"}
                        onClick={() => setViewMode("recent")}
                    />
                    <ToolbarButton
                        icon="bookmark"
                        label="Bookmarks"
                        active={viewMode === "bookmarks"}
                        onClick={() => setViewMode("bookmarks")}
                    />
                    <ToolbarButton
                        icon="file-text"
                        label="Source Notes"
                        active={viewMode === "notes"}
                        onClick={() => setViewMode("notes")}
                    />
                    <ToolbarButton
                        icon="table"
                        label="Base Views"
                        active={viewMode === "bases"}
                        onClick={() => setViewMode("bases")}
                    />
                </div>
                <div className="zotflow-toolbar-separator" />
                <div className="zotflow-toolbar-group">
                    <ToolbarButton
                        icon="search"
                        label="Search"
                        active={searchOpen}
                        onClick={handleToggleSearch}
                    />
                    <ToolbarButton
                        icon="arrow-up-narrow-wide"
                        label="Change sort order"
                        onClick={handleSortMenu}
                    />
                    <ToolbarButton
                        icon="rotate-cw"
                        label="Refresh"
                        onClick={handleRefresh}
                    />
                </div>
            </div>

            {/* Search input (collapsible) */}
            {searchOpen && (
                <div className="zotflow-search-bar">
                    <div className="search-input-container global-search-input-container">
                        <input
                            ref={searchInputRef}
                            placeholder="Search..."
                            type="search"
                            value={term}
                            onChange={(e) => setTerm(e.target.value)}
                        />
                        <div
                            aria-label="Clear search"
                            onClick={() => setTerm("")}
                        ></div>
                    </div>
                </div>
            )}

            {/* Content */}
            {renderContent()}
        </div>
    );
};
