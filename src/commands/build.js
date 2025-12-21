import chalk from 'chalk';
import { loadConfig } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';
import { runBuild, runLegacyBuild } from '../tasks/builder.js';
import { checkVersionConsistency } from '../utils/version-checker.js';

/**
 * Build distribution package
 */
export async function buildCommand(options) {
  console.log(chalk.bold.cyan('\n  Building Distribution Package\n'));

  const config = await loadConfig();

  // Check version consistency first (like grunt's check-versions task)
  if (!options.skipVersionCheck) {
    const versionCheck = await checkVersionConsistency(config);
    if (!versionCheck.valid) {
      if (!options.force) {
        logger.error('Version mismatch detected. Use --force to build anyway.');
        process.exit(1);
      }
      logger.warn('Continuing despite version mismatch (--force)');
    }
  }

  try {
    // Use legacy build if buildCommand is explicitly set and not using built-in
    if (config.buildCommand && !options.useBuiltin) {
      logger.info('Using configured build command...');
      await runLegacyBuild(config, options.dryRun);
    } else {
      // Use built-in build process
      await runBuild(config, options.dryRun);
    }

    console.log(chalk.green('\n  Build completed successfully!\n'));

    if (options.dryRun) {
      logger.info(chalk.yellow('This was a dry run. No files were modified.'));
    }
  } catch (error) {
    logger.error(`Build failed: ${error.message}`);
    process.exit(1);
  }
}
