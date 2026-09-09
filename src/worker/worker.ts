import * as Comlink from "comlink";
import { EnhancementResourceService } from "./services/enhancement-resources";
import { setProxiedFetch } from "./proxied-fetch";
import { ZoteroAPIService } from "./services/zotero";
import { SyncService } from "./services/sync";
import { AttachmentService } from "./services/attachment";
import { WebDavService } from "./services/webdav";
import { TreeViewService } from "./services/tree-view";
import { LibraryTemplateService } from "./services/library-template";
import { LibraryNoteService } from "./services/library-note";
import { DocumentWorkerService } from "./services/document-worker";
import { LocalNoteService } from "./services/local-note";
import { LocalTemplateService } from "./services/local-template";
import { ConflictService } from "./services/conflict";
import { AnnotationService } from "./services/annotation";
import { KeyService } from "./services/key";
import { LibraryService } from "./services/library";
import { DbHelperService } from "./services/db-helper";
import { SearchService } from "./services/search";
import { TagService } from "./services/tag";
import { NotePathService } from "./services/note-path";
import { ConvertService } from "./services/convert";
import { ItemNoteService } from "./services/item-note";
import { CslRenderWorkerService } from "./services/csl-render";
import { TaskManager } from "./tasks/manager";
import { ZotFlowError, ZotFlowErrorCode } from "utils/error";
import { db } from "db/db";

import type { ZotFlowSettings } from "settings/types";
import type { IParentProxy } from "bridge/types";
import type { UpdateOptions } from "./services/library-note";
import type { BatchNoteInput } from "./tasks/impl/batch-note-task";
import type {
    BatchExtractImagesInput,
    ItemIdentifier,
} from "./tasks/impl/batch-extract-images-task";
import type { IDBZoteroItem } from "types/db-schema";
import type { AttachmentData } from "types/zotero-item";
import type { AnnotationJSON } from "types/zotero-reader";
import type { DownloadedAttachment } from "types/tasks";
import type { DbHelperService as DbHelperServiceType } from "./services/db-helper";
import type { ItemTemplateContext } from "types/template-context";

/** Lightweight item metadata for Base view generation (no children/annotations). */
export interface BaseViewItemMetadata {
    key: string;
    libraryID: number;
    citationKey: string;
    itemType: string;
    title: string;
    creators: string[];
    date: string | null;
    dateAdded: string;
    dateModified: string;
    publicationTitle?: string;
    publisher?: string;
    place?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    series?: string;
    seriesNumber?: string;
    edition?: string;
    url?: string;
    DOI?: string;
    ISBN?: string;
    ISSN?: string;
    abstractNote?: string;
    tags: string[];
}
import type { TagService as TagServiceType } from "./services/tag";

/**
 * Worker API definition
 * This interface defines the methods exposed by the worker
 */
/**
 * A worker service handed across the Comlink boundary. The getters below
 * return `Comlink.proxy(...)`, so the value really is proxy-marked; declaring
 * that is what makes `Remote<WorkerAPI>` type these as proxies whose methods
 * return promises, rather than as values to be structured-cloned.
 */
type Exposed<T> = T & Comlink.ProxyMarked;

export interface WorkerAPI {
    init(
        settings: ZotFlowSettings,
        parentHost: IParentProxy,
        blobUrls: Record<string, string>,
    ): void;
    dispose(): void;
    zotero: Exposed<ZoteroAPIService>;
    sync: Exposed<SyncService>;
    attachment: Exposed<AttachmentService>;
    webdav: Exposed<WebDavService>;
    treeView: Exposed<TreeViewService>;
    libraryNote: Exposed<LibraryNoteService>;
    itemNote: Exposed<ItemNoteService>;
    localNote: Exposed<LocalNoteService>;
    conflict: Exposed<ConflictService>;
    annotation: Exposed<AnnotationService>;
    key: Exposed<KeyService>;
    library: Exposed<LibraryService>;
    dbHelper: Exposed<DbHelperServiceType>;
    tag: Exposed<TagServiceType>;
    documentWorker: Exposed<DocumentWorkerService>;
    enhancementResources: Exposed<EnhancementResourceService>;
    libraryTemplate: Exposed<LibraryTemplateService>;
    localTemplate: Exposed<LocalTemplateService>;
    notePath: Exposed<NotePathService>;
    cslRender: Exposed<CslRenderWorkerService>;
    tasks: Exposed<TaskManager>;
    updateSettings(settings: ZotFlowSettings): void;

