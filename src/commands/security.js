import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { runPhpcsCheck } from './phpcs.js';
import { qitCommand } from './qit.js';

/**
 * Security command - runs local PHPCS security check, then QIT security if passing
 */
export async function securityCommand(options) {
  console.log(chalk.bold.cyan('\n  Security Check\n'));

  // Step 1: Run local PHPCS security check
  logger.step('Running local PHPCS security check...');

  try {
    const phpcsResult = await runPhpcsCheck({
      errorsOnly: true,
      skipIfMissing: false
    });

    if (!phpcsResult) {
      console.log();
      logger.error('Local security check failed. Fix issues before running remote check.');
      process.exit(1);
    }

    logger.success('Local PHPCS security check passed');
    console.log();
  } catch (error) {
    logger.error(`PHPCS check failed: ${error.message}`);
    process.exit(1);
  }

  // Step 2: Run QIT security check
  logger.step('Running QIT remote security check...');
  console.log();

  try {
    await qitCommand('security', {
      skipBuild: options.skipBuild || false,
      wait: true,
      verbose: options.verbose || false
    });
  } catch (error) {
    logger.error(`QIT security check failed: ${error.message}`);
    process.exit(1);
  }
}
