# WC-Tools Enhancement: `sync` Command & Compatibility Checking

## Overview

Add a `wc-deploy sync` command for quick compatibility updates, plus supporting utilities for fetching latest WordPress/WooCommerce versions and updating plugin headers.

**Repository:** https://github.com/lucasstark/wc-tools

---

## New Files to Create

### 1. `src/utils/compatibility.js`

```javascript
/**
 * Fetch latest WordPress version from WordPress.org API
 * Endpoint: https://api.wordpress.org/core/version-check/1.7/
 * @returns {Promise<string>} e.g., "6.7.1"
 */
export async function fetchLatestWordPressVersion() {
  const res = await fetch('https://api.wordpress.org/core/version-check/1.7/');
  const data = await res.json();
  return data.offers[0].version;
}

/**
 * Fetch latest WooCommerce version from WordPress.org Plugin API
 * Endpoint: https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&slug=woocommerce
 * @returns {Promise<string>} e.g., "9.4.2"
 */
export async function fetchLatestWooCommerceVersion() {
  const res = await fetch(
    'https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&slug=woocommerce'
  );
  const data = await res.json();
  return data.version;
}

/**
 * Parse plugin header for compatibility tags
 * @param {string} filePath - Path to main plugin file
 * @returns {{ testedUpTo: string, wcTestedUpTo: string, version: string }}
 *
 * Regex patterns:
 *   /^\s*\*?\s*Tested up to:\s*(.+)$/mi
 *   /^\s*\*?\s*WC tested up to:\s*(.+)$/mi
 *   /^\s*\*?\s*Version:\s*(.+)$/mi
 */
export function parsePluginCompatibility(filePath)

/**
 * Update compatibility headers in plugin file
 * @param {string} filePath
 * @param {{ testedUpTo?: string, wcTestedUpTo?: string }} updates
 *
 * Use string replacement matching the header patterns.
 * Preserve existing whitespace/formatting.
 */
export function updatePluginCompatibility(filePath, updates)

/**
 * Compare versions - checks if current covers latest (major.minor only)
 * @param {string} current - e.g., "6.6" or "6.6.0"
 * @param {string} latest - e.g., "6.7.1"
 * @returns {boolean} - true if current >= latest (major.minor)
 *
 * Logic:
 *   - Parse both to major.minor (ignore patch)
 *   - "6.7" covers "6.7.1" → true
 *   - "6.6" covers "6.7.1" → false
 */
export function isCompatibilityCurrent(current, latest)

/**
 * Extract major.minor from a version string
 * @param {string} version - e.g., "6.7.1"
 * @returns {string} - e.g., "6.7"
 */
export function majorMinor(version)
```

---

### 2. `src/utils/changelog.js`

```javascript
/**
 * Prepend a new entry to CHANGELOG.md or changelog.txt
 * @param {string} filePath
 * @param {string} version
 * @param {string[]} entries - Array of changelog lines
 *
 * Format for CHANGELOG.md:
 *   ## X.Y.Z - YYYY-MM-DD
 *   - Entry 1
 *   - Entry 2
 *
 * Format for changelog.txt (WordPress style):
 *   = X.Y.Z - YYYY-MM-DD =
 *   * Entry 1
 *   * Entry 2
 *
 * Insert after any existing header/title, before first version entry.
 */
export function prependChangelogEntry(filePath, version, entries)

/**
 * Detect changelog file in project root
 * @param {string} [cwd=process.cwd()]
 * @returns {string|null} - Path to changelog file or null
 *
 * Check order: CHANGELOG.md, changelog.md, changelog.txt
 */
export function findChangelogFile(cwd)
```

---

### 3. `src/utils/git.js`

```javascript
import { execSync } from 'node:child_process';

/**
 * Check if working directory is clean
 * @returns {boolean}
 */
export function isRepoClean() {
  const output = execSync('git status --porcelain', { encoding: 'utf8' });
  return output.trim() === '';
}

/**
 * Stage and commit all changes
 * @param {string} message
 */
export function commitAll(message) {
  execSync('git add -A');
  execSync(`git commit -m "${message}"`);
}

/**
 * Create annotated tag
 * @param {string} tag - e.g., "v1.2.3"
 * @param {string} message
 */
export function createTag(tag, message) {
  execSync(`git tag -a ${tag} -m "${message}"`);
}

/**
 * Push commits and tags to origin
 */
export function pushWithTags() {
  execSync('git push');
  execSync('git push --tags');
}
```

