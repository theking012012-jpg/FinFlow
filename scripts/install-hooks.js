// scripts/install-hooks.js — self-installs the committed git hooks.
//
// Runs from `postinstall` (i.e. after `npm install` on a fresh clone). Points git
// at the version-controlled .githooks/ directory so the pre-commit bundle guard
// survives a fresh clone instead of living only on one machine. No-ops silently
// when there's no .git (e.g. the Railway deploy build, a tarball, CI checkout).
'use strict';
const { execSync } = require('child_process');

try {
  // Are we inside a git work tree? (fails → not a repo → nothing to install)
  execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  execSync('git config core.hooksPath .githooks', { stdio: 'ignore' });
  console.log('[install-hooks] git core.hooksPath → .githooks (pre-commit bundle guard active)');
} catch {
  // Not a git repo (deploy/CI) — nothing to do.
}
