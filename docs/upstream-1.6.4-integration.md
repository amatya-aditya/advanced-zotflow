# ZotFlow 1.6.4 integration

The fork remains Advanced ZotFlow 1.0.15 and now incorporates original ZotFlow through tag **1.6.4**, commit `d6a8b3c`. The reader merges the corresponding upstream reader commit `c971316` with the fork reader, pinned at `e1988bb`.

## Reader startup

Obsidian 1.14 changed its math renderer. The reader previously read the host MathJax configuration and loaded a private MathJax script before connecting. A missing or incompatible host setup prevented the child entry point from registering, producing `Child connect timeout`.

The reader now uses its bundled MathJax modules and inline fonts. It connects through a bootstrap installed on the iframe element before navigation, using the actual containing window for popouts. The earlier Penpal handshake remains a compatibility fallback. Connection generation checks, token validation, timeout handling, reconnect replay, and disposal remain in place.

## Upstream and fork features

The merge incorporates upstream CSL management and rendering, advanced tree search, persistence regions, reader lifecycle and document-worker updates, sync repairs, annotation conversion changes, declarative settings, and test coverage. Optional enhancement-pack capabilities follow upstream's install flow.

Retained fork features include workflows, companion notes and their source-note indexing rules, Base views and metadata, rich annotation callouts and citation formatting, custom reader themes and hotkeys, bookmarks and recents, user content after `%% ZOTFLOW_USER_START %%`, and verified WebDAV access limited to personal-library attachments. Fork branding, release ZIP packaging, and documentation are retained. Release version checks, workflow artifacts, and provenance were incorporated. The upstream enhancement-pack notification is gated to its original repository.

## PDF bookmarks and tree settings

- A PDF attachment nested beneath a reference has its own bookmark action in the tree context menu.
- The reader pane menu can bookmark its current Zotero attachment.
- Opening a Zotero attachment through the common viewer path records that attachment in Recents. Failure to save the recent entry does not prevent opening the reader.
- Recent entries can be removed individually.
- **Settings > Advanced ZotFlow > General > Tree View** controls item icons and the Library, Recent Items, Bookmarks, Source Notes, and Base Views mode buttons. Changes apply immediately; expansion arrows remain usable.

Requires **Obsidian 1.13.4 or newer** for upstream's declarative settings API. Existing settings default to showing all tree icons and buttons.

## Validation

- Production PDF.js, reader, and plugin builds.
- Source and test TypeScript checks, including the user's strict/bundler compiler settings.
- Plugin unit/integration tests and the reader's native selection/lifecycle tests.
- `node scripts/smoke-reader.mjs`: actual Chromium iframe with no host MathJax, direct bridge registration, one-page PDF opened, reader-ready event observed, no runtime exceptions. Requires Chrome; `CHROME_PATH` can override its executable path.
- Regression tests cover missing host math configuration, direct startup and stale connection rejection, and bookmark toggles on PDFs nested below references.
- `npm test` (lint, test typecheck, then the suite) passes end to end: 47 test files, 1,943 tests, 1 skipped.

Upstream's stricter type-aware lint rules initially flagged retained fork code, almost all of it in `src/ui/workflow`. Those were resolved by typing the code rather than suppressing the rules:

- `ConditionNode` and the shared context helpers now use react-querybuilder's own `ActionProps`/`FieldSelectorProps`/`RuleType` types and a `contextNodeId()` narrowing for the library's untyped `context` bag.
- `isArraySchema()` in `context/schema.ts` replaces the `any` casts previously used to read a TypeBox array's element type.
- `interpolateToString()`/`stringifyContextValue()` in `context/interpolate.ts` give nodes a typed way to render an interpolated value, so objects render as JSON instead of `[object Object]`.
- `engine.ts` resolves absent propagated schemas through `EMPTY_SCHEMA` instead of asserting through optional chains.
- Lezer callbacks are typed with `SyntaxNodeRef`, and the generated parser is declared in `context/template.d.ts`, so the `@ts-ignore` comments are gone.
- The Example Action node writes to the plugin log (Activity Center → Logs) rather than the console, and the Base view delete action uses `FileManager.trashFile()` so it honours the user's deletion preference.

Detailed local output is in the ignored `.local-validation` directory.

The browser check does not replace testing in the user's running Obsidian vault. Reload the plugin or restart Obsidian to load the rebuilt `main.js`. This integration is local; no remote push or release was performed.

References: [Obsidian changelog](https://obsidian.md/changelog/), [ZotFlow 1.6.4](https://github.com/duanxianpi/zotflow/tree/1.6.4).
