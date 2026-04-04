# Reading & Annotating

ZotFlow includes a built-in reader for PDFs, EPUBs, and HTML snapshots — powered by the same rendering engine as Zotero's own reader. You can read and annotate documents without ever leaving Obsidian.

---

## Opening a Zotero Attachment

### From the Tree View

1. Open the **Zotero Tree View** (command palette → `ZotFlow: Open Zotero Tree View`).
2. Expand a library → collection → item.
3. **Double-click** an attachment (PDF, EPUB, or HTML) to open it in the reader.

If you double-click an attachment that's already open in another tab, ZotFlow activates the existing tab instead of opening a duplicate.

### From Search Modal

1. Click the left-side ribbon icon or open the command palette and run `ZotFlow: Search Zotero Library`.
2. Type to search for items in your library.
3. Use the arrow keys to navigate results.
4. Press **Enter** on an attachment result to open it in the reader.

### Via Protocol URI

You can open attachments or source notes programmatically using:

```
obsidian://zotflow?type=open-attachment&libraryID=<id>&key=<key>
obsidian://zotflow?type=open-note&libraryID=<id>&key=<key>
```

Add `&navigation=<json>` to jump to a specific page or annotation.

---

## Local Reader for Vault Files

If you enable the **Overwrite PDF/EPUB/HTML Viewer** setting, any PDF/EPUB/HTML file in your vault will open in ZotFlow's reader instead of Obsidian's default viewer. This allows you to annotate files that aren't in Zotero and have those annotations saved in a sidecar JSON file.

## Annotation Types

The reader supports several annotation types:

| Type          | Description                                                  |
| ------------- | ------------------------------------------------------------ |
| **Highlight** | Select text and apply a colored highlight.                   |
| **Underline** | Select text and apply a colored underline.                   |
| **Note**      | Place a sticky note on a specific location on the page.      |
| **Image**     | Draw a rectangular selection to capture an area as an image. |
| **Ink**       | Freehand drawing on the page.                                |
| **Eraser**    | Erase parts of an ink annotation.                            |

Each annotation can have:

- A **color** (from the reader's color palette)
- An optional **comment** (your thoughts about the highlighted passage)
- **Tags** (carried over from Zotero)

---

## Zotero Library vs. Local Attachments

ZotFlow has **two reader modes**:

### Library Reader (Zotero Attachments)

- Opens attachments synced from your Zotero library.
- Annotations sync back to Zotero on the next bidirectional sync.

### Local Reader (Vault Files)

- Opens PDF/EPUB/HTML files that live directly in your vault (not from Zotero).
- Annotations are stored in a co-located sidecar file (`.zf.json`) next to the original attachment — not sent to Zotero.
- Enable in **Settings → ZotFlow → General → Overwrite PDF/EPUB/HTML Viewer** to replace Obsidian's default file viewer.
- After enabling, any PDF/EPUB/HTML file in your vault opens in the ZotFlow reader automatically. **Requires an Obsidian restart.**

---

## Annotation Images

For **image** and **ink** annotations, ZotFlow can automatically extract the visual content and save it as a PNG file in your vault.

### Setup

1. Go to **Settings → ZotFlow → General**.
2. Enable **Auto Import Annotation Images**.
3. Set an **Annotation Image Folder** (e.g., `Attachments/ZotFlow`).

### How It Works

- When a source note is created or updated, image/ink annotations are extracted from the PDF and saved as `<annotation-key>.png` in the configured folder.
- The source note embeds them with:

```markdown
> > ![[Attachments/ZotFlow/ANNOTATION_KEY.png]]
```

- You can also trigger extraction manually via the Tree View: right-click an item → **Extract annotation images**.

---

## Drag & Drop from Tree View

You can **drag** items and attachments from the Tree View into any note:

| Dragged Item     | Inserted Content                                                           |
| ---------------- | -------------------------------------------------------------------------- |
| **Attachment**   | A markdown link: `[filename](obsidian://zotflow?type=open-attachment&...)` |
| **Regular item** | A citation (format depends on your citation settings)                      |

Dragging a regular item also triggers creation or update of its source note to ensure it exists and is current.

---

## Context Menu in Tree View

Right-click items in the Tree View for additional actions:

| Target                                 | Action                                  | Description                                                      |
| -------------------------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| **Collection or Library**              | Create source note for all child items  | Batch-creates source notes for every item under this node.       |
| **Collection or Library**              | Extract anno images for all child items | Batch-extracts annotation images for every item under this node. |
| **Top-level item** (not an attachment) | Open source note                        | Opens (and force-updates) the source note for this item.         |
| **Top-level item** (not an attachment) | Extract annotation images               | Extracts annotation images for this specific item.               |

---

## What's Next?

- **[Source Notes](source-notes.md)** — Learn how generated notes work and how to customize them.
- **[Citation Guide](citation-guide.md)** — Insert citations in various formats and with annotation context.
