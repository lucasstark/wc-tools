import chalk from 'chalk';
import semver from 'semver';
import inquirer from 'inquirer';
import { loadConfig, getCurrentVersion } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';
import { updateVersionInFiles } from '../tasks/version-updater.js';
import { updateChangelog } from '../tasks/changelog-updater.js';
import { checkVersionConsistency } from '../utils/version-checker.js';
import { getDeployedVersion, getLatestGitTag, hasUncommittedVersionChanges, isGitRepo, commitAndTagVersion } from '../utils/deployed-version.js';

const DEFAULT_CHANGELOG_ENTRY = 'Update: WP and WC compatibility';

/**
 * Version bump command
 */
export async function versionCommand(newVersion, options) {
  console.log(chalk.bold.cyan('\n  Version Management\n'));

  const config = await loadConfig();

  // Check current version consistency
  const versionCheck = await checkVersionConsistency(config);
  const currentVersion = versionCheck.version || await getCurrentVersion();

  // Sanity checks before bumping
  await performSanityChecks(config, currentVersion, options);

  // If no version provided, prompt with default
  if (!newVersion) {
    const nextPatch = semver.inc(currentVersion, 'patch');
    const nextMinor = semver.inc(currentVersion, 'minor');
    const nextMajor = semver.inc(currentVersion, 'major');

    console.log(chalk.gray(`  Suggestions: ${nextPatch} (patch), ${nextMinor} (minor), ${nextMajor} (major)\n`));

    const { inputVersion } = await inquirer.prompt([
      {
        type: 'input',
        name: 'inputVersion',
        message: 'New version:',
        default: nextPatch,
        validate: (input) => {
          if (!semver.valid(input)) {
            return 'Please enter a valid semantic version (e.g., 2.3.8)';
          }
          if (semver.lte(input, currentVersion)) {
            return `Version must be greater than current version (${currentVersion})`;
          }
          return true;
        }
      }
    ]);

    newVersion = inputVersion;
  }

  // Validate version
  if (!semver.valid(newVersion)) {
    logger.error('Invalid version number. Please use semantic versioning (e.g., 2.3.8)');
    process.exit(1);
  }

  if (semver.lte(newVersion, currentVersion)) {
    logger.error(`New version must be greater than current version (${currentVersion})`);
    process.exit(1);
  }

  // Get changelog entries from --message option or prompt
  let changelogEntries = options.message || [];

  if (changelogEntries.length === 0) {
    // Prompt for changelog entries with default
    console.log();
    console.log(chalk.gray('  Enter changelog entries (one per line)'));
    console.log(chalk.gray('  Format: "Type: Description" (e.g., "Fix: Correct issue with...")\n'));
    console.log(chalk.gray('  Types: Fix, Update, New, Security, Added, Remove\n'));

    let addingEntries = true;
    let isFirstEntry = true;

    while (addingEntries) {
      const { entry } = await inquirer.prompt([
        {
          type: 'input',
          name: 'entry',
          message: changelogEntries.length === 0 ? 'Changelog entry:' : 'Another entry (or press Enter to finish):',
          default: isFirstEntry ? DEFAULT_CHANGELOG_ENTRY : ''
        }
      ]);

      isFirstEntry = false;

      if (entry.trim() === '') {
        if (changelogEntries.length === 0) {
          logger.warn('At least one changelog entry is required');
          continue;
        }
        addingEntries = false;
      } else {
        changelogEntries.push(entry.trim());
      }
    }
  }

  console.log();
  logger.info(`Current version: ${chalk.bold(currentVersion)}`);
  logger.info(`New version: ${chalk.bold.green(newVersion)}`);
  console.log();
  logger.info('Changelog entries:');
  changelogEntries.forEach(entry => {
    console.log(chalk.gray(`    * ${entry}`));
  });
  console.log();

  const dryRun = options.dryRun || false;

  if (dryRun) {
    logger.info(chalk.yellow('DRY RUN MODE - No changes will be made\n'));
  }

  try {
    // Update version in files
    logger.step('Updating version in files...');
    const results = await updateVersionInFiles(config, newVersion, dryRun);

    if (results.every(r => !r.updated)) {
      logger.error('No files were updated');
      process.exit(1);
    }

    // Update changelog
    logger.step('Updating changelog...');
    await updateChangelog(newVersion, changelogEntries, dryRun);

    console.log(chalk.green('\n  Version updated successfully!\n'));

    if (!dryRun) {
      logger.info('Next steps:');
      logger.info('  1. Review the changes');
      logger.info('  2. Run: wc-deploy build');
      logger.info('  3. Run: wc-deploy qit');
      logger.info('  4. Commit and tag the release');
    }
  } catch (error) {
    logger.error(`Version update failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Perform sanity checks before version bump
 */
async function performSanityChecks(config, currentVersion, options) {
  console.log(chalk.gray('  Checking deployment status...\n'));

  const inGitRepo = await isGitRepo();
  const uncommitted = inGitRepo ? await hasUncommittedVersionChanges() : { hasChanges: false, files: [] };

  // Check deployed version via WooCommerce.com API
  const deployed = await getDeployedVersion(config.productId);
  const gitTag = !deployed && inGitRepo ? await getLatestGitTag() : null;

  // Display version comparison
  if (deployed) {
    console.log(chalk.gray(`  Deployed version (WooCommerce.com): ${chalk.white(deployed.version)}`));
  }
  if (gitTag) {
    console.log(chalk.gray(`  Latest git tag: ${chalk.white(gitTag)}`));
  }
  console.log(chalk.gray(`  Local version:  ${chalk.white(currentVersion)}`));
  console.log();

  // Handle uncommitted changes with QIT context
  if (uncommitted.hasChanges) {
    logger.warn('Uncommitted changes detected in version files:');
    uncommitted.files.forEach(f => console.log(chalk.yellow(`    - ${f}`)));
    console.log();

    if (!options.force) {
      // Cross-reference with deployed version
      if (deployed) {
        if (currentVersion === deployed.version) {
          // Local matches deployed - safe to commit/tag and bump
          logger.success(`Local version matches deployed version (${deployed.version})`);
          logger.info('Safe to commit, tag, and bump.\n');

          const { action } = await inquirer.prompt([
            {
              type: 'list',
              name: 'action',
              message: `Commit & tag ${currentVersion} before bumping?`,
              choices: [
                { name: `Yes - commit & tag ${currentVersion}, then bump`, value: 'commit-tag-bump' },
                { name: 'No - just bump version (skip commit/tag)', value: 'skip' },
                { name: 'Cancel', value: 'cancel' }
              ],
              default: 'commit-tag-bump'
            }
          ]);

          if (action === 'cancel') {
            logger.info('Version bump cancelled');
            process.exit(0);
          }

          if (action === 'commit-tag-bump') {
            await doCommitAndTag(currentVersion);
          }
        } else if (semver.gt(currentVersion, deployed.version)) {
          // Local is ahead of deployed - deployment may have failed
          logger.error(`Local version (${currentVersion}) is AHEAD of deployed version (${deployed.version})`);
          logger.error('This could mean the deployment failed or is still pending.\n');

          const { action } = await inquirer.prompt([
            {
              type: 'list',
              name: 'action',
              message: 'What would you like to do?',
              choices: [
                { name: `Commit & tag ${currentVersion} anyway, then bump`, value: 'commit-tag-bump' },
                { name: 'Just bump version (skip commit/tag)', value: 'skip' },
                { name: 'Cancel - investigate deployment issue first', value: 'cancel' }
              ],
              default: 'cancel'
            }
          ]);

          if (action === 'cancel') {
            logger.info('Version bump cancelled. Check the WooCommerce.com vendor dashboard.');
            process.exit(0);
          }

          if (action === 'commit-tag-bump') {
            await doCommitAndTag(currentVersion);
          }
        } else {
          // Local is behind deployed - very unusual
          logger.error(`Local version (${currentVersion}) is BEHIND deployed version (${deployed.version})`);
          logger.error('Your local files are out of sync with what is deployed.\n');
          process.exit(1);
        }
      } else if (gitTag) {
        // Fallback to git tag comparison
        if (currentVersion === gitTag || semver.gt(currentVersion, gitTag)) {
          logger.info(`Using git tag for comparison (QIT unavailable)`);
          console.log();

          const { action } = await inquirer.prompt([
            {
              type: 'list',
              name: 'action',
              message: `Commit & tag ${currentVersion} before bumping?`,
              choices: [
                { name: `Yes - commit & tag ${currentVersion}, then bump`, value: 'commit-tag-bump' },
                { name: 'No - just bump version (skip commit/tag)', value: 'skip' },
                { name: 'Cancel', value: 'cancel' }
              ],
              default: 'commit-tag-bump'
            }
          ]);

          if (action === 'cancel') {
            logger.info('Version bump cancelled');
            process.exit(0);
          }

          if (action === 'commit-tag-bump') {
            await doCommitAndTag(currentVersion);
          }
        }
      } else {
        // No QIT, no git tags - just ask
        logger.warn('Could not verify deployed version (QIT unavailable, no git tags)');
        console.log();

        const { action } = await inquirer.prompt([
          {
            type: 'list',
            name: 'action',
            message: `Uncommitted changes found. Commit & tag ${currentVersion} before bumping?`,
            choices: [
              { name: `Yes - commit & tag ${currentVersion}, then bump`, value: 'commit-tag-bump' },
              { name: 'No - just bump version (skip commit/tag)', value: 'skip' },
              { name: 'Cancel', value: 'cancel' }
            ],
            default: 'commit-tag-bump'
          }
        ]);

        if (action === 'cancel') {
          logger.info('Version bump cancelled');
          process.exit(0);
        }

        if (action === 'commit-tag-bump') {
          await doCommitAndTag(currentVersion);
        }
      }
    }
  } else {
    // No uncommitted changes - just validate versions
    if (deployed) {
      if (currentVersion === deployed.version) {
        logger.success('Local version matches deployed version. Ready to bump.\n');
      } else if (semver.gt(currentVersion, deployed.version)) {
        logger.warn(`Local version (${currentVersion}) is ahead of deployed version (${deployed.version})`);
        logger.warn('You may have already bumped but not deployed yet.\n');

        if (!options.force) {
          const { proceed } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'proceed',
              message: 'Continue with version bump anyway?',
              default: false
            }
          ]);

          if (!proceed) {
            logger.info('Version bump cancelled');
            process.exit(0);
          }
        }
      } else {
        logger.error(`Local version (${currentVersion}) is behind deployed version (${deployed.version})`);
        logger.error('This should not happen. Please check your local files.\n');
        process.exit(1);
      }
    } else if (gitTag && semver.gt(currentVersion, gitTag)) {
      logger.warn(`Local version (${currentVersion}) is ahead of latest git tag (${gitTag})`);
      logger.warn('You may have already bumped the version.\n');

      if (!options.force) {
        const { proceed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'proceed',
            message: 'Continue with version bump anyway?',
            default: false
          }
        ]);

        if (!proceed) {
          logger.info('Version bump cancelled');
          process.exit(0);
        }
      }
    } else {
      logger.success('Ready to bump version.\n');
    }
  }
}

/**
 * Helper to commit and tag a version
 */
async function doCommitAndTag(version) {
  logger.step(`Committing and tagging version ${version}...`);
  const result = await commitAndTagVersion(version);
  if (result.success) {
    logger.success(`Committed and tagged ${version}`);
    console.log();
  } else {
    logger.error(`Failed to commit/tag: ${result.error}`);
    process.exit(1);
  }
}
