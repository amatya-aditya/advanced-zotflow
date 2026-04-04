import { Liquid } from "liquidjs";
import type { AnyIDBZoteroItem, IDBZoteroItem } from "types/db-schema";
import { db, getCombinations } from "db/db";
import type {
    ItemTemplateContext,
    NoteTemplateContext,
    AnnotationTemplateContext,
    AttachmentTemplateContext,
} from "types/template-context";
import type { IParentProxy } from "bridge/types";
import type {
    AnnotationData,
    AttachmentData,
    NoteData,
} from "types/zotero-item";
import type { ZotFlowSettings } from "settings/types";
import { ZotFlowError, ZotFlowErrorCode } from "utils/error";
import { getAnnotationJson } from "db/annotation";
import type { AnnotationJSON } from "types/zotero-reader";
import type { DbHelperService } from "./db-helper";
import type { ConvertService } from "./convert";
import type { Html2MdOptions } from "worker/convert";
import type { NotePathService } from "./note-path";
import type { CitationTemplateInput } from "services/citation-service";

const DEFAULT_ITEM_TEMPLATE = `---
citationKey: {{ item.citationKey | json }}
title: {{ item.title | json }}
itemType: {{ item.itemType | json }}
creators: [{% for c in item.creators %}"{{ c.name }}"{% unless forloop.last %}, {% endunless %}{% endfor %}]
publication: {{ item.publicationTitle | default: item.publisher | json }}
date: {{ item.date | json }}
year: {{ item.date | slice: 0, 4 }}
url: {{ item.url | json }}
doi: {{ item.DOI | json }}
{%- if item.pages %}
pages: {{ item.pages | json }}
{%- endif %}
{%- if item.volume %}
volume: {{ item.volume | json }}
{%- endif %}
{%- if item.issue %}
issue: {{ item.issue | json }}
{%- endif %}
{%- if item.ISBN %}
isbn: {{ item.ISBN | json }}
{%- endif %}
{%- if item.ISSN %}
issn: {{ item.ISSN | json }}
{%- endif %}
{%- if item.publisher %}
publisher: {{ item.publisher | json }}
{%- endif %}
{%- if item.place %}
place: {{ item.place | json }}
{%- endif %}
{%- if item.series %}
series: {{ item.series | json }}
{%- endif %}
{%- if item.edition %}
edition: {{ item.edition | json }}
{%- endif %}
{%- if item.abstractNote %}
abstract: {{ item.abstractNote | json }}
{%- endif %}
{%- if item.tags.length > 0 %}
tags: [{% for t in item.tags %}"{{ t.tag }}"{% unless forloop.last %}, {% endunless %}{% endfor %}]
{%- endif %}
dateAdded: {{ item.dateAdded | json }}
---
{%- capture quote_string %}{{ newline }}> {% endcapture -%}
{%- capture quote_string_2 %}{{ newline }}> >{% endcapture -%}
# {{ item.title }}
{%- if item.abstractNote -%}
## Abstract
> {{ item.abstractNote | replace: newline, quote_string }}

{%- endif -%}
{%- if item.attachments.length > 0 -%}
## Attachments
{%- for attachment in item.attachments -%}
- [{{ attachment.filename | truncate_words: 4 }}](obsidian://zotflow?type=open-attachment&libraryID={{ attachment.libraryID }}&key={{ attachment.key }})
{%- endfor -%}

{%- endif -%}
{%- if item.notes.length > 0 -%}
## Notes
{%- for note in item.notes -%}
### {{ note.title | default: "Note" }}
{{ note.note }}
{%- endfor -%}

{%- endif -%}
{%- if item.attachments.length > 0 and item.attachmentAnnotations.length > 0 -%}
## Annotations
{%- for attachment in item.attachments -%}
{%- if attachment.annotations.length > 0 -%}
### {{ attachment.filename | truncate_words: 4 }}
{%- for annotation in attachment.annotations -%}
> [!zotflow-{{ annotation.type }}-{{ annotation.color }}] [{{ attachment.filename | truncate_words: 4 }}, p.{{ annotation.pageLabel }}](obsidian://zotflow?type=open-attachment&libraryID={{ attachment.libraryID }}&key={{ attachment.key }}&navigation={{ annotation.key | process_nav_info}})
{%- if annotation.type == "ink" or annotation.type == "image"-%}
> > ![[{{settings.annotationImageFolder}}/{{ annotation.key }}.png]]
{%- else -%}
> > {{ annotation.text | replace: newline, quote_string_2 }}
{%- endif -%}
{%- if annotation.comment != "" -%}
>
> {{ annotation.comment | replace: newline, quote_string }}
{%- endif -%}^{{ annotation.key }}

{%- endfor -%}
{%- endif -%}
{%- endfor -%}
{%- endif -%}
{%- if item.attachments.length == 0 and item.itemType == "attachment" and item.annotations.length > 0 -%}
## Annotations
{%- for annotation in item.annotations -%}
> [!zotflow-{{ annotation.type }}-{{ annotation.color }}] [{{ item.title | truncate_words: 4 }}, p.{{ annotation.pageLabel }}](obsidian://zotflow?type=open-attachment&libraryID={{ item.libraryID }}&key={{ item.key }}&navigation={{ annotation.key | process_nav_info}})
{%- if annotation.type == "ink" or annotation.type == "image"-%}
> > ![[{{settings.annotationImageFolder}}/{{ annotation.key }}.png]]
{%- else -%}
> > {{ annotation.text | replace: newline, quote_string_2 }}
{%- endif -%}
{%- if annotation.comment != "" -%}
>
> {{ annotation.comment | replace: newline, quote_string }}
{%- endif -%}^{{ annotation.key }}

{%- endfor -%}
{%- endif -%}

%% ZOTFLOW_USER_START %%
`;

