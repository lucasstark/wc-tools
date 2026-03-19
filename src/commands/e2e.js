import chalk from 'chalk';
import { execa } from 'execa';
import { existsSync } from 'fs';
import { join } from 'path';
import { loadConfig, getCurrentVersion } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';
import { runBuild } from '../tasks/builder.js';

// Available test packages
const TEST_PACKAGES = {
  activation: 'woocommerce/activation:latest',
  ciab: 'woocommerce/ciab:latest',
  performance: 'woocommerce/performance-tests:latest'
};

/**
 * Get the zip path for the extension
 */
function getZipPath(config, version) {
  return join(process.cwd(), 'dist', `${config.slug}.zip`);
}

/**
 * Check if QIT is installed
 */
async function checkQitInstalled() {
  try {
    await execa('qit', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * E2E test command
 */
export async function e2eCommand(options) {
  console.log(chalk.bold.cyan('\n  E2E Testing\n'));

  // Check QIT is installed
  if (!await checkQitInstalled()) {
    logger.error('QIT CLI not found');
    console.log();
    logger.info('Install QIT from: https://qit.woo.com/docs/cli/getting-started');
    process.exit(1);
  }

  // Load config
  const config = await loadConfig();
  const version = await getCurrentVersion();

  logger.info(`Extension: ${chalk.bold(config.slug)}`);
  logger.info(`Version: ${chalk.bold(version)}`);
  console.log();

  // Determine test package
  const packageKey = options.package || 'activation';
  const testPackage = TEST_PACKAGES[packageKey];

  if (!testPackage) {
    logger.error(`Unknown test package: ${packageKey}`);
    logger.info(`Available packages: ${Object.keys(TEST_PACKAGES).join(', ')}`);
    process.exit(1);
  }

  logger.info(`Test package: ${chalk.bold(testPackage)}`);
  console.log();

  // Build if needed
  const zipPath = getZipPath(config, version);

  if (!existsSync(zipPath) && !options.skipBuild) {
    logger.step('Building extension...');
    await runBuild(config, false);
    console.log();
  } else if (!existsSync(zipPath)) {
    logger.error(`Zip not found: ${zipPath}`);
    logger.info('Run without --skip-build to build first');
    process.exit(1);
  }

  // Build QIT command args
  const args = [
    'run:e2e',
    config.slug,
    `--zip=${zipPath}`,
    `--test-package=${testPackage}`
  ];

  // Add optional flags
  if (options.ui) {
    args.push('--ui');
  }

  if (options.debug) {
    args.push('--debug');
  }

  // Show command
  console.log(chalk.gray(`  $ qit ${args.join(' ')}\n`));

  // Run QIT
  logger.step('Running E2E tests...');
  console.log();

  try {
    await execa('qit', args, {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    console.log();
    logger.success('E2E tests completed');
  } catch (error) {
    console.log();
    if (error.exitCode) {
      logger.error(`E2E tests failed (exit code: ${error.exitCode})`);
    } else {
      logger.error(`E2E tests failed: ${error.message}`);
    }
    process.exit(1);
  }
}

/**
 * List available test packages
 */
export async function e2eListCommand() {
  console.log(chalk.bold.cyan('\n  Available E2E Test Packages\n'));

  console.log(chalk.gray('  Package      Description'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(`  ${chalk.cyan('activation')}   Basic activation and deactivation tests`);
  console.log(`  ${chalk.cyan('ciab')}         WooCommerce checkout flow tests`);
  console.log(`  ${chalk.cyan('performance')} Performance benchmark tests`);
  console.log();

  logger.info('Run tests with: wcm e2e --package=<name>');
  console.log();
}
