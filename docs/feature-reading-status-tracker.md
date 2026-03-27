# Feature: Reading Status Tracker

## Summary

Track reading progress of papers/books with status labels (Unread, Reading, Completed, On Hold) directly in source note frontmatter, visible in tree view and base views.

## Motivation

Researchers juggle dozens of papers simultaneously. A reading status system helps prioritize what to read next and track what has been completed, similar to Zotero's "read/unread" but more granular.

## Proposed Design

- Add a `reading-status` frontmatter property to source note templates
- Statuses: `unread`, `reading`, `completed`, `on-hold`, `skimmed`
- Right-click items in tree view to change status
- Status shown as colored dot/icon in tree view nodes
- Base views can filter/group by reading status

## Settings

| Setting | Key | Description |
|---------|-----|-------------|
| Enable Reading Status | `enableReadingStatus` | Toggle the feature on/off |
| Default Status | `defaultReadingStatus` | Status assigned to new source notes |