const FALLBACK_WIKILINK_TEMPLATE = `{%- if annotations.size > 0 -%}{%- for annotation in annotations -%}
[[{{ notePath }}#^{{ annotation.key }}|{{ item.creators[0].name | default: "Unknown" }} ({{ item.date | slice: 0, 4 }}), p. {{ annotation.pageLabel }}]]{% if forloop.last == false %}, {% endif %}{%- endfor -%}{%- else -%}
[[{{ notePath }}|{{ item.creators[0].name | default: "Unknown" }} ({{ item.date | slice: 0, 4 }})]] {%- endif -%}`;

const FALLBACK_PANDOC_TEMPLATE =
    "[@{{ item.citationKey | default: item.key }}{% if annotations.size > 0 %}{% assign pages = annotations | map: 'pageLabel' | compact | uniq | join: ', ' %}{% if pages != empty %}, pp. {{ pages }}{% endif %}{% endif %}]";

const FALLBACK_FOOTNOTE_REF_TEMPLATE =
    "[^{{ item.citationKey | default: item.key }}]";

const FALLBACK_FOOTNOTE_TEMPLATE = `{%- if item.creators.length > 1 -%}
{{ item.creators[0].name }} et al. {%- elsif item.creators.length == 1 -%}
 {{ item.creators[0].name }} {%- else -%}
Unknown Author {%- endif -%}, *{{ item.title }}* ({{ item.date | slice: 0, 4 }}).`;

/** LiquidJS template engine for rendering library (Zotero) item source notes. */
export class LibraryTemplateService {
    private engine: Liquid;

    constructor(
        private settings: ZotFlowSettings,
        private parentHost: IParentProxy,
        private dbHelper: DbHelperService,
        private notePathService: NotePathService,
        private convertService: ConvertService,
    ) {
        this.initialize();
    }

