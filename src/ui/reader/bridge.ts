import type {
    ChildAPI,
    ParentAPI,
    CreateReaderOptions,
    ColorScheme,
    ChildEvents,
    AnnotationJSON,
} from "types/zotero-reader";

import { EditorView } from "@codemirror/view"; // eslint-disable-line import/no-extraneous-dependencies
import { Component, MarkdownRenderer, Platform, requestUrl } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { connect, WindowMessenger } from "penpal";
import { getBlobUrls } from "bundle-assets/inline-assets";
import { services } from "services/services";
import { workerBridge } from "bridge";

import type { IDBZoteroItem } from "types/db-schema";
import type { AttachmentData } from "types/zotero-item";
import type { LocalDataManager } from "./local-data-manager";
import type { TFileWithoutParentAndVault } from "types/zotflow";
import { getLinkedLocalSourceNote } from "utils/file";
import type { TFile } from "obsidian";
import type { CitationFormat } from "settings/types";
import {
    ZOTFLOW_CITATION_MIME,
    stripAnnotationForPayload,
    type ZotFlowCitationPayload,
} from "ui/editor/citation-helper";
import {
    createEmbeddableMarkdownEditor,
    EmbeddableMarkdownEditor,
    type MarkdownEditorProps,
} from "ui/editor/markdown-editor";

/** Encode an annotation key as a URL-encoded navigation JSON parameter. */
function encodeNavInfo(annotationID: string): string {
    return encodeURIComponent(JSON.stringify({ annotationID }));
}

/** Build the callout title link for a Zotero library annotation. */
function buildLibraryLink(
    fileName: string,
    libraryID: number,
    attachmentKey: string,
    anno: AnnotationJSON,
): string {
    const nav = encodeNavInfo(anno.id);
    return `[${fileName}, p.${anno.pageLabel || "?"}](obsidian://zotflow?type=open-attachment&libraryID=${libraryID}&key=${attachmentKey}&navigation=${nav})`;
}

/** Build the callout title link for a local vault PDF annotation. */
function buildLocalLink(
    filePath: string,
    fileName: string,
    anno: AnnotationJSON,
): string {
    const nav = encodeNavInfo(anno.id);
    return `[[${filePath}${anno.pageLabel ? `#page=${anno.pageLabel}` : ""}#annotation=${nav}|${fileName}, p.${anno.pageLabel || "?"}]]`;
}

/**
 * Format an annotation as a rich callout block matching the source note template format.
 * Produces markdown like:
 * ```
 * > [!zotflow-highlight-#ffd400] [file.pdf, p.34](obsidian://...)
 * > > The highlighted text
 * >
 * > User comment
 * ^ANNOTATIONKEY
 * ```
 */
function formatAnnotationCallout(
    anno: AnnotationJSON,
    fileName: string,
    imgFolder: string,
    titleLink: string,
): string {
    const type = anno.type || "highlight";
    const color = anno.color ? `#${anno.color.replace(/^#/, "")}` : "#ffd400";
    let block = `> [!zotflow-${type}-${color}] ${titleLink}\n`;

    if (type === "ink" || type === "image") {
        block += `> > ![[${imgFolder}/${anno.id}.png]]\n`;
    } else if (anno.text) {
        const quotedText = anno.text.replace(/\n/g, "\n> > ");
        block += `> > ${quotedText}\n`;
    }

    if (anno.comment) {
        block += `>\n`;
        const quotedComment = anno.comment.replace(/\n/g, "\n> ");
        block += `> ${quotedComment}\n`;
    }

    block += `^${anno.id}`;
    return block;
}

type BridgeState =
    | "idle"
    | "connecting"
    | "bridge-ready"
    | "reader-ready"
    | "disposing"
    | "disposed";

// The bootstrap signature we temporarily install on the CHILD window.
type DirectBridgeBootstrap = () => {
    token: string;
    parent: ParentAPI;
    register: (childAPI: ChildAPI, token: string) => Promise<{ ok: boolean }>;
};

