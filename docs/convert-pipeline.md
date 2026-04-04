# HTML ↔ Markdown Conversion Pipeline

> Internal developer documentation for the bidirectional Zotero Note HTML ↔
> Obsidian Markdown conversion system.

---

## Overview

ZotFlow converts between Zotero's ProseMirror-based HTML note format and
Obsidian-flavoured Markdown. The conversion is **bidirectional and
round-trip safe** — converting HTML → MD → HTML produces output semantically
identical to the original.

Both directions run entirely in the **Web Worker** thread (no DOM dependency).
They use the [unified](https://unifiedjs.com/) ecosystem to parse, transform,
and serialize between AST representations.

All conversion is accessed through the **`ConvertService`** singleton
(`src/worker/services/convert.ts`), which owns the frozen (reusable) unified
processor instances and is injected into consumer services via constructor DI.
The underlying pipeline functions in `worker/convert/` accept processors as
parameters and are not called directly by application code.

```
┌─────────────────────────────────────────────────────────────────┐
│                     html2md  (HTML → MD)                        │
│                                                                 │
│  HTML string                                                    │
│    │                                                            │
│    ├── Phase 1: rehype-parse  →  hast (HTML AST)                │
│    │     └── Pre-clean: unwrap wrapper, normalize <br>,         │
│    │         wrap orphan inlines, strip empty <p>                │
│    │                                                            │
│    ├── Phase 2: rehype-remark (hast → mdast) with custom        │
│    │            schema-driven handlers                          │
│    │                                                            │
│    ├── Phase 3: remark-stringify (mdast → MD string)            │
│    │     └── Custom handlers for math, tables, u/sub/sup, code  │
│    │                                                            │
│    └── Post: prepend wrapper metadata comment                   │
│                                                                 │
│  Markdown string                                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     md2html  (MD → HTML)                        │
│                                                                 │
│  Markdown string                                                │
│    │                                                            │
│    ├── Pre-process: restore annotated images, Obsidian embeds,  │
│    │                extract wrapper meta comment                 │
│    │                                                            │
│    ├── Phase 1: remark-parse  →  mdast (Markdown AST)           │
│    │     └── Optional: soft breaks → hard breaks (non-strict)   │
│    │                                                            │
│    ├── Phase 2: remark-rehype (mdast → hast)                    │
│    │                                                            │
│    ├── Phase 3: rehype2note transforms (hast → Zotero hast)     │
│    │     └── Restore Zotero-specific elements (math, strike,    │
│    │         code, list spans, etc.)                             │
│    │                                                            │
│    ├── Phase 4: rehype-stringify (hast → HTML string)           │
│    │                                                            │
│    └── Post: re-wrap in <div data-schema-version> if present    │
│                                                                 │
│  HTML string                                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Source files

| File                                       | Purpose                                            |
| ------------------------------------------ | -------------------------------------------------- |
| `src/worker/services/convert.ts`           | **ConvertService** — singleton owning processors   |
| `src/worker/convert/html-to-md.ts`         | HTML → Markdown pipeline (`html2mdWithProcessors`) |
| `src/worker/convert/md-to-html.ts`         | Markdown → HTML pipeline (`md2htmlWithProcessors`) |
| `src/worker/convert/annotation-comment.ts` | Annotation comment HTML ↔ MD (regex-based)         |
| `src/worker/convert/index.ts`              | Barrel re-exports (types + internals)              |

### Key dependencies

| Package                                         | Role                                   |
| ----------------------------------------------- | -------------------------------------- |
| `rehype-parse`                                  | HTML string → hast                     |
| `rehype-remark`                                 | hast → mdast (with custom handlers)    |
| `remark-stringify`                              | mdast → MD string                      |
| `remark-parse`                                  | MD string → mdast                      |
| `remark-rehype`                                 | mdast → hast                           |
| `rehype-stringify`                              | hast → HTML string                     |
| `remark-gfm`                                    | GFM: tables, strikethrough, autolinks  |
| `remark-math`                                   | Math: `$inline$` and `$$display$$`     |
| `hast-util-to-html`                             | Serialize hast fragments (passthrough) |
| `hast-util-to-text`                             | Extract text content from hast         |
| `hast-util-to-mdast`                            | Default hast→mdast handlers            |
| `mdast-util-to-markdown`                        | Serialize mdast fragments (tables)     |
| `mdast-util-gfm-table`                          | GFM table serialization extension      |
| `mdast-util-gfm-strikethrough`                  | GFM strikethrough serialization        |
| `unist-util-visit` / `unist-util-visit-parents` | AST traversal                          |
| `hastscript` (`h`)                              | Construct hast nodes                   |

---

## ConvertService

The `ConvertService` class (`src/worker/services/convert.ts`) is a singleton
instantiated once in `worker.ts:init()` and injected into:

- `LibraryTemplateService` — uses `html2md()` (LiquidJS filter) and `annoHtml2md()`
- `LibraryNoteService` — uses `md2html()` (saving edits back to Zotero)
- `AnnotationService` — uses `annoMd2html()` (annotation comment editing)

### Frozen processors

The constructor creates five frozen unified processor instances that are
reused across all calls (avoiding re-instantiation overhead):

| Processor           | Plugins                                            | Used by   |
| ------------------- | -------------------------------------------------- | --------- |
| `rehypeParser`      | `rehype-parse` (fragment mode)                     | `html2md` |
| `remarkStringifier` | `remark-gfm`, `remark-math`                        | `html2md` |
| `remarkParser`      | `remark-gfm`, `remark-math`, `remark-parse`        | `md2html` |
| `remark2rehypeProc` | `remark-rehype` (allowDangerousHtml)               | `md2html` |
| `rehypeStringifier` | `rehype-stringify` (allowDangerousCharacters/Html) | `md2html` |

### Public API

```ts
class ConvertService {
    async html2md(html: string, options?: Html2MdOptions): Promise<string>;
    async md2html(md: string, options?: ConvertOptions): Promise<string>;
    annoHtml2md(html: string): string;
    annoMd2html(md: string): string;
}
```

---

## HTML → Markdown (`html2md`)

### Signature

```ts
// ConvertService delegates to:
export async function html2mdWithProcessors(
    html: string,
    rehypeParser: AnyProcessor,
    remarkStringifier: AnyProcessor,
    options?: Html2MdOptions,
): Promise<string>;

export interface Html2MdOptions {
    /** Vault-relative folder for annotation images (e.g. "ZotFlow/images"). */
    annotationImageFolder?: string;
}
```

### Phase 1 — Parse & Pre-clean (`parseNoteHtml`)

Parses the HTML string into a hast tree using `rehype-parse` in fragment mode,
then applies four ordered pre-cleaning steps:

#### 1. Extract wrapper `<div>`

Zotero notes are wrapped in a `<div data-schema-version="..." data-citation-items="...">`.
This wrapper carries metadata essential for Zotero but has no Markdown equivalent.

- The wrapper's attributes are serialized into a string (e.g.
  `data-citation-items="..." data-schema-version="5"`).
- The wrapper's children are spliced into the root, replacing the `<div>`.
- The attribute string is returned separately so it can be embedded as an HTML
  comment in the Markdown output.

#### 2. Normalize `<br>` whitespace

Strips blank text nodes immediately before and after `<br>` elements.
This prevents rehype-remark from generating phantom whitespace around
hard breaks.

#### 3. Wrap orphan inlines

Orphan `<span>` and `<img>` elements at the root level (not inside a `<p>`)
are wrapped in `<p>` tags. This ensures they are treated as block-level
content during conversion.

#### 4. Remove empty `<p>`

Empty `<p>` elements at the root are stripped to avoid generating blank
lines in the Markdown output.

### Phase 2 — hast → mdast (Schema-Driven Handlers)

Uses `rehype-remark` with a registry of custom handlers built by
`buildRehype2RemarkHandlers()`. Each handler is derived from the
**Zotero ProseMirror note-editor schema v10**.

Every element falls into one of three strategies:

| Strategy        | Description                                                | Example                                     |
| --------------- | ---------------------------------------------------------- | ------------------------------------------- |
| **Convert**     | Maps to a standard mdast node (native Markdown syntax)     | `<em>` → `*italic*`                         |
| **Passthrough** | Serialized to raw HTML and emitted as an `html` mdast node | `<span class="citation">` → raw HTML string |
| **Default**     | Delegates to `rehype-remark`'s built-in handler            | `<p>`, `<h1>`-`<h6>`, `<a>`, `<strong>`     |

#### Block node handlers

| Element              | Condition                     | Strategy    | Output                                          |
| -------------------- | ----------------------------- | ----------- | ----------------------------------------------- |
| `<pre class="math">` | Has `math` class              | Convert     | `math` node (display math `$$...$$`)            |
| `<pre>`              | No math class                 | Default     | Code block (fenced)                             |
| `<table>`            | Has inline styles on cells    | Passthrough | Raw HTML table                                  |
| `<table>`            | No styles                     | Default     | GFM table (with header-placeholder logic)       |
| `<li>`               | Mixed inline + block children | Convert     | Merged paragraph (prevents orphaned inlineMath) |
| `<li>`               | Normal                        | Default     | Standard list item                              |

**Table header placeholders:** Zotero tables may lack `<thead>`. When
converting a headerless table, the handler marks the mdast node with
`data.bnRemove = true`. During Phase 3 serialization, the first row's cells
are filled with `<!-- -->` placeholder comments so GFM table syntax remains
valid.

#### Inline node handlers — `<span>` dispatch

The `<span>` handler is the most complex, dispatching by class/style:

| Condition                               | Strategy    | mdast type                                                    |
| --------------------------------------- | ----------- | ------------------------------------------------------------- |
| `class="math"`                          | Convert     | `inlineMath` → `$x$`                                          |
| `class="citation"`                      | Passthrough | `html` (raw `<span class="citation" data-citation="...">`)    |
| `class="highlight"`                     | Passthrough | `html` (raw `<span class="highlight" data-annotation="...">`) |
| `class="underline"` + `data-annotation` | Passthrough | `html` (raw annotation span)                                  |
| `style="text-decoration: line-through"` | Convert     | `delete` → `~~text~~`                                         |
| `style="background-color: ..."`         | Passthrough | `html` (colored background)                                   |
| `style="color: ..."`                    | Passthrough | `html` (text color)                                           |
| _(other)_                               | Convert     | `paragraph` (unwrap children)                                 |

#### Inline node handlers — `<img>`

| Condition                                                      | Strategy    | Output                              |
| -------------------------------------------------------------- | ----------- | ----------------------------------- |
| Has `data-attachment-key` + `annotationImageFolder` configured | Convert     | `![<img ...> \| W](folder/KEY.png)` |
| Has `data-attachment-key` but no folder                        | Passthrough | Raw `<img>` HTML                    |
| Plain image                                                    | Default     | `![alt](src)`                       |

**Annotated image format:** When an `<img>` carries Zotero annotation
data (`data-attachment-key`, `data-annotation`, `width`, `height`),
it's converted to a Markdown image where:

- The **alt text** contains the full serialized `<img>` tag (preserving all
  data-\* attributes for round-trip fidelity).
- A **width suffix** `| WIDTH` is appended after the alt text inside the
  brackets (Obsidian image resize syntax).
- The **URL** points to the extracted image file:
  `{annotationImageFolder}/{attachmentKey}.png`.

```
![<img alt="" width="663" height="282" data-attachment-key="KEY" data-annotation="..."> | 663](ZotFlow/images/KEY.png)
```

This embeds in Obsidian as a rendered image at the correct width, while the
raw `<img>` tag in the alt text survives round-tripping back to HTML.

#### Inline node handlers — marks & misc

| Element | Strategy                    | Output                                   |
| ------- | --------------------------- | ---------------------------------------- |
| `<u>`   | Convert → custom `u` node   | `<u>text</u>` (HTML in MD)               |
| `<sub>` | Convert → custom `sub` node | `<sub>text</sub>`                        |
| `<sup>` | Convert → custom `sup` node | `<sup>text</sup>`                        |
| `<br>`  | Passthrough                 | `<br>` (raw HTML, **not** `\` + newline) |

**Why `<br>` is passthrough:** The default rehype-remark handler converts
`<br>` to a backslash + newline (`\↵`). This breaks round-tripping when
`<br>` appears between passthrough HTML elements (e.g. annotated images
followed by citations). Using raw `<br>` HTML avoids this.

### Phase 3 — mdast → Markdown string (`remarkToMarkdown`)

Uses `remark-stringify` with:

- **GFM extension** (`remark-gfm`) for tables and strikethrough.
- **Math extension** (`remark-math`) for `$...$` and `$$...$$`.
- **Custom handlers** (`mdastStringifyHandlers`) for nodes without native
  Markdown syntax:

| Node type    | Output                                                          |
| ------------ | --------------------------------------------------------------- |
| `u`          | `<u>text</u>`                                                   |
| `sub`        | `<sub>text</sub>`                                               |
| `sup`        | `<sup>text</sup>`                                               |
| `inlineMath` | `$value$`                                                       |
| `math`       | `$$\nvalue\n$$`                                                 |
| `code`       | ` ```\nvalue\n``` `                                             |
| `table`      | GFM table (with `<!-- -->` header placeholders when headerless) |

### Post-processing — Wrapper metadata comment

If the original HTML had a wrapper `<div data-schema-version>`, its attributes
are prepended as an HTML comment:

```markdown
<!-- ZF_NOTE_META data-citation-items="..." data-schema-version="5" -->

# Note title

Content...
```

This is a ZotFlow-internal marker:

- `md2html` reads it to restore the wrapper `<div>`.
- The CM6 meta extension collapses and protects it in Obsidian's Source Mode.
- It supports three legacy formats for backward compatibility.

---

## Markdown → HTML (`md2html`)

### Signature

```ts
// ConvertService delegates to:
export async function md2htmlWithProcessors(
    md: string,
    remarkParser: AnyProcessor,
    remark2rehypeProcessor: AnyProcessor,
    rehypeStringifier: AnyProcessor,
    options?: ConvertOptions,
): Promise<string>;

export interface ConvertOptions {
    strictLineBreaks?: boolean; // default: true
}
```

### Pre-processing

Three string-level transforms run before parsing:

#### 1. Extract wrapper metadata comment

Searches for a metadata comment at the start of the Markdown:

```
<!-- ZF_NOTE_META data-citation-items="..." data-schema-version="5" -->
```

Accepts three formats (current + two legacy):

- `<!-- ZF_NOTE_META ... -->`
- `%% ZF_NOTE_META ... %%` (legacy Obsidian comment)
- `<!-- zotflow-note-meta ... -->` (legacy prefix)

The captured attribute string is saved for wrapper restoration;
the comment is stripped from the Markdown before parsing.

#### 2. Restore annotated images

Detects the annotated image format produced by `html2md`:

```
![<img alt="" data-attachment-key="KEY" ...> | 663](folder/KEY.png)
```

The regex `/!\[(<img\s[^>]*>)\s*(?:\|\s*\d+)?\]\([^)]+\)/g` extracts the
`<img>` tag from the alt text and replaces the entire Markdown image with
just the raw `<img>` tag. This restores the original Zotero image element
before remark parsing.

#### 3. Obsidian embed images

Obsidian's `![[filename.png]]` wiki-link embeds are converted to standard
Markdown images: `![](filename.png)`. URLs are encoded for safe parsing.

### Phase 1 — Parse (`md2remark`)

Parses the Markdown string into an mdast tree using `remark-parse` with
GFM and math plugins.

**Strict line breaks:** When `strictLineBreaks` is `false` (matching
Obsidian's default behaviour where "Strict line breaks" is turned off),
a post-parse pass converts soft line breaks in text nodes into hard break
nodes (`{ type: "break" }`). This ensures single `\n` in Markdown becomes
`<br>` in HTML, matching what the user sees in Obsidian.

### Phase 2 — mdast → hast (`remark2rehype`)

Standard `remark-rehype` conversion with `allowDangerousHtml: true` to
preserve raw HTML nodes that were passthrough-injected by `html2md`
(citations, annotations, colored spans, `<br>`, etc.).

### Phase 3 — Zotero-specific hast transforms (`rehype2note`)

A series of ordered in-place transforms on the hast tree to restore
Zotero's expected HTML structure. **Order matters** — some transforms
depend on prior ones.

#### Transform 1: `<del>` → `<span style="text-decoration: line-through">`

GFM `~~text~~` produces `<del>`. Zotero expects `<span>` with inline style.

#### Transform 2: Math code → Zotero math (MUST run before code flattener)

remark-math + remark-rehype produces:

- Inline: `<code class="language-math math-inline">x</code>`
- Display: `<pre><code class="language-math math-display">x</code></pre>`

These are transformed to Zotero's format:

- Inline: `<span class="math">$x$</span>`
- Display: `<pre class="math">$$x$$</pre>`

#### Transform 3: Flatten `<code>` inside `<pre>`

Standard code blocks produce `<pre><code>content</code></pre>`.
Zotero expects `<pre>content</pre>` (text directly in `<pre>`, no `<code>`
wrapper). The `<code>` child is replaced with a text node.

Trailing newlines are stripped (remark-rehype adds one that Zotero doesn't
expect).

#### Transform 4: Wrap list/table text in `<span>`

Bare text nodes inside `<li>` and `<td>` elements are wrapped in `<span>`
tags. This matches Zotero's expected structure and enables cleaner diff
comparisons during sync.

Newlines in the text values are stripped.

#### Transform 5: Remove empty text nodes in lists/tables

After span-wrapping, any remaining text-only nodes that are purely
whitespace/newlines inside `<li>` and `<td>` are removed. This prevents
phantom whitespace from appearing in the HTML output.

#### Transform 6: Restore Zotero math format (secondary pass)

Handles any remaining math nodes with `math-inline` or `math-display`
classes that weren't caught by Transform 2 (edge cases):

- Inline: wraps children in `$...$`, sets `class="math"`
- Display: wraps children in `$$...$$`, changes tag to `<pre>`, sets
  `class="math"`

#### Transform 7: Strip `rel` attribute from links

`remark-rehype` adds `rel="nofollow"` to links. Zotero doesn't use this;
it's removed for cleaner output.

#### Transform 8: Collapse consecutive empty nodes

Consecutive empty paragraphs/text nodes at the root level are deduplicated.
Markdown doesn't preserve multiple blank lines, so the round-tripped HTML
shouldn't produce extra empties.

### Phase 4 — Serialize (`rehype-stringify`)

Serializes the hast tree to an HTML string with `allowDangerousCharacters`
and `allowDangerousHtml` enabled (required for passthrough elements like
citations, annotations, and colored spans).

### Post-processing — Restore wrapper div

If a wrapper metadata string was extracted in pre-processing, the HTML
output is wrapped:

```html
<div data-citation-items="..." data-schema-version="5">
    <p>Content...</p>
