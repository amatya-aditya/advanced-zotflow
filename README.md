# Advanced ZotFlow

Personal fork of [duanxianpi/obsidian-zotflow](https://github.com/duanxianpi/obsidian-zotflow), maintained for an Obsidian workflow that keeps upstream ZotFlow features while preserving additional fork-specific capabilities.

This fork is aligned with upstream ZotFlow through `1.6.4` and keeps the fork-only additions that already existed here, including:

- Companion note workflows for source notes
- Collection Base View generation
- Workflow/editor integrations already present in this fork
- Fork-specific release packaging and branding

Requires **Obsidian 1.13.4 or newer**. Reader startup is independent of the host MathJax implementation, including the changes in Obsidian 1.14.

Right-click a PDF attachment (including one nested beneath a reference) to bookmark it. Opened Zotero attachments appear in Recents. The reader pane menu also offers an attachment bookmark action. Use **Settings > Advanced ZotFlow > General > Tree View** to hide individual mode buttons or item icons.

See [integration and validation notes](docs/upstream-1.6.4-integration.md).

## Core Features

- Sync Zotero libraries into Obsidian
- Read and annotate PDFs, EPUBs, and snapshots inside Obsidian
- Generate and update template-driven source notes
- Create and edit Zotero child notes
- Insert citations from the tree view, editor suggest, or reader
- Open local vault attachments with ZotFlow sidecar annotations
- Use per-library permissions, read-only handling, and repair tooling

## Docs

See [docs/README.md](docs/README.md) for the full documentation set.

Key guides:

- [Getting Started](docs/getting-started.md)
- [Reading & Annotating](docs/reading-and-annotating.md)
- [Source Notes](docs/source-notes.md)
- [Item Notes](docs/item-notes.md)
- [Citation Guide](docs/citation-guide.md)
- [Template Guide](docs/template-guide.md)

## Development

```bash
npm install
npm run build:ci
```

The plugin build depends on the `reader/reader` submodule as well as the main plugin source.
