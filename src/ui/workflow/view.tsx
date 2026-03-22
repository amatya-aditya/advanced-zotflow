/**
 * Obsidian view wrapper for `.zotflow` workflow files.
 *
 * Extends `TextFileView` so Obsidian handles open/save lifecycle.  On open it
 * parses the JSON payload into a Zustand store, mounts a React tree containing
 * the `WorkflowEditor` (React Flow), and persists changes back via
 * `getViewData()`.
 */

import { TextFileView, type WorkspaceLeaf } from "obsidian";
import React from "react";
import { createRoot } from "react-dom/client";

import { createWorkflowStore } from "./store";
import { WorkflowEditor } from "./WorkflowEditor";
import { DEFAULT_WORKFLOW } from "./types";
import { services } from "services/services";

import type { Root } from "react-dom/client";
import type { StoreApi } from "zustand/vanilla";
import type { WorkflowState } from "./store";
import type { WorkflowFile } from "./types";

/** Unique view type registered with Obsidian. */
export const WORKFLOW_VIEW_TYPE = "zotflow-workflow-view";

/** File extension handled by this view. */
export const WORKFLOW_EXTENSION = "zotflow";

/**
 * `TextFileView` subclass that renders a `.zotflow` file as an interactive
 * React Flow canvas backed by a Zustand store.
 */
export class ZotFlowWorkflowView extends TextFileView {
    private root: Root | null = null;
    private store: StoreApi<WorkflowState>;
    private unsubscribe: (() => void) | undefined;
    private saveTimer: ReturnType<typeof setTimeout> | undefined;

    /** Debounce interval (ms) for auto-saving after edits. */
    private static readonly SAVE_DEBOUNCE_MS = 1_000;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        this.store = createWorkflowStore(DEFAULT_WORKFLOW);
    }

    // ----- TextFileView contract -------------------------------------------

    getViewType(): string {
        return WORKFLOW_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file?.basename ?? "Workflow";
    }

    getIcon(): string {
        return "git-branch";
    }

    /**
     * Called by Obsidian when the file content should be loaded into the view.
     * Parses the JSON and pushes it into the Zustand store.
     */
    setViewData(data: string, clear: boolean): void {
        let workflow: WorkflowFile;
        try {
            workflow =
                data.trim().length === 0
                    ? { ...DEFAULT_WORKFLOW }
                    : (JSON.parse(data) as WorkflowFile);
        } catch {
            services.logService.warn(
                "Failed to parse .zotflow file — using empty workflow",
                "WorkflowView",
            );
            workflow = { ...DEFAULT_WORKFLOW };
        }

        this.store.getState().loadWorkflow(workflow);

        if (clear) {
            this.mountReact();
        }
    }

    /** Called by Obsidian when it needs the current file content to persist. */
    getViewData(): string {
        const file = this.store.getState().toWorkflowFile();
        return JSON.stringify(file, null, 2);
    }

    /** Called by Obsidian when the view is cleared (file closed). */
    clear(): void {
        this.store.getState().loadWorkflow({ ...DEFAULT_WORKFLOW });
    }

    // ----- Lifecycle -------------------------------------------------------

    async onOpen(): Promise<void> {
        this.contentEl.addClass("zotflow-wf-root");
        this.mountReact();
        this.subscribeToDirty();

        this.addAction("play", "Run workflow", () => {
            const workflow = this.store.getState().toWorkflowFile();
            services.workflowService.startRun(workflow, {
                filePath: this.file?.path,
            });
        });
    }

    async onClose(): Promise<void> {
        this.unsubscribe?.();
        if (this.saveTimer !== undefined) {
            clearTimeout(this.saveTimer);
        }
        this.root?.unmount();
        this.root = null;
    }

    // ----- Internal --------------------------------------------------------

    /** Mount (or re-mount) the React tree into `contentEl`. */
    private mountReact(): void {
        if (this.root) {
            this.root.unmount();
        }
        this.root = createRoot(this.contentEl);
        this.root.render(
            <React.StrictMode>
                <WorkflowEditor store={this.store} />
            </React.StrictMode>,
        );
    }

    /**
     * Subscribe to the Zustand store's `dirty` flag.  When it flips to `true`
     * we schedule a debounced save via `requestSave()` which asks Obsidian to
     * call `getViewData()` and write the file.
     */
    private subscribeToDirty(): void {
        this.unsubscribe = this.store.subscribe((state, prev) => {
            if (state.dirty && !prev.dirty) {
                this.scheduleSave();
            }
        });
    }

    private scheduleSave(): void {
        if (this.saveTimer !== undefined) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(() => {
            this.requestSave();
            this.store.getState().markClean();
        }, ZotFlowWorkflowView.SAVE_DEBOUNCE_MS);
    }
}
