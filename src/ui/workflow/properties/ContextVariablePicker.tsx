/**
 * Context Variable Picker — a button + popover that lets users browse and
 * insert available context variables (e.g. `{{trigger.itemKey}}`) into
 * expression input fields.
 *
 * Exports `ContextVariablePickerButton` which is consumed by `PropertyInput`
 * and `PropertyTextarea` when their `nodeId` prop is set.
 */

import React, {
    useState,
    useRef,
    useCallback,
    useEffect,
    useMemo,
} from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";

import { ObsidianIcon } from "ui/ObsidianIcon";
import { getAvailableContextPaths } from "../context/context-query";
import { useWorkflowStoreApi } from "../store-context";

// ---------------------------------------------------------------------------
// Tree data structure
// ---------------------------------------------------------------------------

interface VariableTreeNode {
    name: string;
    fullPath: string;
    type?: string;
    optional?: boolean;
    description?: string;
    children: VariableTreeNode[];
}

/** Build a tree from flat dot-path variable descriptors. */
function buildVariableTree(
    paths: {
        path: string;
        type: string;
        optional: boolean;
        description?: string;
    }[],
): VariableTreeNode[] {
    const root: VariableTreeNode[] = [];

    for (const p of paths) {
        const segments = p.path.split(".");
        let siblings = root;

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i]!;
            const isLast = i === segments.length - 1;

            let existing = siblings.find((n) => n.name === seg);
            if (!existing) {
                existing = {
                    name: seg,
                    fullPath: segments.slice(0, i + 1).join("."),
                    children: [],
                };
                siblings.push(existing);
            }

            if (isLast) {
                existing.type = p.type;
                existing.optional = p.optional;
                existing.description = p.description;
            }

            siblings = existing.children;
        }
    }

    return root;
}

/** Recursively check if a node or any descendant matches the search term. */
function nodeMatchesSearch(node: VariableTreeNode, term: string): boolean {
    const lower = term.toLowerCase();
    if (node.name.toLowerCase().includes(lower)) return true;
    if (node.fullPath.toLowerCase().includes(lower)) return true;
    if (node.description?.toLowerCase().includes(lower)) return true;
    return node.children.some((child) => nodeMatchesSearch(child, term));
}

// ---------------------------------------------------------------------------
// Tree item (recursive)
// ---------------------------------------------------------------------------

function VariableTreeItem({
    node,
    depth,
    searchTerm,
    onSelect,
}: {
    node: VariableTreeNode;
    depth: number;
    searchTerm: string;
    onSelect: (path: string) => void;
}) {
    const [isOpen, setIsOpen] = useState(true);
    const isLeaf = node.children.length === 0;

    if (searchTerm && !nodeMatchesSearch(node, searchTerm)) return null;

    return (
        <>
            <div
                className={`zotflow-wf-ctx-row ${isLeaf ? "is-leaf" : "is-branch"}`}
                style={{ paddingLeft: depth * 14 + 6 }}
                onClick={() => {
                    if (isLeaf) onSelect(node.fullPath);
                    else setIsOpen(!isOpen);
                }}
            >
                {!isLeaf && (
                    <span className="zotflow-wf-ctx-chevron">
                        <ObsidianIcon
                            icon={isOpen ? "chevron-down" : "chevron-right"}
                        />
                    </span>
                )}
                {isLeaf && (
                    <span className="zotflow-wf-ctx-leaf-icon">
                        <ObsidianIcon icon="braces" />
                    </span>
                )}
                <span className="zotflow-wf-ctx-name">{node.name}</span>
                {isLeaf && node.type && (
                    <span className="zotflow-wf-ctx-type">
                        {node.type}
                        {node.optional ? "?" : ""}
                    </span>
                )}
            </div>
            {!isLeaf &&
                isOpen &&
                node.children.map((child) => (
                    <VariableTreeItem
                        key={child.fullPath}
                        node={child}
                        depth={depth + 1}
                        searchTerm={searchTerm}
                        onSelect={onSelect}
                    />
                ))}
        </>
    );
}

// ---------------------------------------------------------------------------
// Picker popover (rendered via portal)
// ---------------------------------------------------------------------------

function PickerPopover({
    anchorRect,
    tree,
    onSelect,
    onClose,
}: {
    anchorRect: DOMRect;
    tree: VariableTreeNode[];
    onSelect: (path: string) => void;
    onClose: () => void;
}) {
    const [searchTerm, setSearchTerm] = useState("");
    const popoverRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        searchRef.current?.focus();
    }, []);

    // Close on click outside or Escape
    useEffect(() => {
        const handleMouseDown = (e: MouseEvent) => {
            if (
                popoverRef.current &&
                !popoverRef.current.contains(e.target as Node)
            ) {
                onClose();
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("mousedown", handleMouseDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleMouseDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [onClose]);

    const style: React.CSSProperties = {
        position: "fixed",
        width: Math.max(anchorRect.width, 220),
        right: window.innerWidth - anchorRect.right,
        zIndex: 1000,
    };

    if (anchorRect.bottom + 260 > window.innerHeight) {
        style.bottom = window.innerHeight - anchorRect.top + 4;
    } else {
        style.top = anchorRect.bottom + 4;
    }

    const handleSelect = (path: string) => {
        onSelect(path);
        onClose();
    };

    return createPortal(
        <div ref={popoverRef} className="zotflow-wf-ctx-popover" style={style}>
            <div className="zotflow-wf-ctx-search">
                <input
                    ref={searchRef}
                    type="search"
                    placeholder="Search variables..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            <div className="zotflow-wf-ctx-tree">
                {tree.length === 0 ? (
                    <div className="zotflow-wf-ctx-empty">
                        No context variables available
                    </div>
                ) : (
                    tree.map((node) => (
                        <VariableTreeItem
                            key={node.fullPath}
                            node={node}
                            depth={0}
                            searchTerm={searchTerm}
                            onSelect={handleSelect}
                        />
                    ))
                )}
            </div>
        </div>,
        document.body,
    );
}

// ---------------------------------------------------------------------------
// Picker button
// ---------------------------------------------------------------------------

export function ContextVariablePickerButton({
    nodeId,
    onSelect,
}: {
    nodeId: string;
    onSelect: (path: string) => void;
}) {
    const store = useWorkflowStoreApi();
    const nodes = useStore(store, (s) => s.nodes);
    const edges = useStore(store, (s) => s.edges);

    const [isOpen, setIsOpen] = useState(false);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const buttonRef = useRef<HTMLDivElement>(null);

    const tree = useMemo(() => {
        if (!isOpen) return [];
        const paths = getAvailableContextPaths(nodeId, nodes, edges);
        return buildVariableTree(paths);
    }, [isOpen, nodeId, nodes, edges]);

    const handleClick = useCallback(() => {
        if (buttonRef.current) {
            const wrapper = buttonRef.current.closest(
                ".zotflow-wf-expression-wrapper",
            );
            setAnchorRect(
                (wrapper ?? buttonRef.current).getBoundingClientRect(),
            );
        }
        setIsOpen((v) => !v);
    }, []);

    const handleClose = useCallback(() => setIsOpen(false), []);

    return (
        <>
            <ObsidianIcon
                icon="braces"
                onClick={handleClick}
                ref={buttonRef}
                iconStyle={{ width: "14px", height: "14px" }}
            />
            {isOpen && anchorRect && (
                <PickerPopover
                    anchorRect={anchorRect}
                    tree={tree}
                    onSelect={onSelect}
                    onClose={handleClose}
                />
            )}
        </>
    );
}
