import inquirer from 'inquirer';
import semver from 'semver';
import chalk from 'chalk';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { loadConfig, getCurrentVersion } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';
import { updateVersionInFiles } from '../tasks/version-updater.js';
import { updateChangelog } from '../tasks/changelog-updater.js';
import { gitCommitOnly } from '../tasks/git-manager.js';
import { runBuild } from '../tasks/builder.js';
import { deployToWooCommerce } from '../tasks/deployer.js';
import { getCredentials } from '../utils/env-loader.js';
import { getDeployedVersion } from '../utils/deployed-version.js';
import {
  fetchLatestWordPressVersion,
  fetchLatestWooCommerceVersion,
  parsePluginCompatibility,
  updatePluginCompatibility,
  isCompatibilityCurrent,
  majorMinor
} from '../utils/compatibility.js';
import { runPhpcsCheck } from './phpcs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function deployCommand(options) {
  console.log(chalk.bold.cyan('\n  WooCommerce Extension Deployment\n'));

  // Load configuration
  const config = await loadConfig();
  const currentVersion = await getCurrentVersion();
  const mainFilePath = join(process.cwd(), config.mainFile);

  logger.info(`Plugin: ${chalk.bold(config.slug || 'Unknown')}`);
  logger.info(`Local version: ${chalk.bold(currentVersion)}`);

  // Check deployed version on WooCommerce.com
  let deployedVersion = null;
  if (config.productId) {
    const deployed = await getDeployedVersion(config.productId);
    if (deployed) {
      deployedVersion = deployed.version;
      logger.info(`Deployed version: ${chalk.bold(deployedVersion)} (${deployed.date})`);
    } else {
      logger.info(`Deployed version: ${chalk.gray('unknown')}`);
    }
  }
  console.log();

  // Check compatibility with latest WP/WC versions
  let compatibilityUpdates = null;
  let compatibilityEntries = [];

  try {
    const [latestWP, latestWC] = await Promise.all([
      fetchLatestWordPressVersion(),
      fetchLatestWooCommerceVersion()
    ]);

    const current = await parsePluginCompatibility(mainFilePath);

    const wpNeedsUpdate = !isCompatibilityCurrent(current.testedUpTo, latestWP);
    const wcNeedsUpdate = !isCompatibilityCurrent(current.wcTestedUpTo, latestWC);

    if (wpNeedsUpdate || wcNeedsUpdate) {
      console.log(chalk.yellow('Compatibility update available:'));
      if (wpNeedsUpdate) {
        console.log(chalk.gray(`  WordPress: ${current.testedUpTo || 'not set'} → ${majorMinor(latestWP)}`));
      }
      if (wcNeedsUpdate) {
        console.log(chalk.gray(`  WooCommerce: ${current.wcTestedUpTo || 'not set'} → ${majorMinor(latestWC)}`));
      }
      console.log();

      const { shouldUpdate } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldUpdate',
          message: 'Include compatibility update in this release?',
          default: true
        }
      ]);

      if (shouldUpdate) {
        compatibilityUpdates = {};
        if (wpNeedsUpdate) {
          compatibilityUpdates.testedUpTo = majorMinor(latestWP);
          compatibilityEntries.push(`Update: Tested up to WordPress ${majorMinor(latestWP)}`);
        }
        if (wcNeedsUpdate) {
          compatibilityUpdates.wcTestedUpTo = majorMinor(latestWC);
          compatibilityEntries.push(`Update: Tested up to WooCommerce ${majorMinor(latestWC)}`);
        }
      }
      console.log();
    }
  } catch (error) {
    logger.warn(`Could not check compatibility: ${error.message}`);
    console.log();
  }

  // Run PHPCS check (unless skipped)
  if (!options.skipPhpcs) {
    logger.step('Running PHPCS coding standards check...');
    const phpcsResult = await runPhpcsCheck({ skipIfMissing: true });

    if (!phpcsResult) {
      logger.error('PHPCS check failed - fix coding standards violations before deploying');
      logger.info('Run "wc-deploy phpcs" to see details, or "wc-deploy phpcs --fix" to auto-fix');
      logger.info('Or use --skip-phpcs to bypass this check');
      process.exit(1);
    }
    logger.success('PHPCS check passed');
    console.log();
  }

  // Get version if not provided
  let newVersion = options.version;

  // Determine if current version can be deployed (is it ahead of what's deployed?)
  const canDeployCurrent = deployedVersion && semver.gt(currentVersion, deployedVersion);

  if (!newVersion) {
    // Default to current version if it's ahead of deployed, otherwise suggest patch bump
    const defaultVersion = canDeployCurrent ? currentVersion : semver.inc(currentVersion, 'patch');

    const { version } = await inquirer.prompt([
      {
        type: 'input',
        name: 'version',
        message: canDeployCurrent
          ? `Version to deploy (current ${currentVersion} > deployed ${deployedVersion}):`
          : 'New version number:',
        default: defaultVersion,
        validate: (input) => {
          if (!semver.valid(input)) {
            return 'Please enter a valid semantic version (e.g., 2.3.8)';
          }
          // Must be greater than deployed version (or current if no deployed version known)
          if (deployedVersion) {
            if (semver.lte(input, deployedVersion)) {
              return `Version must be greater than deployed version (${deployedVersion})`;
            }
          } else {
            // No deployed version known - use current as baseline
            if (semver.lt(input, currentVersion)) {
              return `Version must be at least current version (${currentVersion})`;
            }
          }
          return true;
        }
      }
    ]);
    newVersion = version;
  }

  // Get changelog entry (optional if deploying current version)
  const isRedeploying = newVersion === currentVersion;
  let changelogEntry;

  if (isRedeploying) {
    const { entry } = await inquirer.prompt([
      {
        type: 'input',
        name: 'entry',
        message: 'Changelog entry (optional, press Enter to skip):',
        default: ''
      }
    ]);
    changelogEntry = entry;
  } else {
    const { entry } = await inquirer.prompt([
      {
        type: 'input',
        name: 'entry',
        message: 'Changelog entry:',
        validate: (input) => input.trim().length > 0 || 'Changelog entry is required'
      }
    ]);
    changelogEntry = entry;
  }

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

  // Check if we're deploying current version (no bump)
  const isCurrentVersion = newVersion === currentVersion;

  try {
    // Step 1: Update compatibility headers (if applicable)
    if (compatibilityUpdates) {
      logger.step('Updating compatibility headers...');
      if (!dryRun) {
        await updatePluginCompatibility(mainFilePath, compatibilityUpdates);
      }
      logger.success('Updated compatibility headers');
    }

    // Step 2: Update version numbers (skip if deploying current version)
    if (!isCurrentVersion) {
      logger.step('Updating version numbers...');
      const versionResults = await updateVersionInFiles(config, newVersion, dryRun);

      if (versionResults.every(r => !r.updated)) {
        logger.error('No files were updated. Check your .deployrc.json configuration.');
        process.exit(1);
      }

      // Step 3: Update changelog (include compatibility entries if any)
      logger.step('Updating changelog...');
      const allChangelogEntries = [...compatibilityEntries, changelogEntry].filter(e => e);
      await updateChangelog(newVersion, allChangelogEntries, dryRun);
    } else {
      logger.info(`Deploying existing version ${currentVersion} (no version bump)`);
      // Update changelog if there are compatibility entries or a new changelog entry
      const allChangelogEntries = [...compatibilityEntries, changelogEntry].filter(e => e);
      if (allChangelogEntries.length > 0) {
        logger.step('Updating changelog...');
        await updateChangelog(newVersion, allChangelogEntries, dryRun);
      }
    }

    // Step 4: Build (generates POT, minified CSS, zip)
    if (!options.skipBuild) {
      logger.step('Building distribution package...');
      await runBuild(config, dryRun);
    } else {
      logger.info('Skipping build step');
    }

    // Step 5: Git commit - always commit after build since build generates files (POT, CSS)
    // This is the "deploy candidate" commit - tag happens manually after deployment succeeds
    logger.step('Creating deploy candidate commit...');
    const commitMsg = changelogEntry || `Deploy version ${newVersion}`;
    await gitCommitOnly(newVersion, commitMsg, dryRun);

    // Step 6: Deploy to WooCommerce.com (if not skipped)
    if (!options.skipDeploy) {
      logger.step('Deploying to WooCommerce.com...');
      const deployResult = await deployToWooCommerce(config, newVersion, dryRun);

      if (deployResult && !dryRun) {
        // Spawn background monitor to watch for completion
        logger.step('Starting deployment monitor...');
        spawnDeployMonitor(config, newVersion, changelogEntry);

        console.log(chalk.green.bold('\n✨ Deployment initiated!\n'));
        logger.info('A background process is monitoring the deployment.');
        logger.info('You will receive a notification when complete.');
        console.log();
        logger.info(chalk.gray('To check status: es status'));
        console.log();
        logger.info('After deployment succeeds, tag and push:');
        console.log(chalk.cyan(`  git tag ${newVersion}`));
        console.log(chalk.cyan('  git push && git push --tags'));

        // Exit explicitly to avoid hanging on any lingering handles
        process.exit(0);
      }
    } else {
      logger.info('Skipping WooCommerce.com deployment');
      logger.info('Commit created but not tagged or pushed.');
      logger.info('Tag manually when ready:');
      logger.info(`  git tag ${newVersion}`);
      logger.info('  git push && git push --tags');
    }

    if (dryRun) {
      console.log();
      logger.info(chalk.yellow('This was a dry run. Run without --dry-run to apply changes.'));
    }
  } catch (error) {
    logger.error(`Deployment failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Spawn background monitor process
 */
function spawnDeployMonitor(config, version, commitMessage) {
  const credentials = getCredentials();

  const monitorConfig = {
    productId: config.productId,
    version,
    slug: config.slug,
    credentials: {
      username: credentials.username,
      password: credentials.password,
      apiUrl: credentials.apiUrl
    },
    workingDir: process.cwd(),
    commitMessage
  };

  const configBase64 = Buffer.from(JSON.stringify(monitorConfig)).toString('base64');
  const monitorPath = join(__dirname, '../monitor/deploy-monitor.js');

  // Spawn detached process
  const child = spawn('node', [monitorPath, configBase64], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd()
  });

  // Unref to allow parent to exit
  child.unref();

  logger.success(`Monitor started (PID: ${child.pid})`);
}
