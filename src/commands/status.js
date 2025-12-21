import chalk from 'chalk';
import { loadConfig } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';
import { checkDeploymentStatus } from '../tasks/deployer.js';

export async function statusCommand() {
  console.log(chalk.bold.cyan('\n📊 Deployment Status\n'));

  const config = await loadConfig();

  try {
    await checkDeploymentStatus(config);
  } catch (error) {
    logger.error(`Failed to check status: ${error.message}`);
    process.exit(1);
  }
}
