# Feature: Annotation Summary View

## Summary

A dedicated sidebar view that aggregates all highlights and annotations across papers, with filtering by color, tag, and date.

## Motivation

During literature reviews, researchers need to cross-reference annotations across multiple papers. An aggregated annotation view makes it easy to find related highlights without opening each paper individually.

## Proposed Design

- New "Annotations" tab in ZotFlow sidebar toolbar
- Lists all annotations grouped by paper or by color
- Filter by: annotation color, date range, search text
- Click an annotation to jump to the source in the reader
- Drag annotation text into notes for quick quoting
- Export filtered annotations to a new note

## Settings

| Setting | Key | Description |
|---------|-----|-------------|
| Annotation Grouping | `annotationGroupBy` | Group by: paper, color, date, or tag |
| Show Annotation Colors | `showAnnotationColors` | Display color indicators in the list |
