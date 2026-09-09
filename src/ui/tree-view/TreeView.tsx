import React, {
    useState,
    useRef,
    useLayoutEffect,
    useEffect,
    useMemo,
    useCallback,
    createContext,
} from "react";
import { Menu } from "obsidian";
import { NodeApi, Tree } from "react-arborist";
import { workerBridge } from "bridge";
import { ObsidianIcon } from "../ObsidianIcon";
import { NodeItem, INDENT_SIZE } from "./Node";
import { TreeSearchSuggest } from "./search-suggest";
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
import { normalizePath, TFile, TFolder } from "obsidian";
import type { TAbstractFile } from "obsidian";
import { fireAndForgetIn } from "utils/fire-and-forget";

const ff = fireAndForgetIn("TreeView");

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
    syncStatus?: string;
    tags?: string[];
};

type NotesSidebarNode = {
    id: string;
    file: TFile;
    kind: "source" | "companion";
    children: NotesSidebarNode[];
};
/** Shared search state provided to tree nodes for highlighting matched text. */
export interface TreeSearchState {
    matchKeys: Set<string>;
    freeTokens: string[];
}

export const TreeSearchContext = createContext<TreeSearchState>({
    matchKeys: new Set<string>(),
    freeTokens: [],
});

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
            syncStatus: entity.syncStatus,
            tags: entity.tags,

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

function extractLinkPath(linkText: string): string {
    return linkText.replace(/\[\[|\]\]/g, "").split("|")[0]?.trim() || "";
}

function compareNoteFiles(
    a: TFile,
    b: TFile,
    itemSort: ItemSortOrder,
): number {
    switch (itemSort) {
        case "title-desc":
            return -cmpStr(a.basename, b.basename);
        case "modified-new":
            return b.stat.mtime - a.stat.mtime;
        case "modified-old":
            return a.stat.mtime - b.stat.mtime;
        case "added-new":
            return b.stat.ctime - a.stat.ctime;
        case "added-old":
            return a.stat.ctime - b.stat.ctime;
        default:
            return cmpStr(a.basename, b.basename);
    }
}

