# Feature: Citation Quick Copy

## Summary

Quickly copy formatted citations from the tree view context menu in multiple citation styles (APA, MLA, Chicago, BibTeX, etc.).

## Motivation

Students and researchers constantly need to paste citations into documents, emails, and presentations. Having one-click citation copy from the Zotero sidebar eliminates context switching to Zotero.

## Proposed Design

- Right-click an item in the tree view → "Copy Citation" submenu
- Styles: APA 7th, MLA 9th, Chicago, Harvard, IEEE, BibTeX, CSL-JSON
- Uses Zotero item metadata (creators, date, title, journal, DOI, etc.)
- Keyboard shortcut support for default citation style
- Settings to configure default style and available styles

## Settings

| Setting | Key | Description |
|---------|-----|-------------|
| Default Citation Style | `defaultCitationStyle` | Style used for quick copy (Ctrl+Shift+C) |
| Enabled Styles | `enabledCitationStyles` | Which styles appear in the context menu |