/** Penpal-based state machine managing the reader iframe lifecycle and bidirectional RPC. */
export class IframeReaderBridge {
    private iframe: HTMLIFrameElement | null = null;
    private child?: ChildAPI; // Direct reference to Child API (replaces RemoteProxy<ChildAPI>)
    private _state: BridgeState = "idle";
    private afterBridgeReadyQueue: Array<() => Promise<void>> = [];
    private afterReaderReadyQueue: Array<() => Promise<void>> = [];
    private typedListeners = new Map<
        ChildEvents["type"],
        Set<(e: ChildEvents) => void>
    >();
    private connectTimeoutMs = 8000;
    private readyPromiseResolver: (() => void) | null = null;
    private readyPromiseRejecter: ((err: Error) => void) | null = null;

    private editorList: EmbeddableMarkdownEditor[] = [];
    private rendererList: Component[] = [];
    private _readerOpts: CreateReaderOptions | undefined;

    private token: string | null = null;

    constructor(
        private container: HTMLElement,
        private isLocal: boolean,
        private attachmentItem?: IDBZoteroItem<AttachmentData>,
        private localAttachment?: TFile,
        private localDataManager?: LocalDataManager,
    ) {}

    /**
     * Listen to specific event types from the child iframe with type safety
     */
    onEventType<T extends ChildEvents["type"]>(
        eventType: T,
        cb: (e: Extract<ChildEvents, { type: T }>) => void,
    ) {
        if (!this.typedListeners.has(eventType)) {
            this.typedListeners.set(eventType, new Set());
        }
        const typedCb = cb as (e: ChildEvents) => void;
        this.typedListeners.get(eventType)!.add(typedCb);
        return () => {
            const listeners = this.typedListeners.get(eventType);
            if (listeners) {
                listeners.delete(typedCb);
                if (listeners.size === 0) {
                    this.typedListeners.delete(eventType);
                }
            }
        };
    }

    private makeToken() {
        try {
            return uuidv4();
        } catch {
            return `${Math.random()}-${Date.now()}`;
        }
    }

    private getParentItemKey(): string | undefined {
        if (!this.attachmentItem) return undefined;
        return this.attachmentItem.parentItem === ""
            ? this.attachmentItem.key
            : this.attachmentItem.parentItem;
    }

    private getReaderSourceNotePath(): string | undefined {
        if (this.isLocal && this.localAttachment) {
            return getLinkedLocalSourceNote(services.app, this.localAttachment)
                ?.path;
        }
        const parentKey = this.getParentItemKey();
        return parentKey
            ? services.indexService.getFileByKey(parentKey)?.path
            : undefined;
    }

