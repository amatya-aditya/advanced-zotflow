import React, { useState, useCallback, useRef, useEffect } from "react";
import { Component, MarkdownRenderer } from "obsidian";
import { workerBridge } from "bridge";
import { services } from "services/services";
import { ItemPickerModal } from "ui/modals/item-picker";
import { FilePickerModal } from "ui/modals/file-picker";
import { createEmbeddableMarkdownEditor } from "ui/editor/markdown-editor";
import { ObsidianIcon } from "ui/ObsidianIcon";

import type { EmbeddableMarkdownEditor } from "ui/editor/markdown-editor";
import type { AnyIDBZoteroItem } from "types/db-schema";
import type { TFileWithoutParentAndVault } from "types/zotflow";
import type { TFile } from "obsidian";

type TemplateContext = "library" | "local" | "library-path" | "local-path";
type OutputMode = "preview" | "source";

const CONTEXT_LABELS: Record<TemplateContext, string> = {
    library: "Library Source Note",
    local: "Local Source Note",
    "library-path": "Library Source Note Path",
    "local-path": "Local Source Note Path",
};

function needsLibraryItem(ctx: TemplateContext): boolean {
    return ctx === "library" || ctx === "library-path";
}

interface SelectedItem {
    libraryID: number;
    key: string;
    title: string;
}

