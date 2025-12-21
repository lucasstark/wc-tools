import chalk from 'chalk';
import semver from 'semver';
import { join } from 'path';
import { loadConfig, getCurrentVersion } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';
import {
  fetchLatestWordPressVersion,
  fetchLatestWooCommerceVersion,
  parsePluginCompatibility,
  updatePluginCompatibility,
  isCompatibilityCurrent,
  majorMinor
} from '../utils/compatibility.js';
import { isRepoClean, commitAndTagVersion, pushWithTags } from '../utils/deployed-version.js';
import { updateVersionInFiles } from '../tasks/version-updater.js';
import { updateChangelog } from '../tasks/changelog-updater.js';
import { runBuild } from '../tasks/builder.js';
import { deployToWooCommerce } from '../tasks/deployer.js';
import { runPhpcsCheck } from './phpcs.js';

/**
 * Sync command - quick compatibility update
 */
export async function syncCommand(options) {
  console.log(chalk.bold.cyan('\n  Compatibility Sync\n'));

  const dryRun = options.dryRun || false;

  if (dryRun) {
    logger.info(chalk.yellow('DRY RUN MODE - No changes will be made\n'));
  }

  // Step 1: Validate clean repo
  process.stdout.write(chalk.gray('Checking repository... '));
  const clean = await isRepoClean();
  if (!clean) {
    console.log(chalk.red('dirty'));
    console.log();
    logger.error('Working directory has uncommitted changes.');
    logger.error('Commit or stash changes before running sync.');
    process.exit(1);
  }
  console.log(chalk.green('clean'));
  console.log();

  // Step 1b: Run PHPCS check (unless skipped)
  if (!options.skipPhpcs) {
    logger.step('Running PHPCS coding standards check...');
    const phpcsResult = await runPhpcsCheck({ skipIfMissing: true });

    if (!phpcsResult) {
      logger.error('PHPCS check failed - fix coding standards violations before syncing');
      logger.info('Run "wc-deploy phpcs" to see details, or "wc-deploy phpcs --fix" to auto-fix');
      logger.info('Or use --skip-phpcs to bypass this check');
      process.exit(1);
    }
    logger.success('PHPCS check passed');
    console.log();
  }

  // Step 2: Load config
  const config = await loadConfig();
  const mainFilePath = join(process.cwd(), config.mainFile);

  // Step 3: Fetch latest versions (parallel)
  logger.step('Fetching latest versions...');
  let latestWP, latestWC;
  try {
    [latestWP, latestWC] = await Promise.all([
      fetchLatestWordPressVersion(),
      fetchLatestWooCommerceVersion()
    ]);
  } catch (error) {
    logger.error(`Failed to fetch versions: ${error.message}`);
    logger.info('Check your network connection.');
    process.exit(1);
  }

  console.log(chalk.gray(`  WordPress:   ${chalk.white(latestWP)}`));
  console.log(chalk.gray(`  WooCommerce: ${chalk.white(latestWC)}`));
  console.log();

  // Step 4: Parse current plugin headers
  const current = await parsePluginCompatibility(mainFilePath);
  const currentVersion = current.version || await getCurrentVersion();

  console.log(chalk.gray('Current compatibility:'));
  const wpStatus = isCompatibilityCurrent(current.testedUpTo, latestWP) ? chalk.green('current') : chalk.yellow('needs update');
  const wcStatus = isCompatibilityCurrent(current.wcTestedUpTo, latestWC) ? chalk.green('current') : chalk.yellow('needs update');
  console.log(chalk.gray(`  WordPress:   ${current.testedUpTo || 'not set'} → ${wpStatus}`));
  console.log(chalk.gray(`  WooCommerce: ${current.wcTestedUpTo || 'not set'} → ${wcStatus}`));
  console.log();

  // Step 5: Compare versions
  const wpNeedsUpdate = !isCompatibilityCurrent(current.testedUpTo, latestWP);
  const wcNeedsUpdate = !isCompatibilityCurrent(current.wcTestedUpTo, latestWC);

  if (!wpNeedsUpdate && !wcNeedsUpdate) {
    logger.success('Already compatible with latest versions. Nothing to do.');
    process.exit(0);
  }

  // Step 6: Calculate new version
  const newVersion = semver.inc(currentVersion, 'patch');
  console.log(chalk.gray(`Bumping version: ${currentVersion} → ${chalk.white(newVersion)}`));
  console.log();

  // Step 7: Dry run check
  if (dryRun) {
    console.log(chalk.yellow('Would update:'));
    if (wpNeedsUpdate) {
      console.log(chalk.gray(`  - WordPress tested up to: ${majorMinor(latestWP)}`));
    }
    if (wcNeedsUpdate) {
      console.log(chalk.gray(`  - WooCommerce tested up to: ${majorMinor(latestWC)}`));
    }
    console.log(chalk.gray(`  - Version: ${newVersion}`));
    console.log();
    logger.info('Run without --dry-run to apply changes.');
    process.exit(0);
  }

  // Step 8: Update files
  logger.step('Updating files...');

  // Build updates object and changelog entries
  const compatUpdates = {};
  const changelogEntries = [];

  if (wpNeedsUpdate) {
    compatUpdates.testedUpTo = majorMinor(latestWP);
    changelogEntries.push(`Update: Tested up to WordPress ${majorMinor(latestWP)}`);
  }
  if (wcNeedsUpdate) {
    compatUpdates.wcTestedUpTo = majorMinor(latestWC);
    changelogEntries.push(`Update: Tested up to WooCommerce ${majorMinor(latestWC)}`);
  }

  // Update compatibility headers in main plugin file
  await updatePluginCompatibility(mainFilePath, compatUpdates);
  logger.success(`Updated ${config.mainFile}`);

  // Update version in all version files
  const versionResults = await updateVersionInFiles(config, newVersion, false);
  for (const result of versionResults) {
    if (result.updated) {
      logger.success(`Updated ${result.file}`);
    }
  }

  // Update changelog
  await updateChangelog(newVersion, changelogEntries, false);

  console.log();

  // Step 9: Build
  logger.step('Building...');
  try {
    await runBuild(config, false);
    logger.success('Build complete');
  } catch (error) {
    logger.error(`Build failed: ${error.message}`);
    logger.info('Revert changes with: git checkout -- .');
    process.exit(1);
  }

  console.log();

  // Step 10: Deploy to WooCommerce.com
  logger.step('Deploying to WooCommerce.com...');
  try {
    const deployed = await deployToWooCommerce(config, newVersion, false);
    if (deployed) {
      logger.success('Deployed to WooCommerce.com');
    }
  } catch (error) {
    logger.error(`Deploy failed: ${error.message}`);
    logger.info('Local files updated but not committed. Fix and retry with "wc-deploy deploy" or revert.');
    process.exit(1);
  }

  console.log();

  // Step 11: Git commit, tag, push
  logger.step('Committing changes...');

  // Build commit message
  const commitParts = [];
  if (wpNeedsUpdate) commitParts.push(`WordPress ${majorMinor(latestWP)}`);
  if (wcNeedsUpdate) commitParts.push(`WooCommerce ${majorMinor(latestWC)}`);
  const commitMessage = `Compatibility: ${commitParts.join(', ')}`;

  const commitResult = await commitAndTagVersion(newVersion, commitMessage);
  if (!commitResult.success) {
    logger.error(`Failed to commit: ${commitResult.error}`);
    process.exit(1);
  }
  logger.success(`Committed: "${commitMessage}"`);
  logger.success(`Tagged: ${newVersion}`);

  const pushResult = await pushWithTags();
  if (!pushResult.success) {
    logger.error(`Failed to push: ${pushResult.error}`);
    logger.info('Local commit and tag created - push manually.');
    process.exit(1);
  }
  logger.success('Pushed');

  console.log();

  // Step 12: Success
  console.log(chalk.green.bold(`  Successfully released ${newVersion}\n`));
}
