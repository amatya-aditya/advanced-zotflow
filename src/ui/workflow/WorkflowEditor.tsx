/**
 * Main React component for the ZotFlow workflow editor.
 *
 * Wraps `@xyflow/react` (`ReactFlow`) and binds it to a Zustand store
 * that the Obsidian `FileView` wrapper creates per open file.
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    MiniMap,
    BackgroundVariant,
    MarkerType,
    useReactFlow,
} from "@xyflow/react";
import { useStore } from "zustand";

import type { DefaultEdgeOptions, IsValidConnection } from "@xyflow/react";

import { getNodeType, getRegisteredNodeTypes } from "./node-registry";

import { NodePalette } from "./nodes/NodePalette";
import { NodePropertiesPanel } from "./properties/NodePropertiesPanel";
import { WorkflowStoreContext } from "./store-context";

import type { StoreApi } from "zustand/vanilla";
import type { WorkflowState } from "./store";
import type { WorkflowNode } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WorkflowEditorProps {
    store: StoreApi<WorkflowState>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function WorkflowEditorCanvas({ store }: WorkflowEditorProps) {
    const nodes = useStore(store, (s) => s.nodes);
    const edges = useStore(store, (s) => s.edges);
    const viewport = useStore(store, (s) => s.viewport);
    const onNodesChange = useStore(store, (s) => s.onNodesChange);
    const onEdgesChange = useStore(store, (s) => s.onEdgesChange);
    const onConnect = useStore(store, (s) => s.onConnect);
    const onViewportChange = useStore(store, (s) => s.onViewportChange);

    const { screenToFlowPosition, getInternalNode } = useReactFlow();

    /** Build nodeTypes dynamically from the registry. */
    const nodeTypes = useMemo(() => getRegisteredNodeTypes(), []);

    // --- Debounced validation on graph changes ---
    const runValidation = useStore(store, (s) => s.runValidation);
    const validationTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => {
        if (validationTimer.current !== undefined) {
            clearTimeout(validationTimer.current);
        }
        validationTimer.current = setTimeout(() => {
            runValidation();
        }, 300);
        return () => {
            if (validationTimer.current !== undefined) {
                clearTimeout(validationTimer.current);
            }
        };
    }, [nodes, edges, runValidation]);

    /**
     * Only allow a connection when the source handle has no existing
     * outgoing edge. This ensures each output connects to at most one
     * downstream node, keeping the control-flow linear.
     */
    const isValidConnection: IsValidConnection = useCallback(
        (connection) =>
            !edges.some(
                (e) =>
                    e.source === connection.source &&
                    e.sourceHandle === connection.sourceHandle,
            ),
        [edges],
    );

    const defaultEdgeOptions: DefaultEdgeOptions = useMemo(
        () => ({
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        }),
        [],
    );

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();

            const type = event.dataTransfer.getData("application/reactflow");

            // If the drag was aborted or originated externally, there's no type
            if (!type) return;

            const def = getNodeType(type);
            const position = screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });

            // Check if the drop lands inside a compound node.
            // We need to resolve absolute positions (nested compounds have
            // positions relative to their parent) and pick the deepest match.
            const currentNodes = store.getState().nodes;
            const nodeMap = new Map(currentNodes.map((n) => [n.id, n]));

            /** Compute absolute position by walking the parentId chain. */
            const getAbsolutePosition = (
                n: WorkflowNode,
            ): { x: number; y: number } => {
                let x = n.position.x;
                let y = n.position.y;
                let current = n;
                while (current.parentId) {
                    const parent = nodeMap.get(current.parentId);
                    if (!parent) break;
                    x += parent.position.x;
                    y += parent.position.y;
                    current = parent;
                }
                return { x, y };
            };

            let parentId: string | undefined;
            let smallestArea = Infinity;

            for (const n of currentNodes) {
                const nDef = getNodeType(n.type);
                if (!nDef?.isCompound) continue;

                const internal = getInternalNode(n.id);
                if (!internal) continue;

                const w = internal.measured.width ?? n.width ?? 300;
                const h = internal.measured.height ?? n.height ?? 200;
                const abs = getAbsolutePosition(n);

                if (
                    position.x >= abs.x &&
                    position.x <= abs.x + w &&
                    position.y >= abs.y &&
                    position.y <= abs.y + h
                ) {
                    // Pick the smallest (deepest / innermost) compound
                    const area = w * h;
                    if (area < smallestArea) {
                        smallestArea = area;
                        parentId = n.id;
                    }
                }
            }

            // Compute position relative to the chosen parent
            const parentNode = parentId ? nodeMap.get(parentId) : undefined;
            const parentAbs = parentNode
                ? getAbsolutePosition(parentNode)
                : undefined;

            const newNode: WorkflowNode = {
                id: crypto.randomUUID(),
                type,
                position: parentAbs
                    ? {
                          x: position.x - parentAbs.x,
                          y: position.y - parentAbs.y,
                      }
                    : position,
                data: def?.defaultData ?? {
                    label: def?.displayName ?? "New Node",
                },
                ...(parentId ? { parentId, extent: "parent" as const } : {}),
            };

            store.getState().addNode(newNode);
        },
        [screenToFlowPosition, store, getInternalNode],
    );

    return (
        <WorkflowStoreContext.Provider value={store}>
            <div className="zotflow-wf-container">
                <div className="zotflow-wf-canvas">
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        nodeTypes={nodeTypes}
                        defaultEdgeOptions={defaultEdgeOptions}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        isValidConnection={isValidConnection}
                        defaultViewport={viewport}
                        onViewportChange={onViewportChange}
                        onDrop={onDrop}
                        onDragOver={onDragOver}
                        fitView={nodes.length > 0}
                        fitViewOptions={{ padding: 0.2 }}
                        deleteKeyCode={["Backspace", "Delete"]}
                        proOptions={{ hideAttribution: true }}
                    >
                        <Background
                            variant={BackgroundVariant.Dots}
                            gap={30}
                            size={1}
                            color="var(--text-faint)"
                        />
                        <Controls
                            showInteractive={false}
                            className="zotflow-wf-controls"
                        />
                        <MiniMap
                            className="zotflow-wf-minimap"
                            nodeColor="var(--color-accent)"
                            maskColor="var(--background-modifier-cover)"
                        />
                        <NodePalette />
                        <NodePropertiesPanel />
                    </ReactFlow>
                </div>
            </div>
        </WorkflowStoreContext.Provider>
    );
}

export function WorkflowEditor({ store }: WorkflowEditorProps) {
    return (
        <ReactFlowProvider>
            <WorkflowEditorCanvas store={store} />
        </ReactFlowProvider>
    );
}
