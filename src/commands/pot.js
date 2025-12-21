import chalk from 'chalk';
import { loadConfig } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';
import { generatePotFile, checkPotFile } from '../tasks/pot-generator.js';

/**
 * Generate POT file for translations
 */
export async function potCommand(options) {
  console.log(chalk.bold.cyan('\n  Generating POT File\n'));

  const config = await loadConfig();

  // Show current status
  const potStatus = await checkPotFile(config);

  if (potStatus.textDomain) {
    logger.info(`Text domain: ${chalk.bold(potStatus.textDomain)}`);
  }

  if (potStatus.exists) {
    logger.info(`Existing POT: ${potStatus.path}`);
  }

  console.log();

  try {
    const success = await generatePotFile(config, options.dryRun);

    if (success) {
      console.log(chalk.green('\n  POT file generated successfully!\n'));
    } else {
      console.log(chalk.yellow('\n  POT generation was skipped.\n'));
      console.log(chalk.gray('  Make sure you have:'));
      console.log(chalk.gray('  - WP-CLI installed (https://wp-cli.org/)'));
      console.log(chalk.gray('  - Text Domain defined in your main plugin file'));
      console.log();
    }
  } catch (error) {
    logger.error(`POT generation failed: ${error.message}`);
    process.exit(1);
  }
}
