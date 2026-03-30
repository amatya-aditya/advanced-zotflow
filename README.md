# Advanced ZotFlow — Keep Your Research in Flow

> **Note:** This is a personal fork of [ZotFlow](https://github.com/duanxianpi/obsidian-zotflow) by Xianpi Duan, maintained by [Aditya Amatya](https://github.com/amatya-aditya) for personal use. It includes custom modifications and features not present in the upstream project. For the original plugin, please visit the [upstream repository](https://github.com/duanxianpi/obsidian-zotflow).

ZotFlow is a community plugin for [Obsidian](https://obsidian.md) that deeply integrates [Zotero](https://www.zotero.org) into your note-taking workflow. It syncs your Zotero libraries, lets you read and annotate PDFs/EPUBs/snapshots directly inside Obsidian, and automatically generates richly-templated source notes — all without leaving your vault.

## Features Added in This Fork

### v0.5.2

- **User content zone in source notes** — generated Zotero and local source notes now end with `%% ZOTFLOW_USER_START %%`. Anything you write below that marker is preserved across syncs and note regeneration.
- **Toggle Source Note Lock** — source notes can still be protected with `zotflow-locked`, but you now get a command to flip the lock on the active source note when you need to edit the generated body.
- **Create Companion Note** — create chapter-wise or topic-wise notes linked to a source note via `zotflow-companion-of`. The action is available from the command palette, the source note file menu, and Zotero tree item context menus.
- **Improved annotation drag-and-drop** — dragging annotations into notes now emits full callout blocks that match the source-note template format. Unsaved text selections fall back to plain text instead of broken `#^undefined` embeds.

### v0.5.1

- **Collection Base Views** — right-click a collection or library in the sidebar and select "Create Base View" to generate a table-like Obsidian Bases view with all Zotero item metadata rendered as Table, Detailed, and Cards views.
- **Bases toolbar button** — browse created Base views directly from the sidebar toolbar.
- **Expanded default source note template** — the default template now includes more Zotero metadata fields such as pages, volume, issue, ISBN, ISSN, publisher, place, series, edition, abstract, and tags.
- **Base view folder setting** — configure where Base files are stored.

### v0.5.0

- **Sidebar toolbar redesign** — inline icon toolbar with Library, Recent, Bookmarks, Search, Sort, and Refresh buttons.
- **Bookmarks** — toggle bookmarks on items via right-click context menus, with a dedicated Bookmarks view and sort/filter support.
- **Recently opened items** — automatically tracked with a dedicated Recent view.
- **Reader hotkey forwarding** — `Ctrl+P` in the reader iframe opens the Obsidian command palette instead of the print dialog.
- **Obsidian theme support in reader** — the reader's "Obsidian" theme option now follows your vault theme.
- **Tree state persistence** — sidebar open/closed state is preserved across focus changes.
- **`truncate_words` Liquid filter** — shorten long attachment filenames in custom templates.