</div>
```

---

## Round-Trip Fidelity

The pipeline is designed for **lossless round-tripping**: `html2md(html)` →
`md2html(md)` produces HTML semantically equivalent to the input, and
`md2html(md)` → `html2md(html)` produces Markdown identical to the input.

### Elements with perfect round-trip

| Element              | HTML                                             | Markdown                            |
| -------------------- | ------------------------------------------------ | ----------------------------------- |
| Paragraph            | `<p>text</p>`                                    | `text`                              |
| Headings             | `<h1>`-`<h6>`                                    | `#` - `######`                      |
| Bold                 | `<strong>`                                       | `**text**`                          |
| Italic               | `<em>`                                           | `*text*`                            |
| Strikethrough        | `<span style="text-decoration: line-through">`   | `~~text~~`                          |
| Inline code          | `<code>`                                         | `` `code` ``                        |
| Code block           | `<pre>code</pre>`                                | ` ```\ncode\n``` `                  |
| Link                 | `<a href="url">`                                 | `[text](url)`                       |
| Image                | `<img src="url">`                                | `![alt](url)`                       |
| Annotated image      | `<img data-attachment-key="K" ...>`              | `![<img ...> \| W](folder/K.png)`   |
| Inline math          | `<span class="math">$x$</span>`                  | `$x$`                               |
| Display math         | `<pre class="math">$$x$$</pre>`                  | `$$\nx\n$$`                         |
| Blockquote           | `<blockquote>`                                   | `> text`                            |
| Ordered list         | `<ol><li>`                                       | `1. item`                           |
| Unordered list       | `<ul><li>`                                       | `- item`                            |
| Horizontal rule      | `<hr>`                                           | `---`                               |
| GFM table            | `<table>` (no styles)                            | `\| a \| b \|`                      |
| Hard break           | `<br>`                                           | `<br>` (raw HTML)                   |
| Underline            | `<u>text</u>`                                    | `<u>text</u>`                       |
| Subscript            | `<sub>text</sub>`                                | `<sub>text</sub>`                   |
| Superscript          | `<sup>text</sup>`                                | `<sup>text</sup>`                   |
| Citation             | `<span class="citation" data-citation="...">`    | Raw HTML passthrough                |
| Highlight annotation | `<span class="highlight" data-annotation="...">` | Raw HTML passthrough                |
| Text color           | `<span style="color: ...">`                      | Raw HTML passthrough                |
| Background color     | `<span style="background-color: ...">`           | Raw HTML passthrough                |
| Styled table         | `<table>` (with inline styles)                   | Raw HTML passthrough                |
| Wrapper div          | `<div data-schema-version>`                      | `<!-- ZF_NOTE_META ... -->` comment |

