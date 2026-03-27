import { normalizePath, stringifyYaml, type App } from "obsidian";
import type { BaseViewItemMetadata } from "worker/worker";

/**
 * Options for generating a `.base` file for a Zotero collection or library.
 */
export interface BaseGeneratorOptions {
    /** Display name for the collection/library (used in the base file name). */
    name: string;
    /** Folder where the `.base` file will be created. */
    baseViewFolder: string;
    /** Array of Zotero item metadata to materialise as vault notes. */
    items: BaseViewItemMetadata[];
}

/**
 * Sanitize a string for use as a file name.
 */
function sanitizeFileName(name: string): string {
    return name
        .replace(/[\/?<>\\:*|"]/g, "")
        .replace(/[\x00-\x1f\x80-\x9f]/g, "")
        .replace(/^\.+$/, "")
        .trim();
}

/**
 * Convert a single Zotero item to frontmatter-only markdown content.
 */
function itemToMarkdown(item: BaseViewItemMetadata): string {
    const fm: Record<string, unknown> = {
        "zotero-key": item.key,
        "library-id": item.libraryID,
        title: item.title,
        citationKey: item.citationKey || undefined,
        itemType: item.itemType,
        creators: item.creators.length > 0 ? item.creators : undefined,
        date: item.date || undefined,
        year: item.date ? item.date.slice(0, 4) : undefined,
        publication:
            item.publicationTitle || item.publisher || undefined,
        doi: item.DOI || undefined,
        url: item.url || undefined,
        pages: item.pages || undefined,
        volume: item.volume || undefined,
        issue: item.issue || undefined,
        isbn: item.ISBN || undefined,
        issn: item.ISSN || undefined,
        publisher: item.publisher || undefined,
        place: item.place || undefined,
        series: item.series || undefined,
        edition: item.edition || undefined,
        abstract: item.abstractNote || undefined,
        tags: item.tags.length > 0 ? item.tags : undefined,
        dateAdded: item.dateAdded || undefined,
        dateModified: item.dateModified || undefined,
    };

    // Remove undefined keys
    for (const k of Object.keys(fm)) {
        if (fm[k] === undefined) delete fm[k];
    }

    return `---\n${stringifyYaml(fm)}---\n`;
}

/**
 * Build the YAML content for a collection/library base view.
 * Points at the item-notes subfolder where metadata files are generated.
 */
function buildBaseYaml(name: string, itemsFolder: string): string {
    const safeName = name.replace(/"/g, '\\"');

    const lines: string[] = [
        `filters:`,
        `  and:`,
        `    - file.inFolder("${itemsFolder}")`,
        `    - 'file.ext == "md"'`,
        ``,
        `formulas:`,
        `  year_display: 'if(year, year.toString(), if(date, date.toString().slice(0, 4), ""))'`,
        `  last_modified: 'file.mtime.relative()'`,
        `  creator_display: 'if(creators, creators.join(", "), "")'`,
        ``,
        `properties:`,
        `  file.name:`,
        `    displayName: "Title"`,
        `  formula.creator_display:`,
        `    displayName: "Creator"`,
        `  formula.year_display:`,
        `    displayName: "Year"`,
        `  itemType:`,
        `    displayName: "Item Type"`,
        `  publication:`,
        `    displayName: "Publication"`,
        `  doi:`,
        `    displayName: "DOI"`,
        `  pages:`,
        `    displayName: "Pages"`,
        `  volume:`,
        `    displayName: "Volume"`,
        `  issue:`,
        `    displayName: "Issue"`,
        `  publisher:`,
        `    displayName: "Publisher"`,
        `  place:`,
        `    displayName: "Place"`,
        `  isbn:`,
        `    displayName: "ISBN"`,
        `  issn:`,
        `    displayName: "ISSN"`,
        `  series:`,
        `    displayName: "Series"`,
        `  edition:`,
        `    displayName: "Edition"`,
        `  url:`,
        `    displayName: "URL"`,
        `  tags:`,
        `    displayName: "Tags"`,
        `  dateAdded:`,
        `    displayName: "Date Added"`,
        `  formula.last_modified:`,
        `    displayName: "Modified"`,
        ``,
        `views:`,
        `  - type: table`,
        `    name: "${safeName} — Table"`,
        `    order:`,
        `      - file.name`,
        `      - formula.creator_display`,
        `      - formula.year_display`,
        `      - itemType`,
        `      - publication`,
        `      - tags`,
        `      - formula.last_modified`,
        ``,
        `  - type: table`,
        `    name: "${safeName} — Detailed"`,
        `    order:`,
        `      - file.name`,
        `      - formula.creator_display`,
        `      - formula.year_display`,
        `      - itemType`,
        `      - publication`,
        `      - volume`,
        `      - issue`,
        `      - pages`,
        `      - doi`,
        `      - publisher`,
        `      - tags`,
        `      - dateAdded`,
        ``,
        `  - type: cards`,
        `    name: "${safeName} — Cards"`,
        `    order:`,
        `      - file.name`,
        `      - formula.creator_display`,
        `      - formula.year_display`,
        `      - publication`,
    ];

    return lines.join("\n") + "\n";
}

/**
 * Ensure a folder exists, creating parent folders as needed.
 */
async function ensureFolder(app: App, folderPath: string): Promise<void> {
    if (app.vault.getFolderByPath(folderPath)) return;

    // Create parent folders recursively
    const parts = folderPath.split("/");
    let current = "";
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!app.vault.getFolderByPath(current)) {
            await app.vault.createFolder(current);
        }
    }
}

/**
 * Generate a `.base` file for a collection/library with item metadata files.
 *
 * 1. Creates a subfolder `<baseViewFolder>/<name>/` with one `.md` per Zotero item
 * 2. Creates the `.base` file filtering on that subfolder
 * 3. Opens the `.base` file
 *
 * Returns the created base file path.
 */
export async function generateBaseView(
    app: App,
    opts: BaseGeneratorOptions,
): Promise<string> {
    const baseFolder = normalizePath(opts.baseViewFolder);
    const collectionName = sanitizeFileName(opts.name);
    const itemsFolder = normalizePath(`${baseFolder}/${collectionName}`);
    const basePath = normalizePath(`${baseFolder}/${collectionName}.base`);

    // Ensure folders exist
    await ensureFolder(app, itemsFolder);

    // Generate item metadata files
    for (const item of opts.items) {
        const fileName = sanitizeFileName(
            `@${item.citationKey || item.title || item.key}`,
        );
        const filePath = normalizePath(`${itemsFolder}/${fileName}.md`);

        const existing = app.vault.getFileByPath(filePath);
        if (existing) {
            // Update frontmatter in-place
            await app.vault.modify(existing, itemToMarkdown(item));
        } else {
            await app.vault.create(filePath, itemToMarkdown(item));
        }
    }

    // Create or update the .base file
    const baseContent = buildBaseYaml(opts.name, itemsFolder);
    const existingBase = app.vault.getFileByPath(basePath);
    if (existingBase) {
        await app.vault.modify(existingBase, baseContent);
        await app.workspace.getLeaf(false).openFile(existingBase);
    } else {
        const file = await app.vault.create(basePath, baseContent);
        await app.workspace.getLeaf(false).openFile(file);
    }

    return basePath;
}
