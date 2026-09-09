import type { CustomReaderTheme } from "types/zotero-reader";
import type { OutputFormat as CslOutputFormat } from "worker/csl";

/** Per-library sync mode. */
export type LibrarySyncMode = "bidirectional" | "readonly" | "ignored";

/** Reader color scheme mode. */
export type ReaderColorScheme =
    | "light"
    | "dark"
    | "obsidian"
    | "obsidian-theme";

/** Settings tab identifier. */
export type TabSection =
    | "sync"
    | "webdav"
    | "cache"
    | "general"
    | "citation";

/** Sort order for collections in the tree view. */
export type CollectionSortOrder = "name-asc" | "name-desc";

/** Sort order for items in the tree view. */
export type ItemSortOrder =
    | "title-asc"
    | "title-desc"
    | "modified-new"
    | "modified-old"
    | "added-new"
    | "added-old";

/** Citation insertion format. */
export type CitationFormat = "pandoc" | "footnote" | "wikilink" | "citekey";

/** Auto-copy mode applied when a new annotation is created in the reader. */
export type AutoCopyAnnotationMode = "off" | "embed" | "text" | "citation";

/** Per-library sync configuration. */
export interface LibraryConfig {
    mode: LibrarySyncMode;
}

export interface BookmarkedItem {
    id: string; // "libraryID:key"
    libraryID: number;
    key: string;
    name: string;
    itemType: string;
    contentType?: string;
    addedAt: number; // timestamp
}

export interface RecentItem {
    id: string; // "libraryID:key"
    libraryID: number;
    key: string;
    name: string;
    itemType: string;
    contentType?: string;
    openedAt: number; // timestamp
}

/** Full plugin settings shape persisted to `data.json`. */
export interface ZotFlowSettings {
    zoteroapikey: string;
    librariesConfig: Record<string, LibraryConfig>;
    syncInterval: number; // in minutes
    autoSync: boolean;
    useWebDav: boolean;
    webDavUrl?: string;
    webDavUser?: string;
    webdavpassword?: string;
    webDavVerified?: boolean;
    useCache: boolean;
    maxCacheSizeMB: number;
    librarySourceNoteTemplatePath: string;
    localSourceNoteTemplatePath: string;
    localSourceNoteFolder: string;
    localSidecarFolder: string;
    sourceNoteFolder: string;
    librarySourceNotePathTemplate: string;
    localSourceNotePathTemplate: string;
    autoImportAnnotationImages: boolean;
    annotationImageFolder: string;
    overwriteViewer: boolean;
    readerColorScheme: ReaderColorScheme;
    defaultLightTheme: string;
    defaultDarkTheme: string;
    treeCollectionSort: CollectionSortOrder;
    treeItemSort: ItemSortOrder;
    bookmarkedItems: BookmarkedItem[];
    recentItems: RecentItem[];
    maxRecentItems: number;
    treeSingleClickOpen: boolean;
    showTreeItemIcons: boolean;
    showTreeLibrary: boolean;
    showTreeRecents: boolean;
    showTreeBookmarks: boolean;
    showTreeNotes: boolean;
    showTreeBases: boolean;
    convertNoteLinks: boolean;
    linkedAttachmentBaseDir: string;
    useZoteroStorage: boolean;
    zoteroStoragePath: string;
    defaultEditableRegionLocked: boolean;
    hideEditableRegionMarkers: boolean;
    alwaysOpenChildNoteInEditor: boolean;
    defaultCitationFormat: CitationFormat;
    citationTrigger: string;
    citationPandocTemplate: string;
    citationFootnoteRefTemplate: string;
    citationFootnoteTemplate: string;
    citationWikilinkTemplate: string;
    baseViewFolder: string;
    autoCopyAnnotation: AutoCopyAnnotationMode;
    autoUpdateSourceNotesAfterSync: boolean;
    autoPurgeTrashedSourceNotes: boolean;
    autoDisableNoteImageTextTools: boolean;
    epubFontFamily: string;
    /** CSL renderer: default style id (slug or custom style key). */
    cslDefaultStyleId: string;
    /** CSL renderer: default output format. */
    cslDefaultFormat: CslOutputFormat;
    /** Vault-relative folder scanned for custom .csl styles; "" disables. */
    cslStylesFolder: string;
}

/** Top-level key addressable by Obsidian's declarative settings controls. */
export type SettingKey = Extract<keyof ZotFlowSettings, string>;

/** Re-exported so main-thread settings UI can reference the format union. */
export type { CslOutputFormat };

/** Persisted reader view state for a single attachment (local or zotero). */
export interface ViewStateEntry {
    primaryViewState?: Record<string, unknown>;
    secondaryViewState?: Record<string, unknown>;
    lightTheme?: string;
    darkTheme?: string;
}

/**
 * Full shape of data.json.
 * Settings and non-settings data are stored as separate top-level keys.
 *
 * `viewStates` is keyed by file path (local) or `"libraryID:itemKey"` (zotero).
 */
export interface ZotFlowPluginData {
    settings: ZotFlowSettings;
    customThemes: CustomReaderTheme[];
    viewStates: Record<string, ViewStateEntry>;
}

/** Default values for all `ZotFlowSettings` fields. */
export const DEFAULT_SETTINGS: ZotFlowSettings = {
    zoteroapikey: "",
    librariesConfig: {},
    syncInterval: 30,
    autoSync: false,
    useWebDav: false,
    webDavVerified: false,
    useCache: true,
    maxCacheSizeMB: 500,
    librarySourceNoteTemplatePath: "",
    sourceNoteFolder: "",
    librarySourceNotePathTemplate:
        "Source/{{libraryName}}/@{{citationKey | default: title | default: key}}",
    localSourceNoteTemplatePath: "",
    localSourceNoteFolder: "",
    localSidecarFolder: "",
    localSourceNotePathTemplate: "Source/Local/@{{basename}}",
    autoImportAnnotationImages: false,
    annotationImageFolder: "",
    overwriteViewer: true,
    readerColorScheme: "obsidian-theme",
    defaultLightTheme: "obsidian",
    defaultDarkTheme: "obsidian",
    treeCollectionSort: "name-asc",
    treeItemSort: "title-asc",
    bookmarkedItems: [],
    recentItems: [],
    maxRecentItems: 10,
    treeSingleClickOpen: false,
    showTreeItemIcons: true,
    showTreeLibrary: true,
    showTreeRecents: true,
    showTreeBookmarks: true,
    showTreeNotes: true,
    showTreeBases: true,
    convertNoteLinks: true,
    linkedAttachmentBaseDir: "",
    useZoteroStorage: false,
    zoteroStoragePath: "",
    defaultEditableRegionLocked: true,
    hideEditableRegionMarkers: false,
    alwaysOpenChildNoteInEditor: false,
    defaultCitationFormat: "footnote",
    citationTrigger: "@@",
    citationPandocTemplate: "",
    citationFootnoteRefTemplate: "",
    citationFootnoteTemplate: "",
    citationWikilinkTemplate: "",
    baseViewFolder: "ZotFlow/Bases",
    autoCopyAnnotation: "off",
    autoUpdateSourceNotesAfterSync: true,
    autoPurgeTrashedSourceNotes: false,
    autoDisableNoteImageTextTools: true,
    epubFontFamily: "",
    cslDefaultStyleId: "apa",
    cslDefaultFormat: "markdown",
    cslStylesFolder: "",
};

/** Default shape of the full `data.json` blob (settings + view states). */
export const DEFAULT_PLUGIN_DATA: ZotFlowPluginData = {
    settings: { ...DEFAULT_SETTINGS },
    customThemes: [],
    viewStates: {},
};
