# Feature: Collection Base View

## Summary

Create Obsidian Base (`.base`) table views for Zotero collections, providing a Zotero-like spreadsheet experience for browsing and filtering library items directly in Obsidian.

## Motivation

Academic researchers and students frequently need to browse their Zotero libraries in a tabular format — sorting by year, filtering by author, scanning titles — similar to Zotero's native item list. Obsidian Bases provide exactly this capability with filterable, sortable table views over markdown notes.

## User Flow

1. **Right-click a collection or library** in the ZotFlow sidebar tree
2. Select **"Create Base View"** from the context menu
3. A `.base` file is generated in the configured folder (settings) with columns matching Zotero item metadata
4. The base file opens automatically in Obsidian

## Base File Structure

Each generated `.base` file is a YAML file that:
- Filters to the source notes folder for that collection/library
- Displays columns: Title, Creator, Year, Item Type, Date Added, Date Modified, Tags
- Includes formula columns for computed fields (e.g., formatted dates)
- Supports table and cards view types

## Settings

| Setting | Key | Default | Description |
|---------|-----|---------|-------------|
| Base View Folder | `baseViewFolder` | `ZotFlow/Bases` | Vault folder where generated `.base` files are stored |

## Sidebar Integration

- A new **"Bases"** toolbar button (table icon) is added to the ZotFlow sidebar
- Clicking it shows a list of all `.base` files in the configured folder
- Clicking a base file opens it in Obsidian
- Right-click on a base offers "Delete base" and "Open in new tab"

## Generated Base Template

```yaml
filters:
  and:
    - file.inFolder("{{sourceNoteFolder}}")
    - file.hasTag("zotero")

formulas:
  year: 'if(date, date.toString().slice(0, 4), "")'

properties:
  file.name:
    displayName: "Title"
  authors:
    displayName: "Creator"
  date:
    displayName: "Year"
  itemType:
    displayName: "Type"
  file.mtime:
    displayName: "Modified"

views:
  - type: table
    name: "Items"
    order:
      - file.name
      - authors
      - date
      - itemType
      - tags
      - file.mtime
```

## Implementation Files

- `src/settings/types.ts` — Add `baseViewFolder` setting
- `src/settings/sections/general-section.ts` — Add setting UI
- `src/utils/base-generator.ts` — Base file YAML generation
- `src/ui/tree-view/Node.tsx` — Context menu entry
- `src/ui/tree-view/TreeView.tsx` — Bases sidebar view mode + toolbar button
