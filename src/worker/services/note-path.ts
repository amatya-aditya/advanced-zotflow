import { Liquid } from "liquidjs";
import type { ZotFlowSettings } from "settings/types";
import type { AnyIDBZoteroItem } from "types/db-schema";
import type { TFileWithoutParentAndVault } from "types/zotflow";
import { db } from "db/db";
import { ZotFlowError, ZotFlowErrorCode } from "utils/error";

const FALLBACK_ZOTERO_TEMPLATE =
    "Source/{{libraryName}}/@{{citationKey | default: title | default: key}}";

const FALLBACK_LOCAL_TEMPLATE = "Source/Local/@{{basename}}";

/** Sanitize a single path segment (filename or folder name). */
function sanitizeSegment(segment: string): string {
    const illegalRe = /[/?<>\\:*|"]/g;
    const controlRe = /[\x00-\x1f\x80-\x9f]/g;
    const reservedRe = /^\.+$/;
    const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

    let s = segment.replace(illegalRe, "").replace(controlRe, "").trim();

    if (reservedRe.test(s)) s = "_";
    if (windowsReservedRe.test(s)) s = `_${s}`;

    return s;
}

/** Keys that hold date/time values and should not be sanitized (colons are valid in ISO 8601). */
const DATE_KEYS: ReadonlySet<string> = new Set([
    "date",
    "dateAdded",
    "dateModified",
    "accessDate",
]);

/** Sanitize all string values in a template context object, skipping date fields. */
function sanitizeContext(
    ctx: Record<string, unknown>,
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ctx)) {
        if (typeof value === "string") {
            result[key] = DATE_KEYS.has(key) ? value : sanitizeSegment(value);
        } else if (
            Array.isArray(value) &&
            value.length > 0 &&
            typeof value[0] === "object"
        ) {
            result[key] = value.map((item: Record<string, unknown>) => {
                const cleaned: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(item)) {
                    cleaned[k] = typeof v === "string" ? sanitizeSegment(v) : v;
                }
                return cleaned;
            });
        } else {
            result[key] = value;
        }
    }
    return result;
}

/** Normalize a rendered path: collapse slashes, strip empties, append `.md`. */
function sanitizePath(rawPath: string): string {
    const normalized = rawPath.replace(/\\/g, "/").replace(/\/+/g, "/");
    const segments = normalized.split("/").filter((s) => s.trim().length > 0);
    return `${segments.join("/")}.md`;
}

/** Resolves configurable note file paths via LiquidJS templates. */
export class NotePathService {
    private engine: Liquid;

    constructor(private settings: ZotFlowSettings) {
        this.engine = new Liquid({ greedy: false });
    }

    updateSettings(settings: ZotFlowSettings) {
        this.settings = settings;
    }

    /** Resolve the vault path for a library (Zotero) item source note. */
    async resolveLibraryNotePath(
        item: AnyIDBZoteroItem,
        libraryName: string,
        templateOverride?: string,
    ): Promise<string> {
        const template =
            templateOverride?.trim() ||
            this.settings.librarySourceNotePathTemplate.trim() ||
            FALLBACK_ZOTERO_TEMPLATE;

        const raw = item.raw || {};
        const data = (raw.data || {}) as unknown as Record<string, unknown>;

        let creators: { name: string }[] = [];
        if (raw.meta?.creatorsSummary) {
            if (typeof raw.meta.creatorsSummary === "string") {
                creators = [{ name: raw.meta.creatorsSummary }];
            }
        } else if (Array.isArray(data.creators)) {
            creators = (data.creators as Array<Record<string, string>>).map(
                (c) => ({
                    name:
                        c.name ||
                        `${c.firstName || ""} ${c.lastName || ""}`.trim(),
                }),
            );
        }

        const context = {
            // Identity
            key: item.key,
            version: item.version,
            citationKey: item.citationKey || "",
            libraryID: item.libraryID,
            itemType: item.itemType,

            // Metadata
            title: item.title || "",
            creators,
            date: (data.date as string) || "",
            dateAdded: item.dateAdded,
            dateModified: item.dateModified,
            accessDate: (data.accessDate as string) || "",
            abstractNote: (data.abstractNote as string) || "",
            publicationTitle: (data.publicationTitle as string) || "",
            publisher: (data.publisher as string) || "",
            place: (data.place as string) || "",
            volume: (data.volume as string) || "",
            issue: (data.issue as string) || "",
            pages: (data.pages as string) || "",
            series: (data.series as string) || "",
            seriesNumber: (data.seriesNumber as string) || "",
            edition: (data.edition as string) || "",
            url: (data.url as string) || "",
            DOI: (data.DOI as string) || "",
            ISBN: (data.ISBN as string) || "",
            ISSN: (data.ISSN as string) || "",
            tags: (data.tags as Array<{ tag: string }>) || [],

            // Derived
            libraryName,
            year:
                typeof data.date === "string"
                    ? (data.date as string).slice(0, 4)
                    : "",
        };

        const rendered = await this.engine.parseAndRender(
            template,
            sanitizeContext(context),
        );
        return sanitizePath(rendered);
    }

    /** Resolve the vault path for a local attachment source note. */
    async resolveLocalNotePath(
        localAttachment: TFileWithoutParentAndVault,
        templateOverride?: string,
    ): Promise<string> {
        const template =
            templateOverride?.trim() ||
            this.settings.localSourceNotePathTemplate.trim() ||
            FALLBACK_LOCAL_TEMPLATE;

        const context = {
            basename: localAttachment.basename,
            name: localAttachment.name,
            path: localAttachment.path,
            extension: localAttachment.extension,
        };

        const rendered = await this.engine.parseAndRender(
            template,
            sanitizeContext(context),
        );
        return sanitizePath(rendered);
    }

    /** Preview the resolved path for a library item with a custom path template. */
    async previewLibraryNotePath(
        libraryID: number,
        key: string,
        pathTemplate: string,
    ): Promise<string> {
        const item = await db.items.get([libraryID, key]);
        if (!item) {
            throw new ZotFlowError(
                ZotFlowErrorCode.RESOURCE_MISSING,
                "NotePathService",
                `Item not found: ${libraryID}/${key}`,
            );
        }
        const library = await db.libraries.get(libraryID);
        const libraryName = library?.name || "Unknown";
        return this.resolveLibraryNotePath(item, libraryName, pathTemplate);
    }

    /** Preview the resolved path for a local file with a custom path template. */
    async previewLocalNotePath(
        file: TFileWithoutParentAndVault,
        pathTemplate: string,
    ): Promise<string> {
        return this.resolveLocalNotePath(file, pathTemplate);
    }

    /** Return the current path template string from settings. */
    getDefaultPathTemplate(mode: "library" | "local"): string {
        return mode === "library"
            ? this.settings.librarySourceNotePathTemplate
            : this.settings.localSourceNotePathTemplate;
    }
}