/** Template testing view for the Activity Center. */
export const TemplateTestView: React.FC = () => {
    const [context, setContext] = useState<TemplateContext>("library");

    const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
    const [selectedFile, setSelectedFile] =
        useState<TFileWithoutParentAndVault | null>(null);

    const [template, setTemplate] = useState("");
    const [rendered, setRendered] = useState("");
    const [rendering, setRendering] = useState(false);
    const [error, setError] = useState("");
    const [outputMode, setOutputMode] = useState<OutputMode>("source");

    // Refs for imperative editor instances
    const templateContainerRef = useRef<HTMLDivElement>(null);
    const outputContainerRef = useRef<HTMLDivElement>(null);
    const previewContainerRef = useRef<HTMLDivElement>(null);
    const templateEditorRef = useRef<EmbeddableMarkdownEditor | null>(null);
    const outputEditorRef = useRef<EmbeddableMarkdownEditor | null>(null);
    const previewComponentRef = useRef<Component | null>(null);

    // Stable ref for current template value (avoids stale closures)
    const templateRef = useRef(template);
    templateRef.current = template;

    // Flag to skip onChange when we programmatically set the editor
    const settingProgrammatically = useRef(false);

    // Create template editor (left panel)
    useEffect(() => {
        const container = templateContainerRef.current;
        if (!container) return;

        const editor = createEmbeddableMarkdownEditor(services.app, container, {
            value: templateRef.current,
            placeholder: "Enter your template here…",
            sourceMode: true,
            showLineNumbers: true,
            onChange: () => {
                if (editor && !settingProgrammatically.current) {
                    setTemplate(editor.value);
                }
            },
        });
        templateEditorRef.current = editor;

        return () => {
            templateEditorRef.current = null;
            editor.destroy();
        };
    }, []);

    // Sync template state → template editor when context changes load a new default
    useEffect(() => {
        if (templateEditorRef.current) {
            settingProgrammatically.current = true;
            templateEditorRef.current.set(template, false);
            settingProgrammatically.current = false;
        }
    }, [template]);

    // Create / recreate output editor (right panel — source mode)
    useEffect(() => {
        if (outputMode !== "source") return;

        const container = outputContainerRef.current;
        if (!container) return;

        const editor = createEmbeddableMarkdownEditor(services.app, container, {
            value: rendered,
            readOnly: true,
            sourceMode: true,
            showLineNumbers: true,
        });
        outputEditorRef.current = editor;

        return () => {
            outputEditorRef.current = null;
            editor.destroy();
        };
        // Recreate when switching to source or when rendered output changes
    }, [outputMode, rendered]);

    // Render markdown preview (right panel — preview mode)
    useEffect(() => {
        if (outputMode !== "preview") return;

        const container = previewContainerRef.current;
        if (!container) return;

        container.empty();
        const comp = new Component();
        comp.load();
        previewComponentRef.current = comp;

        if (rendered) {
            void MarkdownRenderer.render(
                services.app,
                rendered,
                container,
                "",
                comp,
            );
        } else {
            container.createEl("span", {
                text: "Click Render to see output.",
                cls: "zotflow-template-test-placeholder",
            });
        }

        return () => {
            previewComponentRef.current = null;
            comp.unload();
        };
    }, [outputMode, rendered]);

    // Load default template when context changes
    useEffect(() => {
        void (async () => {
            try {
                let defaultTpl: string;
                switch (context) {
                    case "library":
                        defaultTpl =
                            await workerBridge.libraryTemplate.getDefaultTemplate();
                        break;
                    case "local":
                        defaultTpl =
                            await workerBridge.localTemplate.getDefaultTemplate();
                        break;
                    case "library-path":
                        defaultTpl =
                            await workerBridge.notePath.getDefaultPathTemplate(
                                "library",
                            );
                        break;
                    case "local-path":
                        defaultTpl =
                            await workerBridge.notePath.getDefaultPathTemplate(
                                "local",
                            );
                        break;
                }
                setTemplate(defaultTpl);
            } catch {
                setTemplate("");
            }
        })();
        setRendered("");
        setError("");
    }, [context]);

    // Reset item/file selection when switching between library ↔ local
    useEffect(() => {
        setSelectedItem(null);
        setSelectedFile(null);
    }, [needsLibraryItem(context)]);

    const handlePick = useCallback(() => {
        if (needsLibraryItem(context)) {
            new ItemPickerModal(services.app, (item: AnyIDBZoteroItem) => {
                setSelectedItem({
                    libraryID: item.libraryID,
                    key: item.key,
                    title: item.title || "Untitled",
                });
                setRendered("");
                setError("");
            }).open();
        } else {
            new FilePickerModal(services.app, (file: TFile) => {
                setSelectedFile({
                    path: file.path,
                    name: file.name,
                    extension: file.extension,
                    basename: file.basename,
                });
                setRendered("");
                setError("");
            }).open();
        }
    }, [context]);

    const handleRender = useCallback(async () => {
        setError("");
        setRendering(true);
        try {
            let result: string;
            const currentTemplate = templateEditorRef.current
                ? templateEditorRef.current.value
                : template;

            if (needsLibraryItem(context)) {
                if (!selectedItem) {
                    setError("Pick a Zotero item first.");
                    setRendering(false);
                    return;
                }
                if (context === "library") {
                    result = await workerBridge.libraryTemplate.previewItem(
                        selectedItem.libraryID,
                        selectedItem.key,
                        currentTemplate,
                    );
                } else {
                    result = await workerBridge.notePath.previewLibraryNotePath(
                        selectedItem.libraryID,
                        selectedItem.key,
                        currentTemplate,
                    );
                }
            } else {
                if (!selectedFile) {
                    setError("Pick a local file first.");
                    setRendering(false);
                    return;
                }
                if (context === "local") {
                    result = await workerBridge.localTemplate.previewLocalNote(
                        selectedFile,
                        currentTemplate,
                    );
                } else {
                    result = await workerBridge.notePath.previewLocalNotePath(
                        selectedFile,
                        currentTemplate,
                    );
                }
            }

            setRendered(result);
        } catch (e) {
            const msg =
                e instanceof Error ? e.message : "Template rendering failed";
            setError(msg);
            services.logService.error(
                "Template preview failed",
                "TemplateTestView",
                e,
            );
        } finally {
            setRendering(false);
        }
    }, [context, selectedItem, selectedFile, template]);

    const selectionLabel = needsLibraryItem(context)
        ? (selectedItem?.title ?? "No item selected")
        : (selectedFile?.path ?? "No file selected");

    return (
        <div className="zotflow-template-test">
            {/* ── Environment ── */}
            <div className="zotflow-template-test-env-section">
                <span className="zotflow-template-test-section-header">
                    Environment
                </span>

                <div className="zotflow-template-test-env">
                    <select
                        className="dropdown"
                        value={context}
                        onChange={(e) =>
                            setContext(e.target.value as TemplateContext)
                        }
                    >
                        {(
                            Object.entries(CONTEXT_LABELS) as [
                                TemplateContext,
                                string,
                            ][]
                        ).map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>

                    <button onClick={handlePick}>
                        {needsLibraryItem(context)
                            ? "Pick Zotero Item"
                            : "Pick Local File"}
                    </button>

                    <span className="zotflow-template-test-selection">
                        {selectionLabel}
                    </span>
                </div>
            </div>

            {/* ── Side-by-side panels ── */}
            <div className="zotflow-template-test-panels">
                {/* Left: Template editor */}
                <div className="zotflow-template-test-panel">
                    <div className="zotflow-template-test-panel-header">
                        <span className="zotflow-template-test-section-header">
                            Template
                        </span>
                        <button
                            className="clickable-icon"
                            aria-label="Copy template"
                            onClick={() => {
                                const value = templateEditorRef.current
                                    ? templateEditorRef.current.value
                                    : template;
                                void navigator.clipboard.writeText(value);
                                services.notificationService.notify(
                                    "success",
                                    "Template copied to clipboard",
                                );
                            }}
                        >
                            <ObsidianIcon icon="copy" />
                        </button>
                    </div>
                    <div
                        ref={templateContainerRef}
                        className="zotflow-template-test-editor"
                    />
                </div>

                {/* Right: Output with preview/source toggle */}
                <div className="zotflow-template-test-panel">
                    <div className="zotflow-template-test-panel-header">
                        <span className="zotflow-template-test-section-header">
                            Output
                        </span>
                        <div className="zotflow-template-test-mode-toggle">
                            <button
                                className={`clickable-icon ${outputMode === "source" ? "is-active" : ""}`}
                                onClick={() => setOutputMode("source")}
                                aria-label="Source view"
                            >
                                <ObsidianIcon icon="code" />
                            </button>
                            <button
                                className={`clickable-icon ${outputMode === "preview" ? "is-active" : ""}`}
                                onClick={() => setOutputMode("preview")}
                                aria-label="Reading view"
                            >
                                <ObsidianIcon icon="book-open" />
                            </button>
                        </div>
                    </div>

                    {outputMode === "source" && (
                        <div
                            ref={outputContainerRef}
                            className="zotflow-template-test-output"
                        />
                    )}
                    {outputMode === "preview" && (
                        <div
                            ref={previewContainerRef}
                            className="zotflow-template-test-output zotflow-template-test-preview"
                        />
                    )}
                </div>
            </div>

            {error && (
                <div className="zotflow-template-test-error">{error}</div>
            )}

            {/* ── Actions ── */}
            <div className="zotflow-template-test-actions">
                <button
                    className="mod-cta"
                    onClick={handleRender}
                    disabled={rendering}
                >
                    {rendering ? "Rendering..." : "Render"}
                </button>
            </div>
        </div>
    );
};