function buildNotesSidebarTree(
    sourceFiles: TFile[],
    itemSort: ItemSortOrder,
    term: string,
): NotesSidebarNode[] {
    const roots = sourceFiles.map((file) => ({
        id: `source:${file.path}`,
        file,
        kind: "source" as const,
        children: [],
    }));

    const sourceByPath = new Map<string, NotesSidebarNode>(
        roots.map((node) => [normalizePath(node.file.path), node]),
    );

    const orphanCompanions: NotesSidebarNode[] = [];
    for (const file of services.app.vault.getMarkdownFiles()) {
        const frontmatter = services.app.metadataCache.getFileCache(file)
            ?.frontmatter;
        const companionOf: unknown = frontmatter?.["zotflow-companion-of"];

        if (typeof companionOf !== "string") continue;

        const sourceDest = services.app.metadataCache.getFirstLinkpathDest(
            extractLinkPath(companionOf),
            file.path,
        );

        const companionNode: NotesSidebarNode = {
            id: `companion:${file.path}`,
            file,
            kind: "companion",
            children: [],
        };

        if (sourceDest?.path) {
            const sourceNode = sourceByPath.get(normalizePath(sourceDest.path));
            if (sourceNode) {
                sourceNode.children.push(companionNode);
                continue;
            }
        }

        orphanCompanions.push(companionNode);
    }

    const sortNodes = (nodes: NotesSidebarNode[]) => {
        nodes.sort((a, b) => compareNoteFiles(a.file, b.file, itemSort));
        nodes.forEach((node) => {
            if (node.children.length > 0) sortNodes(node.children);
        });
    };

    sortNodes(roots);
    sortNodes(orphanCompanions);

    const allRoots = [...roots, ...orphanCompanions];
    if (!term) return allRoots;

    const lower = term.toLowerCase();

    const filterNode = (node: NotesSidebarNode): NotesSidebarNode | null => {
        const selfMatches = node.file.basename.toLowerCase().includes(lower);

        if (node.kind === "companion") {
            return selfMatches ? { ...node, children: [] } : null;
        }

        const filteredChildren = node.children
            .map(filterNode)
            .filter((child): child is NotesSidebarNode => child !== null);

        if (selfMatches) {
            return { ...node, children: node.children };
        }

        if (filteredChildren.length > 0) {
            return { ...node, children: filteredChildren };
        }

        return null;
    };

    return allRoots
        .map(filterNode)
        .filter((node): node is NotesSidebarNode => node !== null);
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
        await services.addRecentItem({
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
                    await services.addRecentItem({
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
                        await workerBridge.libraryNote.openNote(libraryID, itemKey, {
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
                        await services.addRecentItem({
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
            onClick={() => { ff(handleClick(), "Failed to open sidebar item"); }}
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
    const [searchState, setSearchState] = useState<{
        term: string;
        matchKeys: Set<string>;
        freeTokens: string[];
    }>({ term: "", matchKeys: new Set<string>(), freeTokens: [] });
    const [loading, setLoading] = useState(true);
    const containerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [dims, setDims] = useState({ w: 300, h: 500 });
    const [bookmarks, setBookmarks] = useState<BookmarkedItem[]>(
        services.getBookmarkedItems(),
    );
    const [recents, setRecents] = useState<RecentItem[]>(
        services.getRecentItems(),
    );
    const [, refreshSettings] = useState(0);
    useEffect(() => services.onSettingsChanged(() => refreshSettings((n) => n + 1)), []);
    const [viewMode, setViewMode] = useState<ViewMode>("library");
    const [searchOpen, setSearchOpen] = useState(false);

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

    // Load source notes when switching to notes view and refresh on vault changes.
    useEffect(() => {
        if (viewMode !== "notes") return;

        const loadNotes = () => {
            setNoteFiles([...services.indexService.getIndexedFilesList()]);
        };

        loadNotes();

        const onCreate = services.app.vault.on("create", (file) => {
            if (file instanceof TFile && file.extension === "md") loadNotes();
        });
        const onDelete = services.app.vault.on("delete", (file) => {
            if (file instanceof TFile && file.extension === "md") loadNotes();
        });
        const onRename = services.app.vault.on("rename", (file) => {
            if (file instanceof TFile && file.extension === "md") loadNotes();
        });
        const onChanged = services.app.metadataCache.on("changed", (file) => {
            if (file instanceof TFile && file.extension === "md") loadNotes();
        });

        return () => {
            services.app.vault.offref(onCreate);
            services.app.vault.offref(onDelete);
            services.app.vault.offref(onRename);
            services.app.metadataCache.offref(onChanged);
        };
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
                if (f instanceof TFile && f.extension === "base") {
                    files.push(f);
                }
                if (f instanceof TFolder) {
                    f.children.forEach(collectFiles);
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
    }, [viewMode]);

    // Attach operator/value autocomplete to the search input (once).
    useEffect(() => {
        if (!searchInputRef.current) return;
        const suggest = new TreeSearchSuggest(services.app, searchInputRef.current, (value) =>
            setTerm(value),
        );
        return () => suggest.close();
    }, [searchOpen]);

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

        void loadTree();
    }, []);

    // Debounced worker-side fuzzy search. Results (matched entity keys +
    // highlight tokens) are cached and applied synchronously by `matchNode`.
    useEffect(() => {
        const trimmed = term.trim();
        if (!trimmed) {
            setSearchState({
                term: "",
                matchKeys: new Set<string>(),
                freeTokens: [],
            });
            return;
        }

        let cancelled = false;
        const handle = window.setTimeout(() => {
            void (async () => {
                try {
                    const res = await workerBridge.treeView.searchTree(trimmed);
                    if (!cancelled) {
                        setSearchState({
                            term: trimmed,
                            matchKeys: new Set(res.matchedKeys),
                            freeTokens: res.freeTokens,
                        });
                    }
                } catch (err) {
                    services.logService.error(
                        "Tree search failed",
                        "TreeView",
                        err,
                    );
                }
            })();
        }, 150);

        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [term]);

    // Refresh tree data when a child note is created or updated
    useEffect(() => {
        const refreshHandler = async () => {
            try {
                await workerBridge.treeView.refreshTree();
                const flat = await workerBridge.treeView.getOptimizedTree();
                setRawData(flat);
            } catch (err) {
                services.logService.error(
                    "Failed to refresh tree after note change",
                    "TreeView",
                    err,
                );
            }
        };
        const unsub1 =
            services.taskMonitor.noteChangedByEditor.subscribe(
                () => void refreshHandler(),
            );
        const unsub2 =
            services.taskMonitor.noteChangedByNoteView.subscribe(
                () => void refreshHandler(),
            );
        const unsub3 =
            services.taskMonitor.treeChanged.subscribe(
                () => void refreshHandler(),
            );
        return () => {
            unsub1();
            unsub2();
            unsub3();
        };
    }, []);

    // Prevent react-dnd from interfering with global events
    const voidElement = useMemo(() => createDiv(), []);

    const handleRefresh = async () => {
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
                            ff(services.saveSettings(), "Failed to save settings");
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
                            ff(services.saveSettings(), "Failed to save settings");
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

    // The matching logic for the tree view:
    // - All children shown
    // - Leaf matches balloon into attachments
    // - Siblings stay collapsed
    const effectiveMatchKeys = useMemo(() => {
        const base = searchState.matchKeys;
        if (base.size === 0) return base;

        const result = new Set(base);
        const visit = (nodes: ViewNode[]) => {
            for (const n of nodes) {
                if (n.children.length === 0) continue;
                if (n.nodeType === "item") {
                    const selfMatched = base.has(n.key);
                    const childMatched = n.children.some((c) =>
                        base.has(c.key),
                    );
                    if (selfMatched || childMatched) {
                        result.add(n.key);
                        for (const c of n.children) result.add(c.key);
                    }
                }
                visit(n.children);
            }
        };
        visit(treeData);
        return result;
    }, [treeData, searchState.matchKeys]);

    const handleSearch = useCallback(
        (node: NodeApi<ViewNode>): boolean => {
            if (effectiveMatchKeys.size === 0) return false;
            return effectiveMatchKeys.has(node.data.key);
        },
        [effectiveMatchKeys],
    );

    const handleNotesContextMenu = useCallback(
        (e: React.MouseEvent, file: TFile, kind: "source" | "companion") => {
            e.preventDefault();
            e.stopPropagation();

            const menu = new Menu();

            if (kind === "source") {
                menu.addItem((item) => {
                    item.setTitle("Create Companion Note")
                        .setIcon("file-plus-2")
                        .onClick(() => {
                            services.plugin.promptCompanionNote(file);
                        });
                });
            }

            menu.addItem((item) => {
                item.setTitle("Toggle lock")
                    .setIcon("lock")
                    .onClick(() => {
                        ff(services.app.fileManager.processFrontMatter(
                            file,
                            (fm: Record<string, unknown>) => {
                                fm["zotflow-locked"] = !fm["zotflow-locked"];
                            },
                        ), "Failed to toggle source note lock");
                    });
            });

            menu.showAtMouseEvent(e.nativeEvent);
        },
        [],
    );

    const notesTree = useMemo(
        () => buildNotesSidebarTree(noteFiles, itemSort, term),
        [noteFiles, itemSort, term],
    );

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
                            searchTerm={searchState.term}
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
                            onRemove={() => { ff(handleRemoveBookmark(b), "Failed to remove bookmark"); }}
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
                            onRemove={() => { ff(services.removeRecentItem(r.id), "Failed to remove recent item"); }}
                            removeLabel="Remove from recent"
                        />
                    ))}
                </div>
            );
        }

        if (viewMode === "notes") {
            const renderNoteNode = (
                noteNode: NotesSidebarNode,
                depth: number = 0,
            ): React.ReactNode => (
                <React.Fragment key={noteNode.id}>
                    <div
                        className={`zotflow-sidebar-item${noteNode.kind === "companion" ? " zotflow-sidebar-item--companion" : ""}`}
                        style={{ paddingLeft: `${8 + depth * INDENT_SIZE}px` }}
                        onClick={() => {
                            ff(services.app.workspace.getLeaf(false).openFile(noteNode.file), "Failed to open file");
                        }}
                        onContextMenu={(e) =>
                            handleNotesContextMenu(
                                e,
                                noteNode.file,
                                noteNode.kind,
                            )
                        }
                    >
                        <ObsidianIcon
                            icon={
                                noteNode.kind === "source"
                                    ? "file-text"
                                    : "file-pen"
                            }
                            className="zotflow-file-icon"
                        />
                        <span className="zotflow-sidebar-item-name">
                            {noteNode.file.basename}
                        </span>
                        {noteNode.kind === "companion" && (
                            <div className="nav-file-tag">Companion</div>
                        )}
                    </div>
                    {noteNode.children.map((child) =>
                        renderNoteNode(child, depth + 1),
                    )}
                </React.Fragment>
            );

            return (
                <div className="zotflow-sidebar-list">
                    {notesTree.length === 0 && (
                        <div className="zotflow-sidebar-empty">
                            {noteFiles.length === 0
                                ? "No source notes found."
                                : "No matching notes."}
                        </div>
                    )}
                    {notesTree.map((node) => renderNoteNode(node))}
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
                            ff(services.app.workspace.getLeaf("tab").openFile(file), "Failed to open file");
                        });
                });

                menu.addItem((item) => {
                    item.setTitle("Delete base")
                        .setIcon("trash")
                        .onClick(async () => {
                            await services.app.fileManager.trashFile(file);
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
                                ff(services.app.workspace.getLeaf(false).openFile(f), "Failed to open file");
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
        <TreeSearchContext.Provider value={{ matchKeys: searchState.matchKeys, freeTokens: searchState.freeTokens }}>
        <div className={`zotflow-tree-view-layout${services.settings.showTreeItemIcons ? "" : " zotflow-hide-tree-icons"}`}>
            {/* Toolbar */}
            <div className="zotflow-toolbar">
                <div className="zotflow-toolbar-group">
                    {services.settings.showTreeLibrary && (<ToolbarButton
                        icon="library"
                        label="My Library"
                        active={viewMode === "library"}
                        onClick={() => setViewMode("library")}
                    />)}
                    {services.settings.showTreeRecents && (<ToolbarButton
                        icon="clock"
                        label="Recent Items"
                        active={viewMode === "recent"}
                        onClick={() => setViewMode("recent")}
                    />)}
                    {services.settings.showTreeBookmarks && (<ToolbarButton
                        icon="bookmark"
                        label="Bookmarks"
                        active={viewMode === "bookmarks"}
                        onClick={() => setViewMode("bookmarks")}
                    />)}
                    {services.settings.showTreeNotes && (<ToolbarButton
                        icon="file-text"
                        label="Source Notes"
                        active={viewMode === "notes"}
                        onClick={() => setViewMode("notes")}
                    />)}
                    {services.settings.showTreeBases && (<ToolbarButton
                        icon="table"
                        label="Base Views"
                        active={viewMode === "bases"}
                        onClick={() => setViewMode("bases")}
                    />)}
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
                        onClick={() => { ff(handleRefresh(), "Failed to refresh tree"); }}
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
        </TreeSearchContext.Provider>
    );
};