### Known limitations

- **Definition lists** (`<dl>/<dt>/<dd>`): Markdown has no standard syntax.
  Converted via default handler; fidelity depends on `rehype-remark` defaults.
- **Nested table styles**: Styled tables are passed through as raw HTML; the
  inner structure is not parsed.
- **`<br>` → backslash breaks**: Intentionally avoided. Raw `<br>` is used
  instead to prevent interaction with adjacent passthrough HTML.

---

## Integration Points

### Template filter (`html2md`)

The `LibraryTemplateService` registers `html2md` as a LiquidJS filter
via its injected `ConvertService`:

```liquid
{{ item.note | html2md }}
```

The filter calls `this.convertService.html2md(input, opts)` and passes
`annotationImageFolder` from the user's settings, so annotated images
automatically resolve to the correct vault path.

### Strict line breaks (`md2html`)

The `ConvertOptions.strictLineBreaks` flag controls whether single newlines
become `<br>` in HTML. This matches Obsidian's "Strict line breaks" setting:

- `true` (default, CommonMark): single newlines are soft breaks (ignored).
- `false` (Obsidian default): single newlines become `<br>`.

The setting is read from the vault config via `parentHost.getVaultConfig()`
and passed when calling `convertService.md2html()`.

### Meta comment & CM6

The `<!-- ZF_NOTE_META ... -->` comment at the top of converted Markdown is:

1. **Protected** by the CM6 lock extension (inside editable regions, the meta
   line is excluded from the editable range).
2. **Styled** by the CM6 meta extension (collapsed/hidden in Source Mode).
3. **Parsed** by `md2html` to restore the wrapper `<div>` when saving back
   to Zotero.
