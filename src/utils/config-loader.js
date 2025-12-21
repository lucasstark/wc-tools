import { readFile, access } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';

const DEFAULT_CONFIG = {
  versionFiles: [
    {
      file: 'package.json',
      pattern: '"version": "{{version}}"'
    }
  ],
  // No buildCommand by default - uses built-in tasks
  // Set buildCommand explicitly to use a custom build script
  minifyCss: true,
  generatePot: true,
  testCommands: {},
  distPath: './dist'
};

/**
 * Load deployment configuration from .deployrc.json in current directory
 */
export async function loadConfig() {
  const configPath = join(process.cwd(), '.deployrc.json');

  try {
    await access(configPath);
    const configData = await readFile(configPath, 'utf-8');
    const config = JSON.parse(configData);

    // Merge with defaults
    return {
      ...DEFAULT_CONFIG,
      ...config
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(chalk.red('\n✖ No .deployrc.json found in current directory'));
      console.log(chalk.yellow('\nRun this command from a WooCommerce extension directory.'));
      console.log(chalk.yellow('Or create a .deployrc.json file with:'));
      console.log(chalk.cyan('\n  wc-deploy init\n'));
      process.exit(1);
    }

    console.error(chalk.red('\n✖ Error reading .deployrc.json:'), error.message);
    process.exit(1);
  }
}

/**
 * Get current version from package.json
 */
export async function getCurrentVersion() {
  try {
    const packagePath = join(process.cwd(), 'package.json');
    const packageData = await readFile(packagePath, 'utf-8');
    const pkg = JSON.parse(packageData);
    return pkg.version || '0.0.0';
  } catch (error) {
    return '0.0.0';
  }
}