    // Task factory methods
    createSyncTask(libraryId?: number): Promise<string>;
    createBatchNoteTask(
        input: BatchNoteInput,
        options: UpdateOptions,
        isUpdate: boolean,
    ): Promise<string>;
    createBatchExtractImagesTask(
        input: BatchExtractImagesInput,
    ): Promise<string>;
    createBackfillCslJsonTask(): Promise<string>;
    downloadAttachment(
        attachmentItem: IDBZoteroItem<AttachmentData>,
    ): Promise<DownloadedAttachment>;
    extractExternalAnnotations(
        items: ItemIdentifier[],
    ): Promise<AnnotationJSON[]>;
    cancelTask(taskId: string): void;

    // Workflow-specific methods
    getItemContext(
        libraryID: number,
        key: string,
    ): Promise<ItemTemplateContext & { libraryName: string }>;
    renderNoteFromContext(
        itemContext: ItemTemplateContext,
        templateContent: string | null,
        existingFrontmatter: Record<string, any>,
    ): Promise<string>;
    extractAnnotationImagesForItem(
        libraryID: number,
        key: string,
        force: boolean,
    ): Promise<void>;

    getCollectionItemsMetadata(
        libraryID: number,
        collectionKey: string | null,
    ): Promise<BaseViewItemMetadata[]>;
}

// Service instances (Lazy initialized)
let _zotero: ZoteroAPIService | undefined;
let _webdav: WebDavService | undefined;
let _attachment: AttachmentService | undefined;
let _sync: SyncService | undefined;
let _treeView: TreeViewService | undefined;
let _template: LibraryTemplateService | undefined;
let _libraryNote: LibraryNoteService | undefined;
let _itemNote: ItemNoteService | undefined;
let _localNote: LocalNoteService | undefined;
let _localTemplate: LocalTemplateService | undefined;
let _conflict: ConflictService | undefined;
let _annotation: AnnotationService | undefined;
let _key: KeyService | undefined;
let _library: LibraryService | undefined;
let _dbHelper: DbHelperService | undefined;
let _search: SearchService | undefined;
let _tag: TagService | undefined;
let _notePath: NotePathService | undefined;
let _convert: ConvertService | undefined;
let _documentWorker: DocumentWorkerService | undefined;
let _enhancementResources: EnhancementResourceService | undefined;
let _cslRender: CslRenderWorkerService | undefined;
let _taskManager: TaskManager | undefined;
let _currentSettings: ZotFlowSettings | undefined;

function assertInitialized() {
    if (
        !_zotero ||
        !_webdav ||
        !_attachment ||
        !_sync ||
        !_treeView ||
        !_template ||
        !_libraryNote ||
        !_itemNote ||
        !_documentWorker ||
        !_localNote ||
        !_localTemplate ||
        !_conflict ||
        !_annotation ||
        !_key ||
        !_library ||
        !_dbHelper ||
        !_search ||
        !_tag ||
        !_notePath ||
        !_convert ||
        !_cslRender ||
        !_taskManager ||
        !_currentSettings
    ) {
        throw new ZotFlowError(
            ZotFlowErrorCode.RESOURCE_MISSING,
            "Worker",
            "Worker not initialized",
        );
    }
}

