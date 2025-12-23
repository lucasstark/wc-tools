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
 * Find existing version entry in changelog
 * Returns { found: boolean, startLine: number, endLine: number }
 */
function findVersionEntry(lines, version) {
  const versionPattern = new RegExp(`^\\d{4}\\.\\d{2}\\.\\d{2}\\s*-\\s*version\\s+${version.replace(/\./g, '\\.')}\\s*$`, 'i');
  const anyVersionPattern = /^\d{4}\.\d{2}\.\d{2}\s*-\s*version\s+\d+\.\d+\.\d+/i;

  let startLine = -1;
  let endLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (versionPattern.test(lines[i].trim())) {
      startLine = i;

      // Find where this entry ends (next version line or end of file)
      for (let j = i + 1; j < lines.length; j++) {
        if (anyVersionPattern.test(lines[j].trim())) {
          endLine = j;
          break;
        }
      }

      // If no next version found, entry goes to end of file
      if (endLine === -1) {
        endLine = lines.length;
      }

      break;
    }
  }

  return { found: startLine !== -1, startLine, endLine };
}

/**
 * Get existing entries from a version block
 */
function getExistingEntries(lines, startLine, endLine) {
  const entries = [];

  for (let i = startLine + 1; i < endLine; i++) {
    const line = lines[i].trim();
    // Match lines that start with * or are indented bullet points
    if (line.startsWith('*') || line.startsWith('-')) {
      entries.push(line);
    }
  }

  return entries;
}

/**
 * Add new version entry to changelog.txt
 *
 * If an entry for this version already exists, appends new entries to it.
 * Otherwise creates a new version entry.
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
    const lines = content.split('\n');

    // Normalize entries to array and format them
    const entryList = Array.isArray(entries) ? entries : [entries];
    const formattedEntries = entryList
      .filter(e => e && e.trim())
      .map(entry => {
        const trimmed = entry.trim();
        // Ensure entry has proper format (add asterisk prefix if needed)
        return trimmed.startsWith('*') ? trimmed : `* ${trimmed}`;
      });

    if (formattedEntries.length === 0) {
      logger.info('No changelog entries to add');
      return true;
    }

    // Check if version entry already exists
    const existing = findVersionEntry(lines, version);

    if (existing.found) {
      // Get existing entries to avoid duplicates
      const existingEntries = getExistingEntries(lines, existing.startLine, existing.endLine);

      // Filter out entries that already exist (case-insensitive comparison)
      const newEntries = formattedEntries.filter(newEntry => {
        const normalized = newEntry.toLowerCase().replace(/^\*\s*/, '').trim();
        return !existingEntries.some(existing =>
          existing.toLowerCase().replace(/^\*\s*/, '').trim() === normalized
        );
      });

      if (newEntries.length === 0) {
        logger.info('All changelog entries already exist');
        return true;
      }

      // Find the last entry line in this version block
      let lastEntryLine = existing.startLine;
      for (let i = existing.startLine + 1; i < existing.endLine; i++) {
        const line = lines[i].trim();
        if (line.startsWith('*') || line.startsWith('-')) {
          lastEntryLine = i;
        }
      }

      // Insert new entries after the last entry
      const insertContent = newEntries.map(e => `    ${e}`).join('\n');
      lines.splice(lastEntryLine + 1, 0, ...newEntries.map(e => `    ${e}`));

      if (dryRun) {
        logger.info(`Would append to existing ${version} entry:`);
        newEntries.forEach(e => console.log(chalk.gray(`    ${e}`)));
      } else {
        await writeFile(changelogPath, lines.join('\n'), 'utf-8');
      }

      logger.success(`Appended ${newEntries.length} entry(s) to existing ${version} changelog`);
    } else {
      // Create new version entry
      let newEntry = `${date} - version ${version}\n`;
      for (const entry of formattedEntries) {
        newEntry += `    ${entry}\n`;
      }

      // Find where to insert (after the header line)
      let insertIndex = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('***')) {
          insertIndex = i + 1;
          break;
        }
      }

      // Insert new entry after header
      lines.splice(insertIndex, 0, newEntry);

      if (dryRun) {
        logger.info('Would add new changelog entry:');
        console.log(chalk.gray(newEntry));
      } else {
        await writeFile(changelogPath, lines.join('\n'), 'utf-8');
      }

      logger.success('Added new changelog entry');
    }

    return true;
  } catch (error) {
    logger.error(`Failed to update changelog: ${error.message}`);
    return false;
  }
}
