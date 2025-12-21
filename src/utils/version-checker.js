import { readFile } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import { logger } from './logger.js';

/**
 * Extract version from package.json
 */
async function getPackageVersion() {
  try {
    const packagePath = join(process.cwd(), 'package.json');
    const content = await readFile(packagePath, 'utf-8');
    const pkg = JSON.parse(content);
    return pkg.version || null;
  } catch (error) {
    return null;
  }
}

/**
 * Extract version from main plugin file
 */
async function getPluginVersion(mainFile) {
  try {
    const pluginPath = join(process.cwd(), mainFile);
    const content = await readFile(pluginPath, 'utf-8');

    // Match: * Version: 2.3.11
    const match = content.match(/\*\s*Version:\s*([0-9.]+)/i);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
}

/**
 * Extract version from changelog.txt
 */
async function getChangelogVersion() {
  try {
    const changelogPath = join(process.cwd(), 'changelog.txt');
    const content = await readFile(changelogPath, 'utf-8');

    // Match: 2025.12.07 - version 2.3.11
    const match = content.match(/\d{4}\.\d{2}\.\d{2}\s+-\s+version\s+([0-9.]+)/i);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
}

/**
 * Check that all version numbers match
 */
export async function checkVersionConsistency(config) {
  logger.step('Checking version consistency...\n');

  const versions = {
    package: await getPackageVersion(),
    plugin: await getPluginVersion(config.mainFile),
    changelog: await getChangelogVersion()
  };

  // Display versions
  console.log(chalk.cyan('  Versions found:'));
  console.log(chalk.gray('  ├─ package.json:  '), versions.package || chalk.red('NOT FOUND'));
  console.log(chalk.gray('  ├─ plugin file:   '), versions.plugin || chalk.red('NOT FOUND'));
  console.log(chalk.gray('  └─ changelog.txt: '), versions.changelog || chalk.red('NOT FOUND'));
  console.log();

  // Check if any are missing
  const missing = [];
  if (!versions.package) missing.push('package.json');
  if (!versions.plugin) missing.push(config.mainFile);
  if (!versions.changelog) missing.push('changelog.txt');

  if (missing.length > 0) {
    logger.error(`Version not found in: ${missing.join(', ')}`);
    return { valid: false, versions, missing };
  }

  // Check if all match
  const allMatch = versions.package === versions.plugin &&
                   versions.plugin === versions.changelog;

  if (!allMatch) {
    logger.error('Version mismatch detected!');
    console.log(chalk.yellow('\n  Please ensure all versions match before deploying.\n'));
    return { valid: false, versions, mismatch: true };
  }

  logger.success(`All versions match: ${chalk.bold(versions.package)}\n`);
  return { valid: true, versions, version: versions.package };
}

/**
 * Get the current version (assumes they match)
 */
export async function getCurrentVersions(config) {
  const versions = {
    package: await getPackageVersion(),
    plugin: await getPluginVersion(config.mainFile),
    changelog: await getChangelogVersion()
  };

  return versions;
}
