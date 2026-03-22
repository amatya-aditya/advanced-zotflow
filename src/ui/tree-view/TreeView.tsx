import React, {
    useState,
    useRef,
    useLayoutEffect,
    useEffect,
    useMemo,
    useCallback,
} from "react";
import { NodeApi, Tree } from "react-arborist";
import { workerBridge } from "bridge";
import { ObsidianIcon } from "../ObsidianIcon";
import { NodeItem, INDENT_SIZE } from "./Node";
import { services } from "services/services";
import { getAttachmentFileIcon, getItemTypeIcon } from "ui/icons";
import { openAttachment } from "ui/viewer";

import type { TreeTransferPayload } from "worker/services/tree-view";
import type { BookmarkedItem, RecentItem } from "settings/types";

// --- TYPES ---

type ViewMode = "library" | "bookmarks" | "recent";
type SortMode = "name-asc" | "name-desc" | "date-asc" | "date-desc";

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

// --- Sidebar Item (for bookmarks & recents) ---

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
            await workerBridge.note.openNote(libraryID, itemKey, {
                forceUpdateContent: true,
                forceUpdateImages: false,
            });
        }
    };

    return (
        <div className="zotflow-sidebar-item" onClick={handleClick}>
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

// --- Sort Menu Labels ---
const SORT_LABELS: Record<SortMode, string> = {
    "name-asc": "Name (A-Z)",
    "name-desc": "Name (Z-A)",
    "date-asc": "Date (Oldest)",
    "date-desc": "Date (Newest)",
};

const SORT_CYCLE: SortMode[] = [
    "name-asc",
    "name-desc",
    "date-asc",
    "date-desc",
];

// --- Toolbar Icon Button ---

const ToolbarButton = ({
    icon,
    label,
    active = false,
    onClick,
}: {
    icon: string;
    label: string;
    active?: boolean;
    onClick: () => void;
}) => (
    <div
        className={`clickable-icon zotflow-toolbar-btn ${active ? "is-active" : ""}`}
        aria-label={label}
        onClick={onClick}
    >
        <ObsidianIcon icon={icon} />
    </div>
);

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
    const [sortMode, setSortMode] = useState<SortMode>("name-asc");
    const searchInputRef = useRef<HTMLInputElement>(null);

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

    const handleCycleSort = () => {
        setSortMode((prev) => {
            const idx = SORT_CYCLE.indexOf(prev);
            return SORT_CYCLE[(idx + 1) % SORT_CYCLE.length]!;
        });
    };

    const treeData = useMemo(() => {
        if (!rawData) return [];
        return rebuildTreeFromWorker(rawData);
    }, [rawData]);

    // Sort helper for bookmark/recent lists
    const sortList = <T extends { name: string; addedAt?: number; openedAt?: number }>(
        items: T[],
        mode: SortMode,
    ): T[] => {
        const sorted = [...items];
        switch (mode) {
            case "name-asc":
                sorted.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case "name-desc":
                sorted.sort((a, b) => b.name.localeCompare(a.name));
                break;
            case "date-asc":
                sorted.sort(
                    (a, b) =>
                        (a.addedAt ?? a.openedAt ?? 0) -
                        (b.addedAt ?? b.openedAt ?? 0),
                );
                break;
            case "date-desc":
                sorted.sort(
                    (a, b) =>
                        (b.addedAt ?? b.openedAt ?? 0) -
                        (a.addedAt ?? a.openedAt ?? 0),
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

    const handleSearch = (node: NodeApi<ViewNode>, term: string) => {
        const lowerTerm = term.toLowerCase();

        // ==================================================
        // Case A: Item (Parent Node)
        // ==================================================
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

        // ==================================================
        // Case B: Child Node (Source Note or PDF)
        // ==================================================
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

        // ==================================================
        // Case C: Standalone Attachment
        // ==================================================
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
            const items = filterByTerm(sortList(bookmarks, sortMode));
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
            const items = filterByTerm(
                sortMode === "name-asc" || sortMode === "name-desc"
                    ? sortList(recents, sortMode)
                    : recents,
            );
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
                        icon="arrow-up-down"
                        label={`Sort: ${SORT_LABELS[sortMode]}`}
                        onClick={handleCycleSort}
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
