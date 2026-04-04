/**
 * Markdown → Zotero Note HTML conversion.
 *
 * Pipeline: md string → remark parse → remark→rehype → rehype→html string
 *
 * Runs entirely in the Web Worker — no DOM dependency.
 */

import { unified } from "unified";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { toText } from "hast-util-to-text";
import { visit } from "unist-util-visit";
import { visitParents } from "unist-util-visit-parents";

import { NOTE_META_PREFIX } from "./html-to-md";

import type { Processor } from "unified";
import type { Root as HRoot, RootContent } from "hast";
import type { Root as MRoot } from "mdast";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProcessor = Processor<any, any, any, any, any>;

/* ================================================================ */
/*  Options                                                         */
/* ================================================================ */

/** Options for HTML ↔ Markdown conversion. */
export interface ConvertOptions {
    /**
     * When `true` (default), single line breaks in markdown are treated as
     * soft breaks (standard CommonMark). When `false`, single line breaks
     * become hard breaks (`<br>` in HTML) — matching Obsidian's behaviour
     * when "Strict line breaks" is turned off.
     */
    strictLineBreaks?: boolean;
}

/* ================================================================ */
/*  Markdown → remark AST                                          */
/* ================================================================ */

function md2remark(
    str: string,
    remarkParser: AnyProcessor,
    strictLineBreaks = true,
): MRoot {
    // Restore annotated images: ![<img ...> | W](path/KEY.png) → <img ...>
    // The <img> tag in the alt text carries all original data-* attributes;
    // we strip the markdown image wrapper and leave the raw HTML tag.
    str = str.replace(
        /!\[(<img\s[^>]*>)\s*(?:\|\s*\d+)?\]\([^)]+\)/g,
        (_match, imgTag: string) => imgTag,
    );

    // Parse Obsidian-style image ![[xxx.png]] → standard markdown image
    // Only re-encode URLs for Obsidian embeds; leave standard images untouched
    // to avoid corrupting remark-stringify escape sequences (e.g. \& → %5C&).
    str = str.replace(
        /!\[\[(.*?)\]\]/g,
        (_s, path: string) => `![](${encodeURI(decodeURI(path))})`,
    );
    const tree = remarkParser.parse(str);

    // When strict line breaks is off (Obsidian default), convert soft line
    // breaks in text nodes to hard break nodes so they become <br> in HTML.
    if (!strictLineBreaks) {
        const convertBreaks = (node: any) => {
            if (!node.children) return;
            const newChildren: any[] = [];
            for (const child of node.children) {
                if (child.type === "text") {
                    const parts = (child.value as string).split(/\r?\n|\r/);
                    if (parts.length > 1) {
                        for (let i = 0; i < parts.length; i++) {
                            if (parts[i]) {
                                newChildren.push({
                                    type: "text",
                                    value: parts[i],
                                });
                            }
                            if (i < parts.length - 1) {
                                newChildren.push({ type: "break" });
                            }
                        }
                        continue;
                    }
                }
                convertBreaks(child);
                newChildren.push(child);
            }
            node.children = newChildren;
        };
        convertBreaks(tree);
    }

    return tree;
}

/* ================================================================ */
/*  remark → rehype (Markdown AST → HTML AST)                      */
/* ================================================================ */

async function remark2rehype(
    remark: MRoot,
    remark2rehypeProcessor: AnyProcessor,
): Promise<HRoot> {
    const result = await remark2rehypeProcessor.run(remark as any);
    return result as HRoot;
}

/* ================================================================ */
/*  rehype → HTML string (for Zotero note storage)                 */
/* ================================================================ */