    initialize() {
        this.engine = new Liquid({
            extname: ".md",
            greedy: false,
            globals: {
                newline: "\n",
            },
        });
        this.engine.registerFilter("process_nav_info", (input: string) => {
            const navInfo = {
                annotationID: input,
            };
            return encodeURIComponent(JSON.stringify(navInfo));
        });

        // Truncate a filename to the first N words (default 4), preserving extension
        this.engine.registerFilter(
            "truncate_words",
            (input: string, maxWords?: number) => {
                if (!input) return input;
                const max = maxWords ?? 4;
                // Remove file extension
                const extMatch = input.match(/(\.[a-zA-Z0-9]+)$/);
                const ext = extMatch ? extMatch[1] : "";
                const nameWithoutExt = ext
                    ? input.slice(0, -ext.length)
                    : input;
                // Split into words (by spaces, hyphens, underscores)
                const words = nameWithoutExt
                    .split(/[\s_-]+/)
                    .filter((w) => w.length > 0);
                if (words.length <= max) return input;
                return words.slice(0, max).join(" ") + "..." + ext;
            },
        );
        this.engine.registerFilter(
            "wrap_editable",
            (input: string, type: string, key: string) => {
                if (!type || !key) return input;
                return `<!-- ZF_${type}_BEG_${key} -->\n${input}\n<!-- ZF_${type}_END_${key} -->`;
            },
        );
        this.engine.registerFilter("html2md", async (input: string) => {
            if (!input) return "";
            const vaultConfig = await this.parentHost.getVaultConfig();
            const options: Html2MdOptions = {
                annotationImageFolder:
                    this.settings.annotationImageFolder.replace(/\/$/, "") ||
                    undefined,
                strictLineBreaks: vaultConfig.strictLineBreaks,
            };
            return this.convertService.html2md(input, options);
        });
    }

    updateSettings(newSettings: ZotFlowSettings) {
        this.settings = newSettings;
    }

    async renderLibrarySourceNote(
        item: AnyIDBZoteroItem,
        templateContent: string | null,
        originalFrontmatter: Record<string, any> = {},
        existingContent?: string,
    ): Promise<string> {
        const context = await this.prepareItemContext(item);
        return this.renderTemplate(
            context,
            templateContent,
            originalFrontmatter,
            {
                "zotflow-locked": true,
                "zotero-key": item.key,
                "item-version": item.version,
                "library-id": item.libraryID,
            },
            existingContent,
        );
    }

    async renderItem(
        item: AnyIDBZoteroItem,
        templateContent: string | null,
        originalFrontmatter: Record<string, any> = {},
        existingContent?: string,
    ): Promise<string> {
        return this.renderLibrarySourceNote(
            item,
            templateContent,
            originalFrontmatter,
            existingContent,
        );
    }

    /**
     * Render a note using a pre-built template context (e.g. from workflow).
     * The `itemContext` is the same shape as `ItemTemplateContext`.
     */
    async renderWithContext(
        itemContext: ItemTemplateContext,
        templateContent: string | null,
        originalFrontmatter: Record<string, any> = {},
        existingContent?: string,
    ): Promise<string> {
        const context = {
            item: itemContext,
            settings: {
                ...this.settings,
                annotationImageFolder:
                    this.settings.annotationImageFolder.replace(/\/$/, ""),
            },
        };
        return this.renderTemplate(
            context,
            templateContent,
            originalFrontmatter,
            {
                "zotflow-locked": true,
                "zotero-key": itemContext.key,
                "item-version": itemContext.version,
                "library-id": itemContext.libraryID,
            },
            existingContent,
        );
    }

    private static readonly USER_ZONE_MARKER = "%% ZOTFLOW_USER_START %%";

