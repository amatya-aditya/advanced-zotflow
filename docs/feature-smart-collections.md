# Feature: Smart Collections (Saved Searches)

## Summary

Create saved search queries that act as dynamic virtual collections, automatically including items matching specified criteria.

## Motivation

Zotero has saved searches but they don't translate to Obsidian. Researchers need dynamic collections based on criteria like "all papers from 2023 with tag 'machine-learning'" that auto-update as new items are synced.

## Proposed Design

- "Create Smart Collection" button in sidebar toolbar or via command palette
- Modal to define filter criteria: tags, year range, item type, creator, title keywords
- Smart collections stored in settings and displayed in sidebar under a "Smart Collections" section
- Items matching criteria are dynamically computed from the database
- Can be converted to a Base View for tabular exploration

## Settings

| Setting | Key | Description |
|---------|-----|-------------|
| Smart Collections | `smartCollections` | Array of saved search definitions |
