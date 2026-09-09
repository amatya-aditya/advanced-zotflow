import type {
    ChildAPI,
    ParentAPI,
    CreateReaderOptions,
    ColorScheme,
    ChildEvents,
    AnnotationJSON,
    ReaderNavigation,
} from "types/zotero-reader";

import { EditorView } from "@codemirror/view";
import { Component, MarkdownRenderer, Platform } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { connect, WindowMessenger, type Connection } from "penpal";
import { getBlobUrls } from "bundle-assets/inline-assets";
import { services } from "services/services";
import { workerBridge } from "bridge";
import { requestReaderSDT } from "ui/reader/sdt";
import { EnhancementPackInstallModal } from "ui/modals/enhancement-pack-install";

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

/** The child realm, while the bootstrap is parked on it. */
type BridgeChildWindow = Window & {
    __OBSIDIAN_BRIDGE__?: DirectBridgeBootstrap;
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
    private childDestroyTimeoutMs = 3000;
    private readyPromiseResolver: (() => void) | null = null;
    private connection: Connection | null = null;
    private reconnectTimer: ReturnType<Window["setTimeout"]> | null = null;
    private disconnectPromise: Promise<void> | null = null;
    private permanentlyDisposed = false;
    private readerInitPending = false;

    private editorList: EmbeddableMarkdownEditor[] = [];
    private rendererList: Component[] = [];
    private _readerOpts: CreateReaderOptions | undefined;
    private packInstallModal?: EnhancementPackInstallModal;

    private token: string | null = null;

    /**
     * Bumped by every `connect()`. A connect whose generation is stale (because
     * `reconnect()` superseded it) unwinds at its next checkpoint instead of
     * driving a child that has already been thrown away.
     */
    private connectGeneration = 0;

    /**
     * `load` events seen on the CURRENT iframe element. Obsidian reparents the
     * DOM when a panel is split or popped out, which reloads the iframe while
     * the element itself survives — so anything past the first load means the
     * child realm was replaced under us. Each `connect()` builds a new element,
     * so this resets naturally and a reconnect's own first load never counts.
     */
    private iframeLoadCount = 0;

    /** De-dupes overlapping reconnects (split, then immediately drag out). */
    private reconnectPromise: Promise<void> | null = null;

    constructor(
        private container: HTMLElement,
        private isLocal: boolean,
        private attachmentItem?: IDBZoteroItem<AttachmentData>,
        private localAttachment?: TFile,
        private localDataManager?: LocalDataManager,
    ) {}

    private async waitWithTimeout<T>(
        promise: Promise<T>,
        timeoutMs: number,
        message: string,
    ): Promise<T> {
        let timeout: ReturnType<Window["setTimeout"]> | null = null;
        try {
            return await Promise.race([
                promise,
                new Promise<never>((_, reject) => {
                    timeout = window.setTimeout(
                        () => reject(new Error(message)),
                        timeoutMs,
                    );
                }),
            ]);
        } finally {
            if (timeout !== null) window.clearTimeout(timeout);
        }
    }

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
        const generation = this.connectGeneration;
        return {
            getSDTPack: (options) => {
                const document = this._readerOpts;
                if (!document)
                    return Promise.resolve({
                        ok: false,
                        reason: "unavailable",
                    });
                return requestReaderSDT(
                    document,
                    options,
                    () =>
                        !this.permanentlyDisposed &&
                        generation === this.connectGeneration &&
                        this._readerOpts?.data === document.data,
                    () => {
                        this.packInstallModal =
                            EnhancementPackInstallModal.show(services.app);
                    },
                );
            },
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

            getMathJaxConfig: () => {
                // Obsidian loads MathJax onto the window; it is absent until the
                // first formula renders.
                const mathJax = (
                    window as {
                        MathJax?: { config?: Record<string, unknown> };
                    }
                ).MathJax;
                return mathJax?.config ?? {};
            },

            getColorScheme: () => {
                const scheme = services.settings.readerColorScheme;
                if (scheme === "light") return "light";
                if (scheme === "dark") return "dark";
                return (document.body.classList.contains("theme-dark")
                    ? "dark"
                    : "light");
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

            getLinkToSelection: (
                text: string,
                navigationInfo: ReaderNavigation,
            ) => {
                if (this.isLocal && this.localAttachment) {

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
                        const pageLabel = navigationInfo.pageLabel;

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

                // Annotation drag: set citation MIME for Zotero items
                if (
                    !this.isLocal &&
                    this.attachmentItem &&
                    annotations.length
                ) {
                    const parentKey = this.getParentItemKey()!;
                    const libraryID = this.attachmentItem.libraryID;
                    const payload: ZotFlowCitationPayload = {
                        type: "zotflow-citation",
                        libraryID,
                        key: parentKey,
                        // The reader strips `libraryID`/`parentItem` from
                        // annotations during drag, so restore them from the
                        // attachment for annotation-link generation and the
                        // CSL citation filter (page locator resolution).
                        annotations: annotations.map((a) => ({
                            ...stripAnnotationForPayload(a),
                            libraryID,
                            parentItem: this.attachmentItem!.key,
                        })),
                    };
                    dataTransfer.setData(
                        ZOTFLOW_CITATION_MIME,
                        JSON.stringify(payload),
                    );
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
                                annotations: annotations.map((a) => ({
                                    ...stripAnnotationForPayload(a),
                                    libraryID: this.attachmentItem!.libraryID,
                                    parentItem: this.attachmentItem!.key,
                                })),
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
                        showLineNumbers: false,
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
        if (this.permanentlyDisposed) return;
        if (this._state !== "idle" && this._state !== "disposed") return;
        this._state = "connecting";

        const generation = ++this.connectGeneration;
        /** True once `reconnect()` has started a newer attempt. */
        const superseded = () => generation !== this.connectGeneration;

        let resolveReady: () => void = () => {};
        const readyPromise = new Promise<void>((resolve) => {
            resolveReady = resolve;
            this.readyPromiseResolver = resolveReady;
        });

        // Create iframe. A fresh element per connect, so `iframeLoadCount`
        // counts loads of THIS element only.
        this.iframeLoadCount = 0;
        const doc = this.container.ownerDocument; // Get the document of the container
        // The container's owner document is already popout-safe, and the
        // iframe must remain detached until it is fully configured below.
        this.iframe = doc.createElement("iframe");
        this.iframe.id = "zotero-reader-iframe";
        this.iframe.setCssStyles({
            width: "100%",
            height: "100%",
            border: "none",
        });
        const src = getBlobUrls()["reader.html"]!;

        if (Platform.isAndroidApp) {
            // `src` is a `blob:` URL built by the asset inliner, not a network
            // address. `requestUrl` only speaks http(s) and cannot read one —
            // see the `no-restricted-globals` carve-out in eslint.config.mts.
            const srcdoc = await doc.win.fetch(src).then((res) => res.text());
            this.iframe.srcdoc = srcdoc;
        } else {
            this.iframe.src = src;
        }

        // Sandbox as before (same-origin required for direct access)
        this.iframe.sandbox.add("allow-scripts");
        this.iframe.sandbox.add("allow-same-origin");
        this.iframe.sandbox.add("allow-forms");

        this.iframe.onload = () => {
            this.iframeLoadCount++;

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
                    isDark = getComputedStyle(
                        this.iframe!.contentWindow!.parent.document.body,
                    ).colorScheme === "dark";
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

            // A second load on the same element means Obsidian reparented the
            // panel (split / pop-out) and the browser replaced the child realm.
            // The old `child` reference and, crucially, penpal's WindowMessenger
            // are both bound to a Window that no longer exists — penpal drops
            // any message whose source is not the exact `remoteWindow` it was
            // constructed with, so the connection cannot be re-pointed. Tearing
            // down and rebuilding is the only recovery.
            //
            // Counting loads rather than inspecting `_state`/`_readerOpts` makes
            // this independent of whether the child's handshake happened to beat
            // the `load` event, and it recovers reloads that land before the
            // first `initReader` too.
            if (this.iframeLoadCount > 1 && !superseded()) {
                services.logService.warn(
                    "Iframe reloaded unexpectedly, triggering reconnection",
                    "IframeReaderBridge",
                );
                // Deferred so the reconnect never runs inside the load handler.
                if (this.reconnectTimer !== null) return;
                this.reconnectTimer = window.setTimeout(() => {
                    this.reconnectTimer = null;
                    if (superseded() || this.permanentlyDisposed) return;
                    void this.reconnect().catch((e: unknown) => {
                        services.logService.error(
                            "Reconnection after iframe reload failed",
                            "IframeReaderBridge",
                            e,
                        );
                    });
                }, 0);
            }
        };

        // Install on the frame element before navigation. Unlike contentWindow,
        // the element survives creation of the child realm, and is available
        // synchronously through window.frameElement without an opener lookup.
        const iframe = this.iframe;
        let token = this.makeToken();
        this.token = token;
        const bootstrap: DirectBridgeBootstrap = () => ({
            token,
            parent: this.buildParentAPI(),
            register: async (childAPI, suppliedToken) => {
                if (superseded() || this.iframe !== iframe || suppliedToken !== this.token) {
                    throw new Error("Bridge token mismatch or expired connection");
                }
                this.child = childAPI;
                this._state = "bridge-ready";
                const tasks = this.afterBridgeReadyQueue.splice(0);
                for (const task of tasks) await task();
                this.readyPromiseResolver?.();
                return { ok: true };
            },
        });
        Object.defineProperty(iframe, "__OBSIDIAN_BRIDGE__", {
            value: bootstrap,
            configurable: true,
        });
        this.container.replaceChildren(iframe);

        // Compatibility with reader bundles using the earlier Penpal handshake.
        const messenger = new WindowMessenger({
            remoteWindow: iframe.contentWindow!,
            allowedOrigins: ["*"],
        });
        const conn = connect({
            messenger,
            methods: {
                shakehand: async () => {
                    if (superseded() || this.iframe !== iframe) return;
                    token = this.makeToken();
                    this.token = token;
                    Object.defineProperty(iframe.contentWindow!, "__OBSIDIAN_BRIDGE__", {
                        value: bootstrap,
                        configurable: true,
                    });
                },
            },
        });
        this.connection = conn;

        try {
            // Wait for the child to set up its penpal connection.
            await this.waitWithTimeout(
                Promise.race([conn.promise, readyPromise]),
                this.connectTimeoutMs,
                "Child connect timeout",
            );
            if (superseded()) return;

            // Then wait until the direct child API has registered.
            await this.waitWithTimeout(
                readyPromise,
                this.connectTimeoutMs,
                "Child connect timeout",
            );
        } catch (e) {
            if (superseded()) return;
            await this.disconnect();
            throw e;
        } finally {
            if (this.readyPromiseResolver === resolveReady) {
                this.readyPromiseResolver = null;
            }
        }
        // `dispose()` resolves the ready promise so a superseded connect unwinds
        // here immediately, instead of hanging until its timeout rejects.
        if (superseded()) return;

        // Replay the document into the fresh iframe. Only reachable on a
        // reconnect: on a first connect `_readerOpts` is still unset, because
        // both views await `connect()` before calling `initReader`.
        //
        // The `reader-ready` check covers the other order — if a caller does
        // call `initReader` while we are still connecting, the bridge-ready
        // queue has already served it by now, and replaying would load the
        // document a second time.
        //
        // Read through the getter: control-flow analysis still has `_state`
        // narrowed to the `"connecting"` assigned at the top of this method,
        // because the mutation happens inside the `register` callback.
        if (
            this._readerOpts &&
            this.state !== "reader-ready" &&
            !this.readerInitPending
        ) {
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
            if (superseded()) return;

            // `_readerOpts` carries the view state as of the last
            // `updateReaderOpts()` — the owning view refreshes it on every
            // `viewStateChanged`, so the reader comes back where the user left
            // it rather than where the file was first opened.
            const newReaderOpts: CreateReaderOptions = {
                ...this._readerOpts,
                annotations: newAnnotationJson,
            };

            await this.initReader(newReaderOpts);
        }
    }

    /**
     * Merge a patch into the cached reader options used to replay the document
     * after an unexpected iframe reload.
     *
     * The views call this from their `viewStateChanged` handler. Without it the
     * cache keeps the snapshot taken when the file was opened, and a panel split
     * or pop-out would scroll the reader back to that position.
     *
     * A no-op before the first `initReader` — there is nothing to replay yet,
     * and the view reads the live state from `ViewStateService` in that window
     * anyway.
     */
    updateReaderOpts(patch: Partial<CreateReaderOptions>) {
        if (!this._readerOpts) return;
        this._readerOpts = { ...this._readerOpts, ...patch };
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
        this.readerInitPending = true;
        return this.runAfterBridgeReady(async () => {
            try {
                await this.child!.initReader(opts);
                this._state = "reader-ready";

                // Drain after reader ready queued calls
                const tasks = [...this.afterReaderReadyQueue];
                this.afterReaderReadyQueue.length = 0;
                for (const t of tasks) await t();
            } finally {
                this.readerInitPending = false;
            }
        });
    }

    setColorScheme(colorScheme: ColorScheme, obsidianThemeMode?: boolean) {
        return this.runAfterBridgeReady(async () => {
            if (obsidianThemeMode === undefined) {
                await this.child!.setColorScheme(colorScheme);
            } else {
                await this.child!.setColorScheme(colorScheme, obsidianThemeMode);
            }
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

    navigate(navigationInfo: ReaderNavigation) {
        return this.runAfterReaderReady(async () => {
            await this.child!.navigate(navigationInfo);
        });
    }

    private disconnect(): Promise<void> {
        if (this.disconnectPromise) return this.disconnectPromise;

        this.disconnectPromise = (async () => {
            if (
                this._state === "disposed" &&
                !this.iframe &&
                !this.connection &&
                !this.child
            ) {
                return;
            }

            this._state = "disposing";
            ++this.connectGeneration;
            this.packInstallModal?.close();
            this.packInstallModal = undefined;

            this.editorList.forEach((editor) => editor.onunload());
            this.editorList.length = 0;
            this.rendererList.forEach((comp) => comp.unload());
            this.rendererList.length = 0;

            if (this.reconnectTimer !== null) {
                window.clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            const releasePendingConnect = this.readyPromiseResolver;
            this.readyPromiseResolver = null;
            releasePendingConnect?.();

            const child = this.child;
            const connection = this.connection;
            const iframe = this.iframe;
            if (iframe) iframe.onload = null;

            try {
                if (child) {
                    await this.waitWithTimeout(
                        child.destroy(),
                        this.childDestroyTimeoutMs,
                        "Reader child destroy timeout",
                    );
                }
            } catch (e) {
                services.logService.warn(
                    "Reader child cleanup did not complete cleanly",
                    "IframeReaderBridge",
                    e,
                );
            } finally {
                connection?.destroy();
                if (this.connection === connection) this.connection = null;

                try {
                    if (iframe?.contentWindow) {
                        delete (iframe.contentWindow as BridgeChildWindow)
                            .__OBSIDIAN_BRIDGE__;
                    }
                } catch {
                    // The browsing context may already have been replaced by
                    // Obsidian reparenting. All local references are still
                    // dropped below.
                }

                if (this.child === child) this.child = undefined;
                if (iframe) {
                    delete (iframe as HTMLIFrameElement & { __OBSIDIAN_BRIDGE__?: DirectBridgeBootstrap }).__OBSIDIAN_BRIDGE__;
                }
                iframe?.remove();
                if (this.iframe === iframe) this.iframe = null;
                this.token = null;
                this.afterBridgeReadyQueue.length = 0;
                this.afterReaderReadyQueue.length = 0;
                this.readerInitPending = false;
                this._state = "disposed";
            }
        })().finally(() => {
            this.disconnectPromise = null;
        });

        return this.disconnectPromise;
    }

    async dispose() {
        this.permanentlyDisposed = true;
        await this.disconnect();

        // Final close only. A reconnect deliberately keeps these so the new
        // iframe can replay the document and retain the view's subscriptions.
        this._readerOpts = undefined;
        this.typedListeners.clear();
        this.attachmentItem = undefined;
        this.localAttachment = undefined;
        this.localDataManager = undefined;
    }

    /**
     * Rebuild the iframe and the penpal connection from scratch, keeping the
     * cached reader options so the document is replayed.
     *
     * Concurrent callers share one attempt: a split immediately followed by a
     * drag-out fires two `load` events, and starting two `connect()`s would
     * leave the first orphaned on a detached iframe.
     */
    reconnect(): Promise<void> {
        if (this.permanentlyDisposed) return Promise.resolve();
        if (this.reconnectPromise) return this.reconnectPromise;
        this.reconnectPromise = (async () => {
            try {
                await this.disconnect();
                if (!this.permanentlyDisposed) await this.connect();
            } finally {
                this.reconnectPromise = null;
            }
        })();
        return this.reconnectPromise;
    }

    public get state(): BridgeState {
        return this._state;
    }
}