    private async renderTemplate(
        context: any,
        templateContent: string | null,
        originalFrontmatter: Record<string, any>,
        mandatoryFields: Record<string, unknown>,
        existingContent?: string,
    ): Promise<string> {
        try {
            const template = templateContent || DEFAULT_ITEM_TEMPLATE;

            // Separate Frontmatter and Body
            const frontmatterRegex = /^---\s*([\s\S]*?)\s*---\n/;
            const match = template.match(frontmatterRegex);

            let templateFrontmatterRaw = "";
            let body = template;

            if (match) {
                templateFrontmatterRaw = match[1] || "";
                body = template.substring(match[0].length);
            } else {
                body = template;
            }

            // Parse Template Frontmatter
            let templateFrontmatter: any = {};
            if (templateFrontmatterRaw.trim()) {
                try {
                    // Render the frontmatter raw string first (as it may contain liquid tags)
                    const renderedFrontmatterRaw =
                        await this.engine.parseAndRender(
                            templateFrontmatterRaw,
                            context,
                        );

                    // Then parse the rendered string as YAML
                    templateFrontmatter = await this.parentHost.parseYaml(
                        renderedFrontmatterRaw,
                    );
                } catch (e) {
                    // We don't throw here, just proceed with empty frontmatter from template
                    this.parentHost.log(
                        "error",
                        "Failed to parse template frontmatter",
                        "LibraryTemplateService",
                    );
                }
            }

            // Merge Frontmatter (Original + Rendered Template)
            // Merge = Original + Template. Template keys overwrite Original keys.
            const finalFrontmatter = {
                ...originalFrontmatter,
                ...templateFrontmatter,
            };

            // Ensure Mandatory Fields
            Object.assign(finalFrontmatter, mandatoryFields);

            // Stringify Frontmatter
            const frontmatterString =
                await this.parentHost.stringifyYaml(finalFrontmatter);

            // Render Body
            const renderedBody = await this.engine.parseAndRender(
                body,
                context,
            );

            let result = `---\n${frontmatterString}---\n${renderedBody}`;

            // Preserve user content from existing file across updates
            if (existingContent) {
                const marker = LibraryTemplateService.USER_ZONE_MARKER;
                const existingMarkerIdx = existingContent.indexOf(marker);
                if (existingMarkerIdx !== -1) {
                    const userContent = existingContent.substring(
                        existingMarkerIdx + marker.length,
                    );
                    const newMarkerIdx = result.indexOf(marker);
                    if (newMarkerIdx !== -1) {
                        result =
                            result.substring(0, newMarkerIdx + marker.length) +
                            userContent;
                    }
                }
            }

            return result;
        } catch (e) {
            throw ZotFlowError.wrap(
                e,
                ZotFlowErrorCode.PARSE_ERROR,
                "LibraryTemplateService",
                "Template rendering failed",
            );
        }
    }

    private sanitizeQuotesString(str: string): string {
        // Escape >, < into \>, \<
        return str.replace(/>/g, "\\>").replace(/</g, "\\<");
    }

    public async prepareItemContext(item: AnyIDBZoteroItem): Promise<any> {
        return {
            item: await this.mapToItemContext(item),
            settings: {
                ...this.settings,
                annotationImageFolder:
                    this.settings.annotationImageFolder.replace(/\/$/, ""),
            },
        };
    }

