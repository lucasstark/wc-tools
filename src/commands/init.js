import { readFile, writeFile, access } from 'fs/promises';
import { join, basename } from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';

/**
 * Initialize a new .deployrc.json in the current directory
 */
export async function initCommand(options) {
  console.log(chalk.bold.cyan('\n  WC Deploy - Project Setup\n'));

  const cwd = process.cwd();
  const configPath = join(cwd, '.deployrc.json');

  // Check if config already exists
  try {
    await access(configPath);
    if (!options.force) {
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: '.deployrc.json already exists. Overwrite?',
          default: false
        }
      ]);

      if (!overwrite) {
        logger.info('Initialization cancelled');
        return;
      }
    }
  } catch (error) {
    // File doesn't exist, continue
  }

  // Try to detect plugin info from existing files
  const detected = await detectPluginInfo(cwd);

  // Gather configuration through prompts
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'productId',
      message: 'WooCommerce.com Product ID:',
      default: detected.productId || '',
      validate: input => input.trim().length > 0 || 'Product ID is required'
    },
    {
      type: 'input',
      name: 'slug',
      message: 'Plugin slug:',
      default: detected.slug || basename(cwd),
      validate: input => input.trim().length > 0 || 'Slug is required'
    },
    {
      type: 'input',
      name: 'mainFile',
      message: 'Main plugin file:',
      default: detected.mainFile || `${basename(cwd)}.php`,
      validate: input => input.endsWith('.php') || 'Must be a .php file'
    },
    {
      type: 'confirm',
      name: 'minifyCss',
      message: 'Enable CSS minification?',
      default: true
    },
    {
      type: 'confirm',
      name: 'generatePot',
      message: 'Enable POT file generation?',
      default: true
    },
    {
      type: 'input',
      name: 'exclude',
      message: 'Additional files/folders to exclude (comma-separated):',
      default: '',
      filter: input => input.split(',').map(s => s.trim()).filter(s => s.length > 0)
    }
  ]);

  // Build version files config
  const versionFiles = [
    {
      file: answers.mainFile,
      pattern: ' * Version: {{version}}'
    }
  ];

  // Check if package.json exists and add it
  try {
    await access(join(cwd, 'package.json'));
    versionFiles.push({
      file: 'package.json',
      pattern: '"version": "{{version}}"'
    });
  } catch (error) {
    // No package.json
  }

  // Build the config object
  const config = {
    productId: answers.productId,
    slug: answers.slug,
    mainFile: answers.mainFile,
    versionFiles,
    minifyCss: answers.minifyCss,
    generatePot: answers.generatePot,
    distPath: './dist'
  };

  // Add exclude if specified
  if (answers.exclude.length > 0) {
    config.exclude = answers.exclude;
  }

  // Write config file
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  console.log();
  logger.success('Created .deployrc.json');
  console.log();
  console.log(chalk.gray('  Configuration:'));
  console.log(chalk.gray('  ' + '-'.repeat(40)));
  console.log(chalk.cyan(`  Product ID:   ${config.productId}`));
  console.log(chalk.cyan(`  Slug:         ${config.slug}`));
  console.log(chalk.cyan(`  Main file:    ${config.mainFile}`));
  console.log(chalk.cyan(`  CSS minify:   ${config.minifyCss ? 'enabled' : 'disabled'}`));
  console.log(chalk.cyan(`  POT generate: ${config.generatePot ? 'enabled' : 'disabled'}`));
  console.log();
  console.log(chalk.green('  Ready to use! Run:'));
  console.log(chalk.white('    wc-deploy build    ') + chalk.gray('# Build distribution package'));
  console.log(chalk.white('    wc-deploy deploy   ') + chalk.gray('# Full deployment workflow'));
  console.log();
}

/**
 * Try to detect plugin info from existing files
 */
async function detectPluginInfo(cwd) {
  const info = {
    productId: null,
    slug: null,
    mainFile: null
  };

  // Try to find main plugin file
  const dirName = basename(cwd);
  const possibleMainFiles = [
    `${dirName}.php`,
    'plugin.php',
    'index.php'
  ];

  for (const file of possibleMainFiles) {
    try {
      const content = await readFile(join(cwd, file), 'utf-8');
      if (content.includes('Plugin Name:')) {
        info.mainFile = file;
        info.slug = dirName;
        break;
      }
    } catch (error) {
      // File doesn't exist, continue
    }
  }

  // Try to read existing .deployrc.json for product ID
  try {
    const existing = await readFile(join(cwd, '.deployrc.json'), 'utf-8');
    const parsed = JSON.parse(existing);
    info.productId = parsed.productId;
    info.slug = parsed.slug || info.slug;
    info.mainFile = parsed.mainFile || info.mainFile;
  } catch (error) {
    // No existing config
  }

  // Try to read package.json for slug
  try {
    const pkg = await readFile(join(cwd, 'package.json'), 'utf-8');
    const parsed = JSON.parse(pkg);
    if (parsed.name && !info.slug) {
      info.slug = parsed.name;
    }
  } catch (error) {
    // No package.json
  }

  return info;
}