const exposedApi: WorkerAPI = {
    init: (
        settings: ZotFlowSettings,
        parentHost: IParentProxy,
        blobUrls: Record<string, string>,
    ) => {
        const started = performance.now();
        const startedAt = new Date().toISOString();
        let stageStarted = started;
        const stageDurationMs: Record<string, number> = {};
        const finishStage = (stage: string) => {
            const finished = performance.now();
            stageDurationMs[stage] = Number(
                (finished - stageStarted).toFixed(2),
            );
            stageStarted = finished;
        };
        // Patch global fetch to proxy through Obsidian Main Thread
        // The worker global has no `originalFetch`; we are adding it so the
        // proxy can be unwound.
        const workerGlobal = self as unknown as {
            fetch: unknown;
            originalFetch?: unknown;
        };
        workerGlobal.originalFetch = workerGlobal.fetch;
        const proxiedFetchImpl = async (url: string, init?: RequestInit) => {
            try {
                const response = await parentHost.request({
                    url: url,
                    method: init?.method || "GET",
                    headers: init?.headers as Record<string, string>,
                    body: init?.body as string | ArrayBuffer,
                    throw: false, // We handle status codes in Services
                    contentType: "application/json",
                });

                // Handle empty response bodies
                if (
                    !response.arrayBuffer ||
                    response.arrayBuffer.byteLength === 0
                ) {
                    return new Response(null, {
                        status: response.status,
                        headers: new Headers(response.headers),
                    });
                }

                // Convert Obsidian Bridge response to standard Response object
                return new Response(response.arrayBuffer, {
                    status: response.status,
                    headers: new Headers(response.headers),
                });
            } catch (e) {
                throw new TypeError(
                    `Network Request Failed: ${(e as Error).message}`,
                );
            }
        };
        workerGlobal.fetch = proxiedFetchImpl;

        // Also expose via module import (see proxied-fetch.ts) so worker
        // code can use it without referencing lint-restricted globals.
        setProxiedFetch(proxiedFetchImpl);
        finishStage("Configure proxied fetch");

        try {
            _zotero = new ZoteroAPIService(settings.zoteroapikey);
            _library = new LibraryService(settings, parentHost);
            _search = new SearchService();
            _dbHelper = new DbHelperService(
                settings,
                parentHost,
                _library,
                _search,
            );
            _tag = new TagService(settings, parentHost);
            finishStage("Create API, library, search and database services");
            _webdav = new WebDavService(settings, parentHost);
            _attachment = new AttachmentService(
                _webdav,
                settings,
                _zotero,
                parentHost,
            );
            _sync = new SyncService(_zotero, settings, parentHost, _library);
            _treeView = new TreeViewService(
                settings,
                parentHost,
                _library,
                _search,
            );
            finishStage("Create attachment, sync and tree services");

            _enhancementResources = new EnhancementResourceService();
            _documentWorker = new DocumentWorkerService(
                settings,
                parentHost,
                blobUrls,
                _enhancementResources,
            );
            _notePath = new NotePathService(settings, _dbHelper);
            _convert = new ConvertService();
            finishStage("Create document and conversion services");

            _cslRender = new CslRenderWorkerService(settings);
            finishStage("Create CSL service");

            _template = new LibraryTemplateService(
                settings,
                parentHost,
                _dbHelper,
                _notePath,
                _convert,
                _cslRender,
                _zotero,
            );
            _libraryNote = new LibraryNoteService(
                settings,
                _template,
                parentHost,
                _attachment,
                _documentWorker,
                _notePath,
            );
            _itemNote = new ItemNoteService(
                settings,
                parentHost,
                _convert,
                _libraryNote,
            );

            _localTemplate = new LocalTemplateService(settings, parentHost);
            _localNote = new LocalNoteService(
                settings,
                parentHost,
                _localTemplate,
                _notePath,
            );
            finishStage("Create template and note services");

            _conflict = new ConflictService(parentHost);

            _annotation = new AnnotationService(
                _libraryNote,
                parentHost,
                _convert,
            );
            _key = new KeyService(_zotero, parentHost);

            _taskManager = new TaskManager(parentHost);

            _currentSettings = settings;
            finishStage("Create annotation, key and task services");

            // Initialize the nested Document Worker.
            _documentWorker._init();
            finishStage("Start nested Document Worker (synchronous setup)");
            // Measure inside this worker's clock and send one summary. The main
            // thread's init RPC duration also includes scheduling and messaging;
            // this summary excludes worker bundle evaluation before init arrives.
            parentHost.log(
                "debug",
                "Worker initialization breakdown",
                "WorkerBridge",
                {
                    startedAt,
                    finishedAt: new Date().toISOString(),
                    durationMs: Number(
                        (performance.now() - started).toFixed(2),
                    ),
                    stageDurationMs,
                },
            );

            parentHost.log("info", "Services initialized.", "Worker");
        } catch (e) {
            parentHost.log("error", "Initialization failed", "Worker", e);

            // This error will be caught by the Comlink promise on the main thread
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                `Worker Initialization Failed: ${(e as Error).message}`,
            );
        }
    },

    get zotero() {
        if (!_zotero)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_zotero);
    },

    get sync() {
        if (!_sync)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_sync);
    },

    get webdav() {
        if (!_webdav)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_webdav);
    },

    get attachment() {
        if (!_attachment)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_attachment);
    },

    get treeView() {
        if (!_treeView)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_treeView);
    },

    get libraryNote() {
        if (!_libraryNote)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_libraryNote);
    },

    get itemNote() {
        if (!_itemNote)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_itemNote);
    },

    get localNote() {
        if (!_localNote)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_localNote);
    },

    get conflict() {
        if (!_conflict)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_conflict);
    },

    get annotation() {
        if (!_annotation)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_annotation);
    },

    get key() {
        if (!_key)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_key);
    },

    get library() {
        if (!_library)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_library);
    },

    get dbHelper() {
        if (!_dbHelper)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_dbHelper);
    },

    get tag() {
        if (!_tag)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_tag);
    },

    get enhancementResources() {
        if (!_enhancementResources) throw new Error("Worker not initialized");
        return Comlink.proxy(_enhancementResources);
    },

    get documentWorker() {
        if (!_documentWorker)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_documentWorker);
    },

    get tasks() {
        if (!_taskManager)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_taskManager);
    },

    get libraryTemplate() {
        if (!_template)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_template);
    },

    get localTemplate() {
        if (!_localTemplate)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_localTemplate);
    },

    get notePath() {
        if (!_notePath)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_notePath);
    },

    get cslRender() {
        if (!_cslRender)
            throw new ZotFlowError(
                ZotFlowErrorCode.UNKNOWN,
                "Worker",
                "Worker not initialized",
            );
        return Comlink.proxy(_cslRender);
    },

    dispose: () => {
        _libraryNote?.dispose();
        _localNote?.dispose();
        _cslRender?.dispose();
        _documentWorker?.dispose();
        _enhancementResources?.dispose();
    },

    /* ================================================================ */
    /*  Task factory methods                                           */
    /* ================================================================ */

    createSyncTask: async (libraryId?: number) => {
        assertInitialized();
        return _taskManager!.createSyncTask(
            _sync!,
            libraryId,
            _libraryNote,
            _currentSettings,
        );
    },

    createBatchNoteTask: async (
        input: BatchNoteInput,
        options: UpdateOptions,
        isUpdate: boolean,
    ) => {
        assertInitialized();
        return _taskManager!.createBatchNoteTask(
            _libraryNote!,
            input,
            options,
            isUpdate,
        );
    },

    createBatchExtractImagesTask: async (input: BatchExtractImagesInput) => {
        assertInitialized();
        return _taskManager!.createBatchExtractImagesTask(
            _attachment!,
            _documentWorker!,
            _currentSettings!,
            input,
        );
    },

    createBackfillCslJsonTask: async () => {
        assertInitialized();
        return _taskManager!.createBackfillCslJsonTask(_zotero!);
    },

    downloadAttachment: async (
        attachmentItem: IDBZoteroItem<AttachmentData>,
    ) => {
        assertInitialized();
        return _taskManager!.createDownloadAttachmentTask(
            _attachment!,
            attachmentItem,
        );
    },

    extractExternalAnnotations: async (items: ItemIdentifier[]) => {
        assertInitialized();
        return _taskManager!.createBatchExtractExternalAnnotationsTask(
            _attachment!,
            _documentWorker!,
            _libraryNote!,
            { items },
        );
    },

    cancelTask: (taskId: string) => {
        assertInitialized();
        _taskManager!.cancelTask(taskId);
    },

    /* ================================================================ */
    /*  Workflow-specific methods                                       */
    /* ================================================================ */

    getItemContext: async (libraryID: number, key: string) => {
        assertInitialized();
        const item = await db.items.get([libraryID, key]);
        if (!item) {
            throw new ZotFlowError(
                ZotFlowErrorCode.RESOURCE_MISSING,
                "Worker",
                `Item not found: libraryID=${libraryID}, key=${key}`,
            );
        }
        const library = await db.libraries.get({ id: libraryID });
        const itemContext = await _template!.mapToItemContext(item);
        return { ...itemContext, libraryName: library?.name ?? "Unknown" };
    },

    renderNoteFromContext: async (
        itemContext: ItemTemplateContext,
        templateContent: string | null,
        existingFrontmatter: Record<string, any>,
    ) => {
        assertInitialized();
        return _template!.renderWithContext(
            itemContext,
            templateContent,
            existingFrontmatter,
        );
    },

    extractAnnotationImagesForItem: async (
        libraryID: number,
        key: string,
        force: boolean,
    ) => {
        assertInitialized();
        const item = await db.items.get([libraryID, key]);
        if (!item) {
            throw new ZotFlowError(
                ZotFlowErrorCode.RESOURCE_MISSING,
                "Worker",
                `Item not found: libraryID=${libraryID}, key=${key}`,
            );
        }
        await _libraryNote!.extractAnnotationImages(item, force);
    },

    getCollectionItemsMetadata: async (
        libraryID: number,
        collectionKey: string | null,
    ): Promise<BaseViewItemMetadata[]> => {
        assertInitialized();

        const items = collectionKey
            ? await _dbHelper!.getCollectionItems(libraryID, collectionKey)
            : await _dbHelper!.getLibraryItems(libraryID);

        return items.map((item) => {
            const data = item.raw.data;
            const meta = item.raw.meta;

            // Build creators list
            let creators: string[] = [];
            if (meta?.creatorsSummary) {
                creators = [meta.creatorsSummary];
            } else if ("creators" in data && data.creators) {
                creators = data.creators.map(
                    (c) =>
                        c.name ||
                        `${c.firstName || ""} ${c.lastName || ""}`.trim(),
                );
            }

            return {
                key: item.key,
                libraryID: item.libraryID,
                citationKey: item.citationKey || "",
                itemType: item.itemType,
                title: item.title || "",
                creators,
                date: ("date" in data ? data.date : undefined) || null,
                dateAdded: item.dateAdded,
                dateModified: item.dateModified,
                publicationTitle: ("publicationTitle" in data ? data.publicationTitle : undefined),
                publisher: ("publisher" in data ? data.publisher : undefined),
                place: ("place" in data ? data.place : undefined),
                volume: ("volume" in data ? data.volume : undefined),
                issue: ("issue" in data ? data.issue : undefined),
                pages: ("pages" in data ? data.pages : undefined),
                series: ("series" in data ? data.series : undefined),
                seriesNumber: ("seriesNumber" in data ? data.seriesNumber : undefined),
                edition: ("edition" in data ? data.edition : undefined),
                url: ("url" in data ? data.url : undefined),
                DOI: ("DOI" in data ? data.DOI : undefined),
                ISBN: ("ISBN" in data ? data.ISBN : undefined),
                ISSN: ("ISSN" in data ? data.ISSN : undefined),
                abstractNote: ("abstractNote" in data ? data.abstractNote : undefined),
                tags: (data.tags || []).map((t) => t.tag),
            };
        });
    },

    updateSettings: (settings: ZotFlowSettings) => {
        assertInitialized();

        // Safe updates
        _zotero!.updateCredentials(settings.zoteroapikey);
        _webdav!.updateSettings(settings);
        _attachment!.updateSettings(settings);
        _sync!.updateSettings(settings);
        _treeView!.updateSettings(settings);
        _library!.updateSettings(settings);
        _template!.updateSettings(settings);
        _libraryNote!.updateSettings(settings);
        _itemNote!.updateSettings(settings);
        _localNote!.updateSettings(settings);
        _localTemplate!.updateSettings(settings);
        _notePath!.updateSettings(settings);
        _dbHelper!.updateSettings(settings);
        _tag!.updateSettings(settings);
        _documentWorker!.updateSettings(settings);
        _cslRender!.updateSettings(settings);
        _currentSettings = settings;
    },
};

Comlink.expose(exposedApi);
