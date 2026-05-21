param(
    [string]$WorktreePath = "C:\tmp\advanced-zotflow-upstream-sync",
    [string]$UpstreamRef = "upstream/master"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "Preparing upstream sync worktree..."
Write-Host "Repo: $RepoRoot"
Write-Host "Worktree: $WorktreePath"
Write-Host "Upstream ref: $UpstreamRef"

if (Test-Path -LiteralPath $WorktreePath) {
    throw "Worktree path already exists: $WorktreePath`nRemove it or pass -WorktreePath with a different location."
}

$null = git -C $RepoRoot rev-parse --is-inside-work-tree

git -C $RepoRoot fetch upstream --tags
git -C $RepoRoot fetch upstream refs/heads/master:refs/remotes/upstream/master
git -C $RepoRoot worktree add $WorktreePath HEAD

$mergeSucceeded = $true
try {
    git -C $WorktreePath merge --no-commit --no-ff $UpstreamRef
} catch {
    $mergeSucceeded = $false
}

if ($mergeSucceeded) {
    Write-Host ""
    Write-Host "Upstream merge applied cleanly in worktree:"
    Write-Host "  $WorktreePath"
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  1. Review the merged tree"
    Write-Host "  2. Run npm run build:plugin"
    Write-Host "  3. Run npm run build if the reader/submodule changed"
    exit 0
}

$conflicts = git -C $WorktreePath diff --name-only --diff-filter=U

Write-Host ""
Write-Host "Merge completed with conflicts in:"
if ($conflicts) {
    $conflicts | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "  (Git reported a merge problem but no unresolved file list was returned.)"
}

Write-Host ""
Write-Host "Common fork-specific conflict hotspots:"
Write-Host "  - manifest.json / package.json / versions.json"
Write-Host "  - .github/workflows/release.yml"
Write-Host "  - src/main.ts"
Write-Host "  - src/services/services.ts"
Write-Host "  - src/settings/sections/general-section.ts"
Write-Host "  - src/ui/reader/view.ts"
Write-Host "  - src/worker/services/library-template.ts"
Write-Host ""
Write-Host "Finish the merge inside the worktree, then copy the resolved changes back or commit from there."

exit 1
