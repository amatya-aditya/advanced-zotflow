# Feature: Literature Review Matrix

## Summary

Generate a comparison matrix note from a collection where rows are papers and columns are user-defined comparison dimensions (methodology, findings, limitations, etc.).

## Motivation

Literature review matrices are a standard academic tool for systematically comparing papers across dimensions. Automating the scaffold from a Zotero collection saves significant manual setup time.

## Proposed Design

- Right-click a collection → "Create Literature Review Matrix"
- Modal to define comparison columns (e.g., "Research Question", "Methodology", "Key Findings", "Limitations", "Relevance")
- Generates a markdown table or Obsidian Base with:
  - One row per item in the collection
  - Pre-filled title, author, year columns
  - Empty cells for user-defined dimensions
- Output as either a markdown note with table or a `.base` file
- Template system for reusable matrix configurations

## Settings

| Setting | Key | Description |
|---------|-----|-------------|
| Matrix Template | `matrixTemplate` | Default column configuration for new matrices |
| Matrix Output Format | `matrixOutputFormat` | `markdown` or `base` |
