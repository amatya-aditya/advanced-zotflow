# Advanced ZotFlow

Personal fork of [duanxianpi/obsidian-zotflow](https://github.com/duanxianpi/obsidian-zotflow), maintained for an Obsidian workflow that keeps upstream ZotFlow features while preserving additional fork-specific capabilities.

This fork is aligned with upstream ZotFlow through `1.0.11` and keeps the fork-only additions that already existed here, including:

- Companion note workflows for source notes
- Collection Base View generation
- Workflow/editor integrations already present in this fork
- Fork-specific release packaging and branding

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
