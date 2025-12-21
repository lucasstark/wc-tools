import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger.js';

/**
 * Escape special regex characters in a string
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Update version in all configured files
 */
export async function updateVersionInFiles(config, newVersion, dryRun = false) {
  const results = [];

  for (const versionFile of config.versionFiles) {
    try {
      const filePath = join(process.cwd(), versionFile.file);
      let content = await readFile(filePath, 'utf-8');

      // Split pattern at {{version}} placeholder
      const parts = versionFile.pattern.split('{{version}}');
      if (parts.length !== 2) {
        logger.warn(`Invalid pattern in ${versionFile.file}: must contain exactly one {{version}}`);
        results.push({ file: versionFile.file, updated: false });
        continue;
      }

      // Escape the literal parts and build regex
      const beforeVersion = escapeRegex(parts[0]);
      const afterVersion = escapeRegex(parts[1]);
      const pattern = beforeVersion + '[0-9]+\\.[0-9]+\\.[0-9]+' + afterVersion;

      const replacement = versionFile.pattern.replace('{{version}}', newVersion);
      const regex = new RegExp(pattern, 'g');
      const newContent = content.replace(regex, replacement);

      if (content === newContent) {
        logger.warn(`No version pattern found in ${versionFile.file}`);
        results.push({ file: versionFile.file, updated: false });
        continue;
      }

      if (!dryRun) {
        await writeFile(filePath, newContent, 'utf-8');
      }

      logger.success(`Updated ${versionFile.file}`);
      results.push({ file: versionFile.file, updated: true });
    } catch (error) {
      logger.error(`Failed to update ${versionFile.file}: ${error.message}`);
      results.push({ file: versionFile.file, updated: false, error: error.message });
    }
  }

  return results;
}

/**
 * Extract current version from a file
 */
export async function extractVersionFromFile(filePath, pattern) {
  try {
    const content = await readFile(filePath, 'utf-8');

    // Split pattern and escape literal parts
    const parts = pattern.split('{{version}}');
    if (parts.length !== 2) return null;

    const beforeVersion = escapeRegex(parts[0]);
    const afterVersion = escapeRegex(parts[1]);
    const regexPattern = beforeVersion + '([0-9]+\\.[0-9]+\\.[0-9]+)' + afterVersion;

    const regex = new RegExp(regexPattern);
    const match = content.match(regex);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
}
