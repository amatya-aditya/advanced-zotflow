# Citation Guide

ZotFlow lets you insert formatted citations into your notes — by dragging items from the tree view, copying from the reader, or typing a trigger string. Citations are rendered using customizable LiquidJS templates (see the [Template Guide](template-guide.md#citation-templates) for template variables and customization).

---

## Table of Contents

- [Citation Formats](#citation-formats)
- [Inserting Citations](#inserting-citations)
    - [Drag & Drop from Tree View](#drag--drop-from-tree-view)
    - [Citation Suggest (Trigger String)](#citation-suggest-trigger-string)
    - [Copy from Reader](#copy-from-reader)
    - [Reader Context Menu](#reader-context-menu)
- [Modifier Keys](#modifier-keys)
- [Annotations in Citations](#annotations-in-citations)
- [Local Files vs Library Items](#local-files-vs-library-items)
- [Settings](#settings)

---

## Citation Formats

ZotFlow supports four citation formats. Each is rendered through a LiquidJS template you can customize in settings.

| Format       | Example Output                        | Description                                                                                                      |
| ------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Pandoc**   | `[@smith2024, pp. 3, 7]`              | Pandoc-style citation key in brackets. Annotation pages are appended automatically.                              |
| **Footnote** | `[^smith2024]` + definition           | Markdown footnote reference. A footnote definition is inserted at the end of the document.                       |
| **Wikilink** | `[[Source/@smith2024\|Smith (2024)]]` | Obsidian wikilink to the source note with a display name. With annotations, links to specific annotation blocks. |
| **Citekey**  | `@smith2024`                          | Raw citation key — no template processing.                                                                       |

If a citation key (e.g., from Better BibTeX) is not set, the Zotero item key is used as a fallback.

---

## Inserting Citations

### Drag & Drop from Tree View

1. Open the **Zotero Tree View** sidebar.
2. Drag any non-note item (article, book, etc.) into an open editor.
3. ZotFlow inserts a citation at the drop position using your default format.

Hold a modifier key while dropping to choose a specific format (see [Modifier Keys](#modifier-keys) below).

> **Tip:** Dragging an **attachment** (PDF, EPUB) inserts an open-attachment link instead of a citation.

### Citation Suggest (Trigger String)

1. Type the trigger string (default: `@@`) in any editor.
2. A search popup appears — type to filter your Zotero library.
3. Select an item and press **Enter** to insert a citation.

The trigger string is configurable in **Settings → Citation → Trigger Character**.

### Copy from Reader

When viewing a Zotero attachment in the built-in reader:

| Shortcut                                                       | Action                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| **Ctrl+C** (or **Cmd+C**) with annotation selected             | Copies a citation in your default format to the clipboard. |
| **Ctrl+Shift+C** (or **Cmd+Shift+C**) with annotation selected | Copies the raw annotation text to the clipboard.           |

Paste the result into any editor or external application.

### Reader Context Menu

Right-click a selected annotation in the reader to see citation options:

- **Copy Embed** — `![[Source/@smith2024#^annotationId]]` (block embed link to the annotation in the source note)
- **Copy Annotation Text** — raw highlighted text
- **Copy Default Citation** — uses your default citation format
- **Copy Pandoc Citation**
- **Copy Footnote Citation**
- **Copy Wikilink Citation**

---

## Modifier Keys

When dragging from the tree view (or dropping), hold a modifier key to override the default citation format:

| Modifier                       | Format                         |
| ------------------------------ | ------------------------------ |
| _(none)_                       | Default format (from settings) |
| **Shift**                      | Wikilink                       |
| **Alt**                        | Pandoc                         |
| **Ctrl** / **Cmd**             | Footnote                       |
| **Ctrl+Shift** / **Cmd+Shift** | Citekey (raw)                  |

---

## Annotations in Citations

When you copy a citation from the reader with annotations selected, the annotation context is included in the citation template. This allows templates to reference annotation data — for example, appending page numbers or linking to specific annotation blocks.

### Multiple Annotations

If multiple annotations are selected when copying, all of them are available to the template as an `annotations` array. The default templates handle this automatically:

- **Pandoc** default: aggregates unique page numbers → `[@smith2024, pp. 3, 7, 12]`
- **Wikilink** default: creates individual `[[note#^id|Author (year), p. X]]` links for each annotation, comma-separated
- **Footnote** default: footnote definitions don't use annotation data (but you can customize this)

### Embed Format

The **embed** format creates Obsidian block-embed links pointing to each annotation's block ID in the source note:

```
![[Source/@smith2024#^annotationKey]]
```

When multiple annotations are selected, each gets its own embed on a separate line.

> **Note:** Embeds require that the source note exists and contains the annotation block IDs (e.g., `^annotationKey`). ZotFlow's default templates include these automatically.

---

## Local Files vs Library Items

Citation behavior differs between **Zotero library items** (synced from the cloud) and **local vault files** (opened in the local reader).

| Action                   | Library File                                                   | Local File                       |
| ------------------------ | -------------------------------------------------------------- | -------------------------------- |
| **Ctrl+C** on annotation | Citation in default format                                     | Embed link (`![[path#^id]]`)     |
| **Ctrl+Shift+C**         | Annotation text                                                | Annotation text                  |
| **Context menu options** | All formats (embed, text, pandoc, footnote, wikilink, default) | Embed + text only                |
| **Drag from tree**       | Citation (various formats)                                     | N/A (local files aren't in tree) |

Local files don't have Zotero metadata (citation keys, creators, etc.), so citation templates that depend on item data are not available. Instead, Ctrl+C copies an embed link to the annotation in the local source note.

---

## Settings

Configure citations in **Settings → Citation**:

| Setting                          | Description                                  | Default               |
| -------------------------------- | -------------------------------------------- | --------------------- |
| **Default Citation Format**      | Format used when no modifier key is held     | `footnote`            |
| **Trigger Character**            | String that opens the citation suggest popup | `@@`                  |
| **Pandoc Template**              | LiquidJS template for pandoc citations       | _(built-in fallback)_ |
| **Footnote Reference Template**  | Template for the inline `[^key]` marker      | _(built-in fallback)_ |
| **Footnote Definition Template** | Template for the footnote definition text    | _(built-in fallback)_ |
| **Wikilink Template**            | Template for wikilink citations              | _(built-in fallback)_ |

Leave any template field empty to use the built-in default. See the [Template Guide](template-guide.md#citation-templates) for the full variable reference and default template code.
