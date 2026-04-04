# Source Notes

ZotFlow generates **source notes** — structured Markdown files that capture an item's metadata and annotations. Each Zotero item gets exactly one note, which acts as a stable reference node in your knowledge graph.

---

## Philosophy

Source notes follow a **Zettelkasten-inspired** approach:

- **One note per source** — each Zotero item maps to exactly one Markdown file.
- **Locked & auto-generated** — source notes are marked `zotflow-locked` and open in reading view. They regenerate automatically when annotations change, so they always reflect the latest state of the source.
- **Link, don't edit** — write your own thoughts and interpretations in separate notes that **link back** to the source note. This keeps the boundary between "what the author said" and "what I think" clean.

---

## How Source Notes Work

### Library Source Notes

When you create or update a source note for a Zotero item:

1. The **path template** is rendered to determine where the file should live.
2. ZotFlow reads your content template (or uses the built-in default).
3. The item's metadata, child notes, attachments, and annotations are gathered from the local database.
4. The template is rendered with LiquidJS, producing the Markdown content.
5. **Frontmatter is merged**: if the file already exists, any custom frontmatter fields you added are preserved — only template-defined fields are overwritten.
6. **Mandatory fields are injected** (these always override the template):
    - `zotflow-locked: true` — marks the note as locked (opens in reading view).
    - `zotero-key` — links the note to the Zotero item.
    - `item-version` — used for update detection; the note is only regenerated when the version changes.
7. The file is written to disk.

### Local Source Notes

Same pipeline, but with different context variables and mandatory fields:

- `zotflow-locked: true`
- `zotflow-local-attachment: [[path/to/file.pdf]]`

Annotation data for local files is stored in a co-located `.zf.json` sidecar file (e.g., `Papers/paper.pdf` → `Papers/paper.zf.json`), not in the source note itself.

---

## Auto-Update Behavior

### Library Source Notes

#### Sync Updates

Source notes update automatically during sync:

1. A sync pulls updated items from Zotero.
2. For each changed item that already has a source note in the vault, a debounced re-render is scheduled (2-second delay).
3. The update is **version-aware**: if the file's `item-version` frontmatter matches the item's current version, no re-render happens.

#### Annotation Updates

When you add, edit, or delete annotations in the reader, the source note updates automatically to reflect those changes. This happens on a debounced schedule (2-second delay) to avoid excessive writes while you're actively annotating. This update is forced regardless of version.

### Local Source Notes

Local source notes update automatically when you add, edit, or delete annotations in the reader. Updates are debounced (2-second delay) to avoid excessive writes while you're actively annotating.

---

## What's Next?

- **[Citation Guide](citation-guide.md)** — Insert citations in various formats and with annotation context.
- **[Template Guide](template-guide.md)** — Full template variable and filter reference.
