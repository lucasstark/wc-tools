import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';

/**
 * Format date as YYYY.MM.DD
 */
function formatDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
}

/**
 * Add new version entry to changelog.txt
 *
 * @param {string} version - The new version number
 * @param {string|string[]} entries - Changelog entries (string or array of strings)
 * @param {boolean} dryRun - If true, don't write changes
 */
export async function updateChangelog(version, entries, dryRun = false) {
  const changelogPath = join(process.cwd(), 'changelog.txt');

  try {
    await access(changelogPath);
  } catch (error) {
    logger.warn('No changelog.txt found, skipping changelog update');
    return false;
  }

  try {
    const content = await readFile(changelogPath, 'utf-8');
    const date = formatDate();

    // Normalize entries to array
    const entryList = Array.isArray(entries) ? entries : [entries];

    // Build the new changelog entry
    let newEntry = `${date} - version ${version}\n`;
    for (const entry of entryList) {
      // Ensure entry has proper format (add asterisk prefix if needed)
      const formattedEntry = entry.startsWith('*') ? entry : `* ${entry}`;
      newEntry += `    ${formattedEntry}\n`;
    }

    // Find where to insert (after the header line)
    const lines = content.split('\n');
    let insertIndex = 0;

    // Look for the header line (starts with ***)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('***')) {
        insertIndex = i + 1;
        break;
      }
    }

    // Insert new entry after header (with blank line before first version entry)
    lines.splice(insertIndex, 0, newEntry);
    const newContent = lines.join('\n');

    if (dryRun) {
      logger.info('Would update changelog.txt with:');
      console.log(chalk.gray(newEntry));
    } else {
      await writeFile(changelogPath, newContent, 'utf-8');
    }

    logger.success('Updated changelog.txt');
    return true;
  } catch (error) {
    logger.error(`Failed to update changelog: ${error.message}`);
    return false;
  }
}
