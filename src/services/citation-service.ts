import { TFile } from "obsidian";
import { workerBridge } from "bridge";
import { services } from "./services";
import type { AnyIDBZoteroItem } from "types/db-schema";
import type { CitationFormat } from "settings/types";
import type { AnnotationJSON } from "types/zotero-reader";

/** A Zotero item bundled with its optional annotation for citation. */
export interface CitationTemplateInput {
    item: AnyIDBZoteroItem;
    annotation?: AnnotationJSON;
}

/** Result of citation generation for a single item. */
export interface CitationResult {
    /** Inline citation text (e.g., `[@key]`, `[^key]`, `[[note]]`). */
    citation: string;
    /** Citation key (e.g., `smith2024` or item key). */
    citekey: string;
    /** Footnote definition line (only for footnote format). */
    footnoteDef?: string;
}

/** Minimal reference to a Zotero item for citation resolution. */
export interface CitationRef {
    libraryID: number;
    key: string;
    annotation?: AnnotationJSON;
}

/** Generates citation strings for Zotero items. */
export class CitationService {
    /**
     * Resolve a citation from a minimal item reference.
     * Fetches the item from DB, ensures a source note exists, and generates
     * the citation string. This is the single entry point for all citation
     * generation — used by CitationSuggest, drop handler, and future copy handler.
     */
    async resolve(
        ref: CitationRef,
        format: CitationFormat,
    ): Promise<CitationResult | null> {
        const item = await workerBridge.dbHelper.getItem(
            ref.libraryID,
            ref.key,
        );
        if (!item) {
            services.logService.error(
                `Item not found: ${ref.libraryID}/${ref.key}`,
                "CitationService",
            );
            return null;
        }

        const input: CitationTemplateInput = {
            item,
            annotation: ref.annotation,
        };

        // Resolve note path (cache hit → instant, miss → quick-create stub)
        const notePath =
            services.indexService.getFileByKey(item.key)?.path ??
            (await workerBridge.libraryNote.ensureNotePath(
                item.libraryID,
                item.key,
            ));

        if (!notePath) {
            services.logService.error(
                `Unable to resolve or create source note for item ${item.libraryID}/${item.key}`,
                "CitationService",
            );
            return null;
        }

        try {
            switch (format) {
                case "pandoc":
                    return await this.pandoc(input, notePath);
                case "wikilink":
                    return await this.wikilink(input, notePath);
                case "footnote":
                    return await this.footnote(input, notePath);
                case "citekey":
                    return this.citekey(input);
            }
        } catch (error) {
            services.logService.error(
                `Error generating citation for item ${item.libraryID}/${item.key}: ${error}`,
                "CitationService",
                error,
            );
            return null;
        }
    }

    /** `[@citekey]` — template-rendered or hardcoded fallback. */
    private async pandoc(
        input: CitationTemplateInput,
        notePath: string,
    ): Promise<CitationResult> {
        const citekey = input.item.citationKey || input.item.key;
        const rendered =
            await workerBridge.libraryTemplate.renderCitationTemplate(
                input,
                notePath,
                "pandoc",
            );
        if (rendered) {
            return { citation: rendered, citekey };
        }

        // Fallback: simple `[@citekey]`
        return { citation: `[@${citekey}]`, citekey };
    }

    /** `@citekey` — raw citation key only. */
    private citekey(input: CitationTemplateInput): CitationResult {
        const citekey = input.item.citationKey || input.item.key;
        return { citation: `@${citekey}`, citekey };
    }

    /** Wikilink: template-rendered or `generateMarkdownLink` fallback. */
    private async wikilink(
        input: CitationTemplateInput,
        notePath: string,
    ): Promise<CitationResult> {
        const citekey = input.item.citationKey || input.item.key;

        const rendered =
            await workerBridge.libraryTemplate.renderCitationTemplate(
                input,
                notePath,
                "wikilink",
            );
        if (rendered) {
            return { citation: rendered, citekey };
        }
        // Fallback: generateMarkdownLink
        const file = services.app.vault.getAbstractFileByPath(notePath);
        if (file instanceof TFile) {
            const link = services.app.fileManager.generateMarkdownLink(
                file,
                "",
                "",
                file.name.split(".").shift(),
            );
            return { citation: link, citekey };
        }
        return { citation: `[[@${citekey}]]`, citekey };
    }

    /** `[^citekey]` reference + footnote definition. */
    private async footnote(
        input: CitationTemplateInput,
        notePath: string,
    ): Promise<CitationResult> {
        const citekey = input.item.citationKey || input.item.key;
        const citation = `[^${citekey}]`;
        const footnoteDef = await this.footnoteDef(input, notePath);
        return { citation, citekey, footnoteDef };
    }

    /** Render the footnote definition text via the template service. */
    private async footnoteDef(
        input: CitationTemplateInput,
        notePath: string,
    ): Promise<string | undefined> {
        const rendered =
            await workerBridge.libraryTemplate.renderCitationTemplate(
                input,
                notePath,
                "footnote",
            );
        if (!rendered) return undefined;
        const citekey = input.item.citationKey || input.item.key;
        return `[^${citekey}]: ${rendered}`;
    }
}