---

### 4. `src/commands/sync.js`

New command implementation.

**Command:** `wc-deploy sync`

**Flags:**
- `--dry-run` - Preview changes without executing

**Flow:**

```
1. VALIDATE CLEAN REPO
   ├─ Call isRepoClean()
   ├─ If false:
   │    → Error: "Working directory has uncommitted changes."
   │    → Error: "Commit or stash changes before running sync."
   │    → Exit 1
   └─ Continue if clean

2. LOAD CONFIG
   └─ Load .deployrc.json (use existing config loader)

3. FETCH LATEST VERSIONS (parallel)
   ├─ WordPress: fetchLatestWordPressVersion()
   ├─ WooCommerce: fetchLatestWooCommerceVersion()
   └─ Display: "Latest versions: WordPress {WP}, WooCommerce {WC}"

4. PARSE CURRENT PLUGIN HEADERS
   ├─ Call parsePluginCompatibility(config.mainFile)
   └─ Display: "Current: WP {testedUpTo}, WC {wcTestedUpTo}, Version {version}"

5. COMPARE VERSIONS
   ├─ wpNeedsUpdate = !isCompatibilityCurrent(current.testedUpTo, latestWP)
   ├─ wcNeedsUpdate = !isCompatibilityCurrent(current.wcTestedUpTo, latestWC)
   ├─ If neither needs update:
   │    → Success: "✓ Already compatible with latest versions. Nothing to do."
   │    → Exit 0
   └─ Continue if updates needed

6. CALCULATE NEW VERSION
   ├─ Parse current.version as semver
   ├─ Increment patch: X.Y.Z → X.Y.(Z+1)
   └─ Display: "Bumping version: {old} → {new}"

7. DRY RUN CHECK
   ├─ If --dry-run flag:
   │    → Display what would be updated
   │    → Exit 0
   └─ Continue if not dry run

8. UPDATE FILES
   ├─ Build updates object and changelog entries:
   │    if wpNeedsUpdate:
   │      updates.testedUpTo = majorMinor(latestWP)
   │      entries.push("Tested up to WordPress {version}")
   │    if wcNeedsUpdate:
   │      updates.wcTestedUpTo = majorMinor(latestWC)
   │      entries.push("Tested up to WooCommerce {version}")
   │
   ├─ updatePluginCompatibility(config.mainFile, updates)
   ├─ Update version in all versionFiles (use existing version update logic)
   ├─ prependChangelogEntry(findChangelogFile(), newVersion, entries)
   └─ Display: "✓ Updated files"

9. BUILD
   ├─ Run existing build command/logic
   ├─ If build fails:
   │    → Error: "Build failed. See output above."
   │    → Hint: "Revert changes with: git checkout -- ."
   │    → Exit 1
   └─ Display: "✓ Build complete"

10. DEPLOY TO WOOCOMMERCE.COM
    ├─ Run existing deploy logic (upload to WooCommerce.com)
    ├─ If deploy fails:
    │    → Error: "Deploy failed."
    │    → Hint: "Local files updated but not committed. Fix and retry with 'wc-deploy deploy' or revert."
    │    → Exit 1
    └─ Display: "✓ Deployed to WooCommerce.com"

11. GIT COMMIT, TAG, PUSH
    ├─ commitMessage = "Compatibility: WordPress {WP}, WooCommerce {WC}"
    ├─ commitAll(commitMessage)
    ├─ createTag("v{newVersion}", "Version {newVersion}")
    ├─ pushWithTags()
    └─ Display: "✓ Committed and pushed v{newVersion}"

12. SUCCESS
    └─ Display: "✓ Successfully released v{newVersion}"
```

---

## Files to Modify

### 1. CLI Entry Point (likely `bin/wc-deploy.js`)

Register the new sync command:

```javascript
import { syncCommand } from '../src/commands/sync.js';

program
  .command('sync')
  .description('Quick compatibility update - check WP/WC versions, bump patch, build, deploy')
  .option('--dry-run', 'Preview changes without executing')
  .action(syncCommand);
```

---

