import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from the wc-deploy package root (two levels up from src/utils/)
const envPath = join(__dirname, '..', '..', '.env');

export function loadEnv() {
  // Suppress dotenv debug output
  const originalDebug = process.env.DEBUG;
  process.env.DOTENV_CONFIG_DEBUG = 'false';

  const result = config({ path: envPath, debug: false });

  if (result.error) {
    console.warn(chalk.yellow('\n⚠ No .env file found in wc-deploy directory'));
    console.log(chalk.yellow('Create one at:'), envPath);
    console.log(chalk.yellow('See .env.example for template\n'));
  }

  return result;
}

export function getCredentials() {
  loadEnv();

  const username = process.env.WC_USERNAME;
  const password = process.env.WC_APP_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'WooCommerce.com credentials not found. ' +
      `Please set WC_USERNAME and WC_APP_PASSWORD in ${envPath}`
    );
  }

  return {
    username,
    password,
    apiUrl: process.env.WC_API_URL || 'https://woocommerce.com/wp-json/wc/submission/runner/v1'
  };
}
