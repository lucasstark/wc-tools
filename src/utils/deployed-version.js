import { execa } from 'execa';

/**
 * Get the deployed version from WooCommerce.com changelog API
 * This checks what version is actually live on WooCommerce.com
 *
 * The API returns raw changelog text in format:
 * *** Plugin Name Changelog ***
 *
 * YYYY.MM.DD - version X.Y.Z
 *     * Change entry
 */
export async function getDeployedVersion(productId) {
  if (!productId) {
    return null;
  }

  try {
    const url = `https://woocommerce.com/wp-json/wccom/changelog/1.0/product/${productId}`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const changelog = await response.text();

    // Parse the first version entry from the changelog
    // Format: YYYY.MM.DD - version X.Y.Z
    const versionMatch = changelog.match(/(\d{4}\.\d{2}\.\d{2})\s*-\s*version\s+(\d+\.\d+\.\d+)/i);

    if (versionMatch) {
      return {
        version: versionMatch[2],
        date: versionMatch[1],
        raw: changelog
      };
    }

    return null;
  } catch (error) {
    // API might be unavailable - that's ok
    return null;
  }
}

/**
 * Get the latest git tag that looks like a version
 */
export async function getLatestGitTag() {
  try {
    const result = await execa('git', ['describe', '--tags', '--abbrev=0'], {
      timeout: 5000
    });

    const tag = result.stdout.trim();
    // Check if it looks like a version (e.g., 2.3.12 or v2.3.12)
    const versionMatch = tag.match(/^v?(\d+\.\d+\.\d+)$/);
    return versionMatch ? versionMatch[1] : null;
  } catch (error) {
    return null;
  }
}

/**
 * Check if there are uncommitted changes to version-related files
 */
export async function hasUncommittedVersionChanges() {
  try {
    const result = await execa('git', ['status', '--porcelain'], {
      timeout: 5000
    });

    const lines = result.stdout.trim().split('\n').filter(l => l);

    // Check for changes to version-related files
    const versionFiles = ['package.json', 'changelog.txt'];
    const modifiedVersionFiles = lines.filter(line => {
      const file = line.slice(3).trim();
      return versionFiles.some(vf => file.endsWith(vf)) || file.endsWith('.php');
    });

    return {
      hasChanges: modifiedVersionFiles.length > 0,
      files: modifiedVersionFiles.map(l => l.slice(3).trim())
    };
  } catch (error) {
    return { hasChanges: false, files: [] };
  }
}

/**
 * Check if we're in a git repository
 */
export async function isGitRepo() {
  try {
    await execa('git', ['rev-parse', '--git-dir'], { timeout: 5000 });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Commit all changes and create an annotated tag for the version
 */
export async function commitAndTagVersion(version, message = null) {
  try {
    // Stage all changes
    await execa('git', ['add', '-A'], { timeout: 10000 });

    // Commit with version as message (or custom message)
    const commitMessage = message || version;
    await execa('git', ['commit', '-m', commitMessage], { timeout: 30000 });

    // Create annotated tag
    await execa('git', ['tag', '-a', version, '-m', version], { timeout: 10000 });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Check if working directory is clean (no uncommitted changes)
 */
export async function isRepoClean() {
  try {
    const result = await execa('git', ['status', '--porcelain'], { timeout: 5000 });
    return result.stdout.trim() === '';
  } catch (error) {
    return false;
  }
}

/**
 * Push commits and tags to origin
 */
export async function pushWithTags() {
  try {
    await execa('git', ['push'], { timeout: 60000 });
    await execa('git', ['push', '--tags'], { timeout: 60000 });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