    public async mapToItemContext(
        item: AnyIDBZoteroItem,
    ): Promise<ItemTemplateContext> {
        const raw = item.raw || {};
        const data = raw.data || {};

        const children = await db.items
            .where(["libraryID", "parentItem", "itemType", "trashed"])
            .anyOf(
                getCombinations([
                    [item.libraryID],
                    [item.key],
                    ["note", "annotation", "attachment"],
                    [0],
                ]),
            )
            .toArray();

        const notes = await Promise.all(
            children
                .filter((c) => c.itemType === "note")
                .map((note) => this.mapToNoteContext(note)),
        );

        const attachments = await Promise.all(
            children
                .filter((c) => c.itemType === "attachment")
                .map((att) => this.mapToAttachmentContext(att)),
        );

        const annotations = (
            await getAnnotationJson(
                item as any,
                this.settings.zoteroapikey,
                (item) => item.syncStatus !== "deleted",
            )
        ).map((a) => this.mapToAnnotationContext(a));

        const attachmentAnnotations = attachments.flatMap(
            (att) => att.annotations,
        );

        let creatorsObj: { name: string }[] = [];
        if (raw.meta?.creatorsSummary) {
            if (typeof raw.meta.creatorsSummary === "string") {
                creatorsObj = [{ name: raw.meta.creatorsSummary }];
            }
        } else if ((data as any).creators) {
            creatorsObj = (data as any).creators.map((c: any) => ({
                name:
                    c.name || `${c.firstName || ""} ${c.lastName || ""}`.trim(),
            }));
        }

        const itemPaths = await this.dbHelper
            .getItemPaths([
                {
                    libraryID: item.libraryID,
                    key: item.key,
                    collections: item.collections,
                },
            ])
            .then((paths) => paths[`${item.libraryID}:${item.key}`] || []);

        return {
            key: item.key,
            version: item.version,
            libraryID: item.libraryID,
            citationKey: item.citationKey || "",
            itemPaths: itemPaths,
            notes,
            annotations,
            attachmentAnnotations,
            attachments,
            itemType: item.itemType,
            title: item.title || "",
            creators: creatorsObj,
            date: (data as any).date || null,
            dateAdded: item.dateAdded,
            dateModified: item.dateModified,
            accessDate: (data as any).accessDate || null,
            abstractNote: (data as any).abstractNote,
            publicationTitle: (data as any).publicationTitle,
            publisher: (data as any).publisher,
            place: (data as any).place,
            volume: (data as any).volume,
            issue: (data as any).issue,
            pages: (data as any).pages,
            series: (data as any).series,
            seriesNumber: (data as any).seriesNumber,
            edition: (data as any).edition,
            url: (data as any).url,
            DOI: (data as any).DOI,
            ISBN: (data as any).ISBN,
            ISSN: (data as any).ISSN,
            tags: (data as any).tags || [],
        };
    }

    public async mapToNoteContext(
        item: IDBZoteroItem<NoteData>,
    ): Promise<NoteTemplateContext> {
        const data = item.raw.data || {};
        return {
            key: item.key,
            libraryID: item.libraryID,
            title: item.title || "",
            note: data.note || "",
            tags: data.tags || [],
            dateAdded: item.dateAdded,
            dateModified: item.dateModified,
        };
    }

    public mapToAnnotationContext(
        annotation: AnnotationJSON,
    ): AnnotationTemplateContext {
        return {
            key: annotation.id!,
            libraryID: annotation.libraryID!,
            type: annotation.type,
            authorName: annotation.authorName,
            text: this.sanitizeQuotesString(annotation.text || ""),
            comment: this.convertService.annoHtml2md(annotation.comment || ""),
            color: annotation.color,
            pageLabel: annotation.pageLabel,
            tags: annotation.tags?.map((t) => ({ tag: t.name })) || [],
            dateAdded: annotation.dateAdded,
            dateModified: annotation.dateModified,

            raw: annotation,
        };
    }

    public async mapToAttachmentContext(
        item: IDBZoteroItem<AttachmentData>,
    ): Promise<AttachmentTemplateContext> {
        const annotations = (
            await getAnnotationJson(
                item,
                this.settings.zoteroapikey,
                (item) => item.syncStatus !== "deleted",
            )
        ).map((a) => this.mapToAnnotationContext(a));

        const data = item.raw.data || {};
        return {
            key: item.key,
            libraryID: item.libraryID,
            filename: data.filename || "",
            contentType: data.contentType || "",
            tags: data.tags || [],
            dateAdded: item.dateAdded,
            dateModified: item.dateModified,

            annotations,
        };
    }

    /** Preview-render a library item with the given template content. */
    async previewLibrarySourceNote(
        libraryID: number,
        key: string,
        templateContent: string,
    ): Promise<string> {
        const item = await db.items.get([libraryID, key]);
        if (!item) {
            throw new ZotFlowError(
                ZotFlowErrorCode.RESOURCE_MISSING,
                "LibraryTemplateService",
                `Item not found: ${libraryID}/${key}`,
            );
        }
        return this.renderLibrarySourceNote(item, templateContent, {});
    }

    async previewItem(
        libraryID: number,
        key: string,
        templateContent: string,
    ): Promise<string> {
        return this.previewLibrarySourceNote(
            libraryID,
            key,
            templateContent,
        );
    }

