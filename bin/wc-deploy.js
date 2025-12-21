#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import { deployCommand } from '../src/commands/deploy.js';
import { versionCommand } from '../src/commands/version.js';
import { buildCommand } from '../src/commands/build.js';
import { statusCommand } from '../src/commands/status.js';
import { initCommand } from '../src/commands/init.js';
import { potCommand } from '../src/commands/pot.js';
import { qitCommand, qitVersionCommand } from '../src/commands/qit.js';
import { syncCommand } from '../src/commands/sync.js';
import { phpcsCommand } from '../src/commands/phpcs.js';

program
  .name('es')
  .description('Element Stark CLI - Build and deploy WooCommerce extensions')
  .version('1.0.0');

// Init command
program
  .command('init')
  .description('Initialize a new .deployrc.json configuration file')
  .option('-f, --force', 'Overwrite existing config without prompting')
  .action(initCommand);

// Build command
program
  .command('build')
  .description('Build the distribution package (CSS minify, POT generation, zip)')
  .option('--dry-run', 'Simulate without making changes')
  .option('--skip-version-check', 'Skip version consistency check')
  .option('--use-builtin', 'Force use of built-in build tasks instead of buildCommand')
  .option('-f, --force', 'Continue even if version check fails')
  .action(buildCommand);

// POT command
program
  .command('pot')
  .description('Generate POT file for translations')
  .option('--dry-run', 'Simulate without making changes')
  .action(potCommand);

// PHPCS command
program
  .command('phpcs')
  .description('Run PHP CodeSniffer security check (escaping, sanitization, SQL)')
  .option('--fix', 'Auto-fix issues using PHPCBF')
  .option('--full', 'Use full WooCommerce-Core standards instead of security-only')
  .option('--errors-only', 'Show only errors, not warnings')
  .option('--path <path>', 'Specific file or directory to scan')
  .action(phpcsCommand);

// QIT command
program
  .command('qit [testType]')
  .description('Run QIT tests or check deployed version. Use "qit version" to check WooCommerce.com, or test types: security, activation, api, e2e, phpstan, all')
  .option('--no-wait', 'Do not wait for test results')
  .option('--verbose', 'Show full test output (or show recent changelog for version)')
  .option('--continue-on-error', 'Continue running tests even if one fails')
  .option('--ignore <plugins>', 'Ignore plugin dependencies (comma-separated)')
  .option('--raw', 'Output raw JSON (for version command)')
  .action((testType, options) => {
    if (testType === 'version') {
      return qitVersionCommand(options);
    }
    return qitCommand(testType, options);
  });

// Sync command
program
  .command('sync')
  .description('Quick compatibility update - check WP/WC versions, bump patch, build, deploy, commit, push')
  .option('--dry-run', 'Preview changes without executing')
  .option('--skip-phpcs', 'Skip PHPCS coding standards check')
  .action(syncCommand);

// Version command
program
  .command('version [newVersion]')
  .description('Update version numbers. Interactive prompt if no version specified.')
  .option('--dry-run', 'Simulate without making changes')
  .option('-f, --force', 'Skip sanity checks and prompts')
  .option('-m, --message <entry>', 'Changelog entry (can be used multiple times)', (val, acc) => { acc.push(val); return acc; }, [])
  .action(versionCommand);

// Deploy command
program
  .command('deploy')
  .description('Full deployment: version bump, build, git tag, and deploy to WooCommerce.com')
  .option('-v, --version <version>', 'Version number (e.g., 2.3.8)')
  .option('--skip-phpcs', 'Skip PHPCS coding standards check')
  .option('--skip-tests', 'Skip QIT tests')
  .option('--skip-build', 'Skip build step')
  .option('--skip-deploy', 'Skip deployment to WooCommerce.com')
  .option('--dry-run', 'Simulate without making changes')
  .action(deployCommand);

// Status command
program
  .command('status')
  .description('Check WooCommerce.com deployment status')
  .action(statusCommand);

// Handle unknown commands
program.on('command:*', function () {
  console.error(chalk.red(`\nInvalid command: ${program.args.join(' ')}`));
  console.log(chalk.yellow('\nAvailable commands:'));
  console.log(chalk.cyan('  init     ') + chalk.gray('Initialize .deployrc.json'));
  console.log(chalk.cyan('  build    ') + chalk.gray('Build distribution package'));
  console.log(chalk.cyan('  pot      ') + chalk.gray('Generate POT file'));
  console.log(chalk.cyan('  phpcs    ') + chalk.gray('Run PHP CodeSniffer with WooCommerce standards'));
  console.log(chalk.cyan('  qit      ') + chalk.gray('Run QIT tests (use "qit version" to check deployed version)'));
  console.log(chalk.cyan('  sync     ') + chalk.gray('Quick WP/WC compatibility update'));
  console.log(chalk.cyan('  version  ') + chalk.gray('Update version numbers'));
  console.log(chalk.cyan('  deploy   ') + chalk.gray('Full deployment workflow'));
  console.log(chalk.cyan('  status   ') + chalk.gray('Check deployment status'));
  console.log(chalk.yellow('\nSee --help for more details.\n'));
  process.exit(1);
});

program.parse();
