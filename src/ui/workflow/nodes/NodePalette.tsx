/**
 * Node Palette Sidebar for the workflow editor.
 * Drag and drop nodes onto the canvas — items generated from the node registry.
 */
import React, { useState } from "react";
import { Panel } from "@xyflow/react";
import { ObsidianIcon } from "ui/ObsidianIcon";
import { getNodesByCategory, CATEGORY_META } from "../node-registry";

import type { NodeCategory } from "../types";

const CATEGORIES: NodeCategory[] = ["trigger", "action", "control"];

export function NodePalette() {
    const [isExpanded, setIsExpanded] = useState(true);

    const onDragStart = (
        event: React.DragEvent<HTMLDivElement>,
        nodeType: string,
    ) => {
        event.dataTransfer.setData("application/reactflow", nodeType);
        event.dataTransfer.effectAllowed = "move";
    };

    return (
        <Panel
            position="top-left"
            className="zotflow-wf-palette"
            onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
            onDrop={(e) => {
                e.stopPropagation();
            }}
        >
            <div
                className="zotflow-wf-palette-header"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="zotflow-wf-palette-title">Nodes</div>
                <div
                    className={`zotflow-wf-palette-toggle ${isExpanded ? "expanded" : ""}`}
                >
                    <ObsidianIcon icon="chevron-down" />
                </div>
            </div>

            <div
                className={`zotflow-wf-palette-content ${isExpanded ? "expanded" : "collapsed"}`}
            >
                <div className={`zotflow-wf-palette-content-inner ${isExpanded ? "expanded" : ""}`}>
                    <div className="zotflow-wf-palette-desc">
                        Drag and drop nodes onto the canvas.
                    </div>

                    {CATEGORIES.map((cat) => {
                        const defs = getNodesByCategory(cat);
                        if (defs.length === 0) return null;
                        const meta = CATEGORY_META[cat];
                        return (
                            <React.Fragment key={cat}>
                                <div className="zotflow-wf-palette-section">
                                    {meta.label}
                                </div>
                                {defs.map((def) => (
                                    <div
                                        key={def.type}
                                        className="zotflow-wf-palette-item"
                                        title={def.description}
                                        onDragStart={(e) =>
                                            onDragStart(e, def.type)
                                        }
                                        style={
                                            {
                                                "--node-color-rgb":
                                                    def.colorVar,
                                            } as React.CSSProperties
                                        }
                                        draggable
                                    >
                                        <ObsidianIcon icon={def.icon} />
                                        {def.displayName}
                                    </div>
                                ))}
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>
        </Panel>
    );
}
