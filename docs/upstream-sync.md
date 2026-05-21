# Upstream Sync Guide

This fork tracks [duanxianpi/obsidian-zotflow](https://github.com/duanxianpi/obsidian-zotflow) while preserving fork-only behavior.

## Quick Start

```powershell
npm run sync:upstream:prep
```

That script will:

1. Fetch upstream tags and `upstream/master`
2. Create a temporary worktree at `C:\tmp\advanced-zotflow-upstream-sync`
3. Attempt a `--no-commit --no-ff` merge against `upstream/master`
4. Print any unresolved conflict files

If upstream moves the `reader/reader` gitlink, treat that as a separate review point. This fork keeps reader-specific Obsidian customizations, so do not blindly accept the upstream submodule pointer without checking the reader branch history.

## Typical Conflict Hotspots

- `manifest.json`
- `package.json`
- `package-lock.json`
- `.github/workflows/release.yml`
- `README.md`
- `src/main.ts`
- `src/services/services.ts`
- `src/settings/sections/general-section.ts`
- `src/ui/reader/view.ts`
- `src/ui/tree-view/Node.tsx`
- `src/worker/services/library-template.ts`

## Resolution Rules For This Fork

- Keep fork branding:
  `advanced-zotflow`, `Advanced ZotFlow`, fork release asset names, fork author URL.
- Keep fork-only features:
  companion notes, Base View generation, workflow-related files already living in this fork.
- Take upstream functional changes by default:
  sync engine updates, source note updates, library permission/cache logic, repair tooling, template context expansion, settings additions.
- Prefer upstream compatibility versions for platform dependencies:
  especially React and reader-facing types unless the fork has a clear reason to diverge.

## Verification

After resolving conflicts:

```powershell
npm run build:plugin
npm run build
```

If the reader submodule is intentionally unchanged, still smoke-test:

- remote Zotero reader
- local attachment reader
- sync all libraries
- update source notes
- item-note editing