    /** Return the user-configured template file content, or the built-in default. */
    async getDefaultTemplate(): Promise<string> {
        const path = this.settings.librarySourceNoteTemplatePath;
        if (path) {
            try {
                const content = await this.parentHost.readTextFile(path);
                if (content != null) return content;
            } catch {
                // Fall through to default
            }
        }
        return DEFAULT_ITEM_TEMPLATE;
    }

    /** Render a citation template for an item, with notePath in the context. */
    async renderCitationTemplate(
        input: CitationTemplateInput,
        notePath: string,
        format: "pandoc" | "wikilink" | "footnote" | "footnote-ref",
    ): Promise<string> {
        let template: string;
        if (format === "pandoc") {
            template =
                this.settings.citationPandocTemplate.trim() === ""
                    ? FALLBACK_PANDOC_TEMPLATE
                    : this.settings.citationPandocTemplate.trim();
        } else if (format === "wikilink") {
            template =
                this.settings.citationWikilinkTemplate.trim() === ""
                    ? FALLBACK_WIKILINK_TEMPLATE
                    : this.settings.citationWikilinkTemplate.trim();
        } else if (format === "footnote-ref") {
            template =
                this.settings.citationFootnoteRefTemplate.trim() === ""
                    ? FALLBACK_FOOTNOTE_REF_TEMPLATE
                    : this.settings.citationFootnoteRefTemplate.trim();
        } else {
            template =
                this.settings.citationFootnoteTemplate.trim() === ""
                    ? FALLBACK_FOOTNOTE_TEMPLATE
                    : this.settings.citationFootnoteTemplate.trim();
        }

        if (!template) return "";

        const item = await db.items.get([input.item.libraryID, input.item.key]);
        if (!item) {
            throw new ZotFlowError(
                ZotFlowErrorCode.RESOURCE_MISSING,
                "LibraryTemplateService",
                `Item not found: ${input.item.libraryID}/${input.item.key}`,
            );
        }

        const context = {
            item: await this.mapToItemContext(item),
            notePath,
            annotations: input.annotations?.map((annotation) =>
                this.mapToAnnotationContext(annotation),
            ),
        } as Record<string, unknown>;

        return this.engine.parseAndRender(template, context);
    }

    /** Preview a citation template for a library item without creating a file. */
    async previewCitationTemplate(
        input: CitationTemplateInput,
        template: string,
    ): Promise<string> {
        const item = await db.items.get([input.item.libraryID, input.item.key]);
        if (!item) {
            throw new ZotFlowError(
                ZotFlowErrorCode.RESOURCE_MISSING,
                "LibraryTemplateService",
                `Item not found: ${input.item.libraryID}/${input.item.key}`,
            );
        }

        const notePath =
            await this.notePathService.resolveLibraryNotePath(item);
        const context = {
            item: await this.mapToItemContext(item),
            notePath,
            annotations: input.annotations?.map((annotation) =>
                this.mapToAnnotationContext(annotation),
            ),
        } as Record<string, unknown>;

        return this.engine.parseAndRender(template, context);
    }

    /** Return the active citation template string for the requested format. */
    getDefaultCitationTemplate(
        format: "pandoc" | "wikilink" | "footnote" | "footnote-ref",
    ): string {
        if (format === "pandoc") {
            return this.settings.citationPandocTemplate.trim() === ""
                ? FALLBACK_PANDOC_TEMPLATE
                : this.settings.citationPandocTemplate.trim();
        }
        if (format === "wikilink") {
            return this.settings.citationWikilinkTemplate.trim() === ""
                ? FALLBACK_WIKILINK_TEMPLATE
                : this.settings.citationWikilinkTemplate.trim();
        }
        if (format === "footnote-ref") {
            return this.settings.citationFootnoteRefTemplate.trim() === ""
                ? FALLBACK_FOOTNOTE_REF_TEMPLATE
                : this.settings.citationFootnoteRefTemplate.trim();
        }
        return this.settings.citationFootnoteTemplate.trim() === ""
            ? FALLBACK_FOOTNOTE_TEMPLATE
            : this.settings.citationFootnoteTemplate.trim();
    }
}
