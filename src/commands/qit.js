import chalk from 'chalk';
import { execa } from 'execa';
import { access } from 'fs/promises';
import { join } from 'path';
import { loadConfig } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';
import { getCurrentVersion } from '../utils/config-loader.js';

const AVAILABLE_TESTS = ['security', 'activation', 'api', 'e2e', 'phpstan', 'phpcompatibility'];

/**
 * Check deployed version via WooCommerce.com API
 */
export async function qitVersionCommand(options) {
  console.log(chalk.bold.cyan('\n  Deployed Version Check\n'));

  const config = await loadConfig();
  const productId = config.productId;
  const localVersion = await getCurrentVersion();

  if (!productId) {
    logger.error('No productId configured in .deployrc.json');
    process.exit(1);
  }

  console.log(chalk.gray(`  Product ID: ${productId}`));
  console.log(chalk.gray(`  Plugin slug: ${config.slug}\n`));

  try {
    logger.step('Fetching changelog from WooCommerce.com...');

    const url = `https://woocommerce.com/wp-json/wccom/changelog/1.0/product/${productId}`;
    const response = await fetch(url);

    if (!response.ok) {
      logger.error(`API returned ${response.status}: ${response.statusText}`);
      process.exit(1);
    }

    const changelog = await response.text();

    if (options.raw) {
      console.log(changelog);
      return;
    }

    // Parse version entries from changelog text
    // Format: YYYY.MM.DD - version X.Y.Z
    const versionPattern = /(\d{4}\.\d{2}\.\d{2})\s*-\s*version\s+(\d+\.\d+\.\d+)/gi;
    const versions = [];
    let match;

    while ((match = versionPattern.exec(changelog)) !== null) {
      versions.push({ date: match[1], version: match[2] });
    }

    if (versions.length === 0) {
      logger.warn('No version entries found in changelog');
      return;
    }

    const latest = versions[0];

    console.log();
    console.log(chalk.white('  Deployed version info:'));
    console.log(chalk.gray(`    Version:  ${chalk.white(latest.version)}`));
    console.log(chalk.gray(`    Date:     ${chalk.white(latest.date)}`));
    console.log(chalk.gray(`    Local:    ${chalk.white(localVersion)}`));
    console.log();

    if (localVersion === latest.version) {
      logger.success('Local version matches deployed version');
    } else if (localVersion > latest.version) {
      logger.warn(`Local (${localVersion}) is ahead of deployed (${latest.version})`);
    } else {
      logger.error(`Local (${localVersion}) is behind deployed (${latest.version})`);
    }

    // Show recent changelog entries
    if (options.verbose && versions.length > 1) {
      console.log(chalk.white('\n  Recent versions:'));
      versions.slice(0, 5).forEach(entry => {
        console.log(chalk.gray(`    ${entry.date} - version ${entry.version}`));
      });
    }

    console.log();
  } catch (error) {
    logger.error(`Failed to fetch changelog: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Run QIT (Quality Insights Toolkit) tests
 */
export async function qitCommand(testType, options) {
  console.log(chalk.bold.cyan('\n  Running QIT Tests\n'));

  const config = await loadConfig();
  const slug = config.slug;
  const distPath = config.distPath || './dist';
  const zipPath = join(process.cwd(), distPath, `${slug}.zip`);

  // Check if zip exists
  try {
    await access(zipPath);
  } catch (error) {
    logger.error(`Zip file not found: ${zipPath}`);
    logger.info('Run "wc-deploy build" first to create the distribution package.');
    process.exit(1);
  }

  // Determine which tests to run
  let testsToRun = [];

  if (testType === 'all') {
    testsToRun = ['security', 'activation'];
    logger.info('Running all standard tests: security, activation');
  } else if (testType) {
    if (!AVAILABLE_TESTS.includes(testType)) {
      logger.error(`Unknown test type: ${testType}`);
      logger.info(`Available tests: ${AVAILABLE_TESTS.join(', ')}`);
      process.exit(1);
    }
    testsToRun = [testType];
  } else {
    // Default to security test
    testsToRun = ['security'];
  }

  console.log(chalk.gray(`  Plugin: ${slug}`));
  console.log(chalk.gray(`  Zip: ${zipPath}\n`));

  let allPassed = true;

  for (const test of testsToRun) {
    const success = await runQitTest(test, slug, zipPath, options);
    if (!success) {
      allPassed = false;
      if (!options.continueOnError) {
        break;
      }
    }
  }

  console.log();
  if (allPassed) {
    console.log(chalk.green.bold('  All QIT tests passed!\n'));
  } else {
    console.log(chalk.red.bold('  Some QIT tests failed.\n'));
    process.exit(1);
  }
}

/**
 * Run a single QIT test
 */
async function runQitTest(testType, slug, zipPath, options) {
  const spinner = logger.spinner(`Running ${testType} test...`);

  try {
    const args = [
      `run:${testType}`,
      slug,
      `--zip=${zipPath}`
    ];

    // Add --wait unless --no-wait is specified
    if (!options.noWait) {
      args.push('--wait');
    }

    // Add optional flags
    if (options.ignore) {
      args.push(`--ignore-plugin-dependencies=${options.ignore}`);
    }

    const result = await execa('qit', args, {
      stdio: options.verbose ? 'inherit' : 'pipe',
      cwd: process.cwd()
    });

    spinner.succeed(`${testType} test passed`);

    if (!options.verbose && result.stdout) {
      console.log(chalk.gray(result.stdout));
    }

    return true;
  } catch (error) {
    spinner.fail(`${testType} test failed`);

    if (error.stderr) {
      console.log(chalk.red(error.stderr));
    }
    if (error.stdout) {
      console.log(error.stdout);
    }

    return false;
  }
}