function rehype2note(rehype: HRoot, rehypeStringifier: AnyProcessor): string {
    // Del node → span with strikethrough style (Zotero format)
    visit(
        rehype,
        (node: any) =>
            node.type === "element" && (node as any).tagName === "del",
        (node: any) => {
            node.tagName = "span";
            node.properties.style = "text-decoration: line-through";
        },
    );

    // Math code nodes produced by remark-math + remark-rehype.
    // Must run BEFORE the code flattener to prevent math <code> from being destroyed.
    // Inline: <code class="language-math math-inline">x</code> → <span class="math">$x$</span>
    // Block:  <pre><code class="language-math math-display">x</code></pre> → <pre class="math">$$x$$</pre>
    visitParents(
        rehype,
        (node: any) =>
            node.type === "element" &&
            (node as any).tagName === "code" &&
            Array.isArray((node as any).properties?.className) &&
            ((node as any).properties.className.includes("math-inline") ||
                (node as any).properties.className.includes("math-display")),
        (node: any, ancestors) => {
            const text = toText(node);
            const isDisplay =
                Array.isArray(node.properties?.className) &&
                node.properties.className.includes("math-display");
            const parent = ancestors.length
                ? ancestors[ancestors.length - 1]
                : undefined;

            if (
                isDisplay &&
                parent?.type === "element" &&
                (parent as any).tagName === "pre"
            ) {
                parent.properties = { className: "math" };
                parent.children = [{ type: "text", value: "$$" + text + "$$" }];
            } else {
                node.tagName = "span";
                node.properties = { className: "math" };
                node.children = [{ type: "text", value: "$" + text + "$" }];
            }
        },
    );

    // Code node — flatten code inside pre
    visitParents(
        rehype,
        (node: any) =>
            node.type === "element" && (node as any).tagName === "code",
        (node: any, ancestors) => {
            const parent = ancestors.length
                ? ancestors[ancestors.length - 1]
                : undefined;
            if (
                parent?.type === "element" &&
                (parent as any).tagName === "pre"
            ) {
                node.value = toText(node, { whitespace: "pre-wrap" });
                if (node.value.endsWith("\n")) {
                    node.value = node.value.slice(0, -1);
                }
                node.type = "text";
            }
        },
    );

    // Wrap lines in list with <span> (for diff compatibility)
    visitParents(rehype, "text", (node: any, ancestors) => {
        const parent = ancestors.length
            ? ancestors[ancestors.length - 1]
            : undefined;
        if (
            parent?.type === "element" &&
            ["li", "td"].includes((parent as any).tagName) &&
            node.value.replace(/[\r\n]/g, "")
        ) {
            node.type = "element";
            node.tagName = "span";
            node.children = [
                { type: "text", value: node.value.replace(/[\r\n]/g, "") },
            ];
            node.value = undefined;
        }
    });

    // No empty breakline text node in list (for diff compatibility)
    visit(
        rehype,
        (node: any) =>
            node.type === "element" &&
            ((node as any).tagName === "li" || (node as any).tagName === "td"),
        (node: any) => {
            node.children = node.children.filter(
                (_n: { type: string; value: string }) =>
                    _n.type === "element" ||
                    (_n.type === "text" && _n.value.replace(/[\r\n]/g, "")),
            );
        },
    );

    // Math node — restore Zotero math format
    visit(
        rehype,
        (node: any) =>
            node.type === "element" &&
            ((node as any).properties?.className?.includes("math-inline") ||
                (node as any).properties?.className?.includes("math-display")),
        (node: any) => {
            if (node.properties.className.includes("math-inline")) {
                node.children = [
                    { type: "text", value: "$" },
                    ...node.children,
                    { type: "text", value: "$" },
                ];
            } else if (node.properties.className.includes("math-display")) {
                node.children = [
                    { type: "text", value: "$$" },
                    ...node.children,
                    { type: "text", value: "$$" },
                ];
                node.tagName = "pre";
            }
            node.properties.className = "math";
        },
    );

    // Ignore link rel attribute
    visit(
        rehype,
        (node: any) => node.type === "element" && (node as any).tagName === "a",
        (node: any) => {
            node.properties.rel = undefined;
        },
    );

    // Ignore empty lines (not parsed to md)
    const tempChildren: RootContent[] = [];
    const isEmptyNode = (_n: any) =>
        (_n.type === "text" && !_n.value.trim()) ||
        (_n.type === "element" &&
            _n.tagName === "p" &&
            !_n.children.length &&
            !toText(_n).trim());
    for (const child of rehype.children) {
        if (
            tempChildren.length &&
            isEmptyNode(tempChildren[tempChildren.length - 1]) &&
            isEmptyNode(child)
        ) {
            continue;
        }
        tempChildren.push(child);
    }
    rehype.children = tempChildren;

    return String(rehypeStringifier.stringify(rehype as any));
}

/* ================================================================ */
/*  Public API — md2html                                           */
/* ================================================================ */

/**
 * Convert Markdown to Zotero-format HTML.
 * Flow: md string → remark parse → remark→rehype → rehype→html string
 *
 * If the markdown starts with a `<!-- ZF_NOTE_META ... -->` comment
 * (injected by `html2md`), the wrapper `<div>` is restored with the
 * original data-* attributes (data-schema-version, data-citation-items).
 *
 * Processors are injected by ConvertService (frozen, reusable).
 */
export async function md2htmlWithProcessors(
    md: string,
    remarkParser: AnyProcessor,
    remark2rehypeProcessor: AnyProcessor,
    rehypeStringifier: AnyProcessor,
    options?: ConvertOptions,
): Promise<string> {
    // Extract wrapper-div metadata comment (if present).
    // Accept the current format (<!-- ZF_NOTE_META ... -->)
    // and legacy formats (%% ZF_NOTE_META ... %%, <!-- zotflow-note-meta ... -->).
    let wrapperAttrs: string | null = null;
    const metaRe = new RegExp(
        `^(?:<!-- ${NOTE_META_PREFIX} (.*?) -->|%% ${NOTE_META_PREFIX} (.*?) %%|<!-- zotflow-note-meta (.*?) -->)\\n?`,
    );
    const metaMatch = md.match(metaRe);
    if (metaMatch) {
        wrapperAttrs = (metaMatch[1] ?? metaMatch[2] ?? metaMatch[3])!.trim();
        md = md.slice(metaMatch[0]!.length);
    }

    const strict = options?.strictLineBreaks ?? true;
    const remark = md2remark(md, remarkParser, strict);
    const rehype = await remark2rehype(remark, remark2rehypeProcessor);
    let html = rehype2note(rehype, rehypeStringifier);

    // Restore the wrapper div with original metadata attributes
    if (wrapperAttrs) {
        html = `<div ${wrapperAttrs}>${html}</div>`;
    }

    return html;
}
