import inquirer from 'inquirer';
import semver from 'semver';
import chalk from 'chalk';
import { loadConfig, getCurrentVersion } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';
import { updateVersionInFiles } from '../tasks/version-updater.js';
import { updateChangelog } from '../tasks/changelog-updater.js';
import { gitCommitAndTag } from '../tasks/git-manager.js';
import { runBuild } from '../tasks/builder.js';
import { deployToWooCommerce } from '../tasks/deployer.js';

export async function deployCommand(options) {
  console.log(chalk.bold.cyan('\n🚀 WooCommerce Extension Deployment\n'));

  // Load configuration
  const config = await loadConfig();
  const currentVersion = await getCurrentVersion();

  logger.info(`Current version: ${chalk.bold(currentVersion)}`);
  logger.info(`Plugin: ${chalk.bold(config.slug || 'Unknown')}\n`);

  // Get version if not provided
  let newVersion = options.version;

  if (!newVersion) {
    const { version } = await inquirer.prompt([
      {
        type: 'input',
        name: 'version',
        message: 'New version number:',
        default: semver.inc(currentVersion, 'patch'),
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
    newVersion = version;
  }

  // Get changelog entry
  const { changelogEntry } = await inquirer.prompt([
    {
      type: 'input',
      name: 'changelogEntry',
      message: 'Changelog entry:',
      validate: (input) => input.trim().length > 0 || 'Changelog entry is required'
    }
  ]);

  // Confirm deployment
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Deploy version ${chalk.bold(newVersion)}?`,
      default: true
    }
  ]);

  if (!confirm) {
    logger.warn('Deployment cancelled');
    process.exit(0);
  }

  const dryRun = options.dryRun || false;

  if (dryRun) {
    logger.info(chalk.yellow('\n📝 DRY RUN MODE - No changes will be made\n'));
  }

  try {
    // Step 1: Update version numbers
    logger.step('Updating version numbers...');
    const versionResults = await updateVersionInFiles(config, newVersion, dryRun);

    if (versionResults.every(r => !r.updated)) {
      logger.error('No files were updated. Check your .deployrc.json configuration.');
      process.exit(1);
    }

    // Step 2: Update changelog
    logger.step('Updating changelog...');
    await updateChangelog(newVersion, changelogEntry, dryRun);

    // Step 3: Build
    if (!options.skipBuild) {
      logger.step('Building distribution package...');
      await runBuild(config, dryRun);
    } else {
      logger.info('Skipping build step');
    }

    // Step 4: Git commit and tag
    logger.step('Creating git commit and tag...');
    await gitCommitAndTag(newVersion, changelogEntry, dryRun);

    // Step 5: Deploy to WooCommerce.com (if not skipped)
    if (!options.skipDeploy) {
      logger.step('Deploying to WooCommerce.com...');
      await deployToWooCommerce(config, newVersion, dryRun);
    } else {
      logger.info('Skipping WooCommerce.com deployment');
    }

    console.log(chalk.green.bold('\n✨ Deployment completed successfully!\n'));

    if (dryRun) {
      logger.info(chalk.yellow('This was a dry run. Run without --dry-run to apply changes.'));
    }
  } catch (error) {
    logger.error(`Deployment failed: ${error.message}`);
    process.exit(1);
  }
}