    private buildParentAPI(): ParentAPI {
        return {
            getBlobUrlMap: () => getBlobUrls(),

            isAndroidApp: () => Platform.isAndroidApp,

            isLocalReader: () => this.isLocal,

            handleEvent: (evt) => {
                // Forward hotkeys to Obsidian's document so its Keymap
                // picks them up (e.g. Ctrl+P → command palette)
                if (evt.type === "forwardHotkey") {
                    document.dispatchEvent(
                        new KeyboardEvent("keydown", {
                            key: evt.key,
                            code: evt.code,
                            ctrlKey: evt.ctrlKey,
                            metaKey: evt.metaKey,
                            shiftKey: evt.shiftKey,
                            altKey: evt.altKey,
                            bubbles: true,
                            cancelable: true,
                        }),
                    );
                    return;
                }
                const ls = this.typedListeners.get(evt.type);
                if (ls) ls.forEach((l) => l(evt));
            },

            getOrigin: () => {
                return window.location.origin;
            },

            getMathJaxConfig: (): Record<string, unknown> => {
                const win = window as unknown as { MathJax?: { config?: Record<string, unknown> } };
                return win.MathJax?.config ?? {};
            },

            getColorScheme: () => {
                const scheme = services.settings.readerColorScheme;
                if (scheme === "light") return "light" as ColorScheme;
                if (scheme === "dark") return "dark" as ColorScheme;
                return (document.body.classList.contains("theme-dark")
                    ? "dark"
                    : "light") as ColorScheme;
            },

            getStyleSheets: () => {
                return document.styleSheets;
            },

            getObsidianThemeVariables: () => {
                const computed = getComputedStyle(document.body);
                const vars: Record<string, string> = {};
                const cssVarNames = [
                    "--background-primary",
                    "--background-primary-alt",
                    "--background-secondary",
                    "--background-secondary-alt",
                    "--background-modifier-border",
                    "--background-modifier-form-field",
                    "--background-modifier-hover",
                    "--background-modifier-active-hover",
                    "--text-normal",
                    "--text-muted",
                    "--text-faint",
                    "--text-on-accent",
                    "--text-accent",
                    "--text-accent-hover",
                    "--interactive-normal",
                    "--interactive-hover",
                    "--interactive-accent",
                    "--interactive-accent-hover",
                    "--scrollbar-bg",
                    "--scrollbar-thumb-bg",
                    "--scrollbar-active-thumb-bg",
                    "--scrollbar-width",
                    "--scrollbar-height",
                    "--scrollbar-radius",
                    "--scrollbar-border-width",
                ];
                for (const name of cssVarNames) {
                    const val = computed.getPropertyValue(name).trim();
                    if (val) vars[name] = val;
                }
                return { ":root": vars };
            },

            getPluginSettings: () => {
                return services.settings;
            },

            getLinkToSelection: (text: string, navigationInfo: Record<string, unknown>) => {
                if (this.isLocal && this.localAttachment) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    const note: TFileWithoutParentAndVault | null =
                        getLinkedLocalSourceNote(
                            services.app,
                            this.localAttachment,
                        );

                    if (note) {
                        const filePath = this.localAttachment.path;
                        const encodedNavigationInfo = encodeURIComponent(
                            JSON.stringify(navigationInfo),
                        );
                        const pageLabel = navigationInfo.pageLabel as string | undefined;

                        return `[[${filePath}${pageLabel ? `#page=${pageLabel}` : ""}#annotation=${encodedNavigationInfo})|${text}]]`;
                    }

                    return "";
                } else if (!this.isLocal && this.attachmentItem) {
                    const note = services.indexService.getFileByKey(
                        this.attachmentItem.parentItem === ""
                            ? this.attachmentItem.key
                            : this.attachmentItem.parentItem,
                    );
                    if (note) {
                        const libraryID = this.attachmentItem.libraryID;
                        const itemKey = this.attachmentItem.key;
                        const encodedNavigationInfo = encodeURIComponent(
                            JSON.stringify(navigationInfo),
                        );

                        return `[${text}](obsidian://zotflow?type=open-attachment&libraryID=${libraryID}&key=${itemKey}&navigation=${encodedNavigationInfo})`;
                    }
                    return "";
                }
                return "";
            },

            handleSetDataTransferAnnotations: (
                dataTransfer: DataTransfer,
                annotations: AnnotationJSON[],
                fromText?: boolean,
            ) => {
                if (fromText) {
                    dataTransfer.setData(
                        "text/plain",
                        annotations
                            .map((a) => a.text || "")
                            .join("\n")
                            .trim(),
                    );
                    return;
                }

                if (!this.isLocal && this.attachmentItem && annotations.length) {
                    const parentKey = this.getParentItemKey();
                    if (parentKey) {
                        const payload: ZotFlowCitationPayload = {
                            type: "zotflow-citation",
                            libraryID: this.attachmentItem.libraryID,
                            key: parentKey,
                            annotations: annotations.map((annotation) =>
                                stripAnnotationForPayload(annotation),
                            ),
                        };
                        dataTransfer.setData(
                            ZOTFLOW_CITATION_MIME,
                            JSON.stringify(payload),
                        );
                    }
                }

                if (this.isLocal && this.localAttachment) {
                    const note: TFileWithoutParentAndVault | null =
                        getLinkedLocalSourceNote(
                            services.app,
                            this.localAttachment,
                        );

                    if (note) {
                        const filePath = this.localAttachment.path;
                        const fileName = this.localAttachment.name;
                        const imgFolder =
                            services.settings.annotationImageFolder.replace(
                                /\/$/,
                                "",
                            );
                        const content = annotations.reduce((acc, anno) => {
                            if (!anno.id) {
                                return acc + (anno.text || "") + "\n\n";
                            }
                            return (
                                acc +
                                formatAnnotationCallout(
                                    anno,
                                    fileName,
                                    imgFolder,
                                    buildLocalLink(filePath, fileName, anno),
                                ) +
                                "\n\n"
                            );
                        }, "");
                        dataTransfer.setData("text/plain", content.trim());
                        return;
                    }
                } else if (!this.isLocal && this.attachmentItem) {
                    const notePath = this.getReaderSourceNotePath();
                    if (notePath) {
                        const attachment = this.attachmentItem;
                        const fileName = attachment.title || attachment.key;
                        const imgFolder =
                            services.settings.annotationImageFolder.replace(
                                /\/$/,
                                "",
                            );
                        const content = annotations.reduce((acc, anno) => {
                            if (!anno.id) {
                                return acc + (anno.text || "") + "\n\n";
                            }
                            return (
                                acc +
                                formatAnnotationCallout(
                                    anno,
                                    fileName,
                                    imgFolder,
                                    buildLibraryLink(
                                        fileName,
                                        attachment.libraryID,
                                        attachment.key,
                                        anno,
                                    ),
                                ) +
                                "\n\n"
                            );
                        }, "");
                        dataTransfer.setData("text/plain", content.trim());
                        return;
                    }
                }

                dataTransfer.setData("text/plain", " ");
            },

            copyAnnotationCitation: (
                annotations: AnnotationJSON[],
                format: string,
            ) => {
                void (async () => {
                    try {
                        if (format === "text") {
                            const text = annotations
                                .map((annotation) => annotation.text)
                                .filter(Boolean)
                                .join("\n");
                            await navigator.clipboard.writeText(text.trim());
                            return;
                        }

                        if (format === "embed") {
                            const notePath = this.getReaderSourceNotePath();
                            if (notePath) {
                                const text = annotations
                                    .map(
                                        (annotation) =>
                                            `![[${notePath}#^${annotation.id}]]`,
                                    )
                                    .join("\n");
                                await navigator.clipboard.writeText(text);
                            }
                            return;
                        }

                        const parentKey = this.getParentItemKey();
                        if (!this.attachmentItem || !parentKey) return;

                        const citationFormat =
                            format === "default"
                                ? services.settings.defaultCitationFormat
                                : (format as CitationFormat);
                        const result = await services.citationService.resolve(
                            {
                                libraryID: this.attachmentItem.libraryID,
                                key: parentKey,
                                annotations: annotations.map((annotation) =>
                                    stripAnnotationForPayload(annotation),
                                ),
                            },
                            citationFormat,
                        );
                        if (!result) return;

                        let text = result.citation;
                        if (result.footnoteDef) {
                            text += `\n${result.footnoteDef}`;
                        }
                        await navigator.clipboard.writeText(text);
                    } catch (error) {
                        services.logService.error(
                            "Failed to copy annotation citation",
                            "IframeReaderBridge",
                            error,
                        );
                    }
                })();
            },

            createAnnotationEditor: (
                container: HTMLElement,
                options: Partial<MarkdownEditorProps>,
            ) => {
                const editor = createEmbeddableMarkdownEditor(
                    services.app,
                    container,
                    {
                        ...options,
                        onBlur: (blurEditor) => {
                            blurEditor.activeCM.dispatch({
                                effects: EditorView.scrollIntoView(0, {
                                    y: "start",
                                }),
                            });
                        },
                    },
                );
                this.editorList.push(editor);
                const originalOnunload = editor.onunload.bind(editor);
                editor.onunload = () => {
                    originalOnunload();
                    const idx = this.editorList.indexOf(editor);
                    if (idx !== -1) this.editorList.splice(idx, 1);
                };
                return editor;
            },

            renderMarkdownToContainer: (
                container: HTMLElement,
                text: string,
            ) => {
                const comp = new Component();
                comp.load();
                container.empty();
                container.addClass("content");
                void MarkdownRenderer.render(
                    services.app,
                    text,
                    container,
                    "",
                    comp,
                );
                this.rendererList.push(comp);
                return {
                    unload: () => {
                        comp.unload();
                        const idx = this.rendererList.indexOf(comp);
                        if (idx !== -1) this.rendererList.splice(idx, 1);
                    },
                };
            },
        };
    }

    async connect() {
        if (this._state !== "idle" && this._state !== "disposed") return;
        this._state = "connecting";

        const readyPromise = new Promise<void>((resolve, reject) => {
            this.readyPromiseResolver = resolve;
            this.readyPromiseRejecter = reject;
        });

        // Create iframe
        const doc = this.container.ownerDocument; // Get the document of the container
        this.iframe = doc.createElement("iframe");
        this.iframe.id = "zotero-reader-iframe";
        this.iframe.setCssStyles({
            width: "100%",
            height: "100%",
            border: "none",
        });
        const src = getBlobUrls()["reader.html"]!;

        if (Platform.isAndroidApp) {
            const response = await requestUrl({ url: src });
            this.iframe.srcdoc = response.text;
        } else {
            this.iframe.src = src;
        }

        // Sandbox as before (same-origin required for direct access)
        this.iframe.sandbox.add("allow-scripts");
        this.iframe.sandbox.add("allow-same-origin");
        this.iframe.sandbox.add("allow-forms");

        this.iframe.onload = () => {
            // Apply Obsidian color-scheme classes based on setting
            const scheme = services.settings.readerColorScheme;
            const iframeDoc = this.iframe?.contentDocument;
            if (iframeDoc) {
                let isDark = false;
                if (scheme === "light") {
                    isDark = false;
                } else if (scheme === "dark") {
                    isDark = true;
                } else {
                    // "obsidian" or "obsidian-theme", detect from parent
                    isDark =
                        document.body.classList.contains("theme-dark");
                }
                iframeDoc.documentElement.classList.toggle(
                    "obsidian-theme-dark",
                    isDark,
                );
                iframeDoc.documentElement.classList.toggle(
                    "obsidian-theme-light",
                    !isDark,
                );
                if (scheme === "obsidian-theme") {
                    iframeDoc.documentElement.setAttribute(
                        "data-obsidian-theme",
                        "",
                    );
                }
            }

            // Only handle unexpected reloads when we're in a stable state
            if (
                (this._state === "reader-ready" ||
                    this._state === "bridge-ready") &&
                this._readerOpts
            ) {
                // It was loaded before, but it was loaded again somehow
                // We need to reconnect but avoid infinite loop
                services.logService.warn(
                    "Iframe reloaded unexpectedly, triggering reconnection",
                    "IframeReaderBridge",
                );
                // Use setTimeout to avoid potential stack overflow
                setTimeout(() => { void this.reconnect(); }, 0);
            }
        };

        // Attach first to get a contentWindow
        this.container.replaceChildren(this.iframe);

        const messenger = new WindowMessenger({
            remoteWindow: this.iframe.contentWindow!,
            allowedOrigins: ["*"],
        });

        const conn = connect({
            messenger,
            methods: {
                shakehand: async () => {
                    if (this.iframe?.contentWindow) {
                        this.token = this.makeToken();
                        const parentAPI = this.buildParentAPI();

                        const register = async (
                            childAPI: ChildAPI,
                            t: string,
                        ) => {
                            if (t !== this.token)
                                throw new Error("Bridge token mismatch");
                            this.child = childAPI;
                            this._state = "bridge-ready";

                            // Drain after bridge ready queued calls
                            const tasks = [...this.afterBridgeReadyQueue];
                            this.afterBridgeReadyQueue.length = 0;
                            for (const t of tasks) await t();
                            if (this.readyPromiseResolver)
                                this.readyPromiseResolver();
                            return { ok: true };
                        };

                        const _bridge: DirectBridgeBootstrap = () => ({
                            token: this.token!,
                            parent: parentAPI,
                            register,
                        });
                        // Make it non-enumerable & configurable (child can delete after use)
                        Object.defineProperty(
                            this.iframe.contentWindow,
                            "__OBSIDIAN_BRIDGE__",
                            {
                                value: _bridge,
                                enumerable: false,
                                writable: false,
                                configurable: true,
                            },
                        );
                    }
                },
            },
        });

        // Wait for child to setup penpal connection
        const remotePromise = conn.promise;
        await Promise.race([
            remotePromise,
            new Promise<never>((_, rej) =>
                setTimeout(
                    () => rej(new Error("Child connect timeout")),
                    this.connectTimeoutMs,
                ),
            ),
        ]);

        // Wait until the child calls register() (state becomes "ready") or timeout
        await Promise.race([
            readyPromise,
            new Promise<never>((_, rej) =>
                setTimeout(
                    () => rej(new Error("Child connect timeout")),
                    this.connectTimeoutMs,
                ),
            ),
        ]);

        if (this._readerOpts) {
            // Update annotation json
            let newAnnotationJson: AnnotationJSON[] = [];

            if (!this.isLocal && this.attachmentItem) {
                newAnnotationJson =
                    await workerBridge.annotation.getAnnotations(
                        this.attachmentItem,
                        services.settings.zoteroapikey,
                    );
            } else if (this.isLocal && this.localDataManager) {
                newAnnotationJson = this.localDataManager.getAllAnnotations();
            }

            const newReaderOpts: CreateReaderOptions = {
                ...this._readerOpts,
                annotations: newAnnotationJson,
            };

            await this.initReader(newReaderOpts);
        }
    }

    private runAfterBridgeReady(fn: () => Promise<void>) {
        if (this._state === "bridge-ready" || this._state === "reader-ready")
            return fn();
        if (this._state === "connecting") {
            this.afterBridgeReadyQueue.push(fn);
            return Promise.resolve();
        }
        return Promise.reject(
            new Error(`Bridge not ready (state=${this._state})`),
        );
    }

    private runAfterReaderReady(fn: () => Promise<void>) {
        if (this._state === "reader-ready") return fn();
        if (this._state === "connecting" || this._state === "bridge-ready") {
            this.afterReaderReadyQueue.push(fn);
            return Promise.resolve();
        }
        return Promise.reject(
            new Error(`Bridge not ready (state=${this._state})`),
        );
    }

    initReader(opts: CreateReaderOptions) {
        this._readerOpts = opts;
        return this.runAfterBridgeReady(async () => {
            await this.child!.initReader(opts);
            this._state = "reader-ready";

            // Drain after reader ready queued calls
            const tasks = [...this.afterReaderReadyQueue];
            this.afterReaderReadyQueue.length = 0;
            for (const t of tasks) await t();
        });
    }

    setColorScheme(colorScheme: ColorScheme, obsidianThemeMode?: boolean) {
        return this.runAfterBridgeReady(async () => {
            await this.child!.setColorScheme(colorScheme, obsidianThemeMode);
        });
    }

    addAnnotation(annotation: AnnotationJSON) {
        return this.runAfterReaderReady(async () => {
            await this.child!.addAnnotation(annotation);
        });
    }

    refreshAnnotations(annotations: AnnotationJSON[]) {
        return this.runAfterReaderReady(async () => {
            await this.child!.refreshAnnotations(annotations);
        });
    }

    navigate(navigationInfo: Record<string, unknown>) {
        return this.runAfterReaderReady(async () => {
            await this.child!.navigate(navigationInfo);
        });
    }

    async dispose(clearListeners = true) {
        if (this._state === "disposed") return;
        this.editorList.forEach((editor) => editor.onunload());
        this.editorList.length = 0;
        this.rendererList.forEach((comp) => comp.unload());
        this.rendererList.length = 0;
        this._state = "disposing";
        try {
            if (this.iframe?.contentWindow) {
                const win = this.iframe.contentWindow as Window & { __ZREADER_BRIDGE__?: unknown };
                delete win.__ZREADER_BRIDGE__;
            }
        } catch { /* iframe may be cross-origin after navigation */ }
        this.child = undefined;
        this.iframe?.remove();
        this.iframe = null;
        if (clearListeners) this.typedListeners.clear();
        this._state = "disposed";
    }

    async reconnect() {
        await this.dispose(false);
        return this.connect();
    }

    public get state(): BridgeState {
        return this._state;
    }
}
