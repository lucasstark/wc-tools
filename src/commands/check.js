import chalk from 'chalk';
import { fetchLatestWordPressVersion, fetchLatestWooCommerceVersion } from '../utils/compatibility.js';
import { logger } from '../utils/logger.js';

/**
 * Check command - displays latest WordPress and WooCommerce versions
 */
export async function checkCommand() {
  console.log(chalk.bold.cyan('\n  Version Check\n'));

  try {
    // Fetch both versions in parallel
    const [wpVersion, wcVersion] = await Promise.all([
      fetchLatestWordPressVersion(),
      fetchLatestWooCommerceVersion()
    ]);

    console.log(chalk.gray('  Latest versions:\n'));
    console.log(`    WordPress:   ${chalk.green.bold(wpVersion)}`);
    console.log(`    WooCommerce: ${chalk.green.bold(wcVersion)}`);
    console.log();

    // Show the header format for easy copy/paste
    console.log(chalk.gray('  Plugin header format:\n'));
    console.log(chalk.white(`    * Tested up to: ${wpVersion}`));
    console.log(chalk.white(`    * WC tested up to: ${wcVersion}`));
    console.log();

  } catch (error) {
    logger.error(`Failed to fetch versions: ${error.message}`);
    process.exit(1);
  }
}