### 2. `src/commands/deploy.js` (Enhancement)

Add compatibility check to existing deploy flow. Insert before the version prompt:

```javascript
// Near the start of deploy command, after loading config:

const [latestWP, latestWC] = await Promise.all([
  fetchLatestWordPressVersion(),
  fetchLatestWooCommerceVersion()
]);

const current = parsePluginCompatibility(config.mainFile);

const wpNeedsUpdate = !isCompatibilityCurrent(current.testedUpTo, latestWP);
const wcNeedsUpdate = !isCompatibilityCurrent(current.wcTestedUpTo, latestWC);

if (wpNeedsUpdate || wcNeedsUpdate) {
  console.log('\nCompatibility update available:');
  if (wpNeedsUpdate) {
    console.log(`  WordPress: ${current.testedUpTo} → ${majorMinor(latestWP)}`);
  }
  if (wcNeedsUpdate) {
    console.log(`  WooCommerce: ${current.wcTestedUpTo} → ${majorMinor(latestWC)}`);
  }

  const shouldUpdate = await confirm('Include compatibility update in this release?');

  if (shouldUpdate) {
    // Store for later - include in file updates step
    deployContext.compatibilityUpdates = {
      testedUpTo: wpNeedsUpdate ? majorMinor(latestWP) : undefined,
      wcTestedUpTo: wcNeedsUpdate ? majorMinor(latestWC) : undefined
    };
    deployContext.compatibilityChangelogEntry =
      `Tested up to WordPress ${majorMinor(latestWP)} and WooCommerce ${majorMinor(latestWC)}`;
  }
}

// Then in the file update step, apply compatibility updates if present
```

---

## Configuration (Optional Enhancement)

Add optional fields to `.deployrc.json` schema:

```json
{
  "changelog": "CHANGELOG.md",
  "compatibility": {
    "checkOnDeploy": true
  }
}
```

Defaults:
- `changelog`: Auto-detect (CHANGELOG.md, changelog.md, changelog.txt)
- `compatibility.checkOnDeploy`: `true`

---

## Error Messages

| Scenario | Message |
|----------|---------|
| Dirty repo on sync | "Working directory has uncommitted changes. Commit or stash changes before running sync." |
| API fetch failure | "Failed to fetch latest {WordPress/WooCommerce} version. Check your network connection." |
| No .deployrc.json | "No .deployrc.json found. Run 'wc-deploy init' first." |
| Main plugin file missing | "Plugin file not found: {path}" |
| Build failure | "Build failed. See output above." |
| Deploy failure | "Deploy failed. Local files updated but not committed." |
| Git push failure | "Failed to push to remote. Local commit and tag created - push manually." |

---

## CLI Output Style

Use consistent status indicators:

```
$ wc-deploy sync

Checking repository... ✓ Clean

Fetching latest versions...
  WordPress:   6.7.1
  WooCommerce: 9.4.2

Current compatibility:
  WordPress:   6.6 → needs update
  WooCommerce: 9.4 → current

Bumping version: 1.3.2 → 1.3.3

Updating files...
  ✓ woocommerce-wishlists.php
  ✓ package.json
  ✓ CHANGELOG.md

Building... ✓
Deploying to WooCommerce.com... ✓

Committing changes...
  ✓ Committed: "Compatibility: WordPress 6.7, WooCommerce 9.4"
  ✓ Tagged: v1.3.3
  ✓ Pushed

✓ Successfully released v1.3.3
```

---

## Testing Checklist

- [ ] `sync` with clean repo and outdated WP compatibility
- [ ] `sync` with clean repo and outdated WC compatibility
- [ ] `sync` with clean repo and both outdated
- [ ] `sync` with clean repo and both current (should no-op)
- [ ] `sync` with dirty repo (should error)
- [ ] `sync --dry-run` shows preview without changes
- [ ] `deploy` shows compatibility prompt when outdated
- [ ] `deploy` skips compatibility prompt when current
- [ ] API failure handling (disconnect network and test)
- [ ] Build failure doesn't commit/tag/push
- [ ] Deploy failure doesn't commit/tag/push

---

## Future Enhancements (Not in Scope)

- `--force` flag to skip confirmations
- Branch validation (only sync/deploy from main)
- Slack/webhook notifications
- Support for monorepo with multiple extensions
