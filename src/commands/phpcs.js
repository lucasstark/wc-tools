import chalk from 'chalk';
import { execa } from 'execa';
import { access, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import inquirer from 'inquirer';
import { loadConfig } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';

/**
 * Check if a command exists
 */
async function commandExists(cmd, args = ['--version']) {
  try {
    await execa(cmd, args, { timeout: 10000 });
    return true;
  } catch (error) {
    return error.code !== 'ENOENT';
  }
}

/**
 * Check if file exists
 */
async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the phpcs binary path
 */
async function getPhpcsBinary() {
  const localPath = join(process.cwd(), 'vendor/bin/phpcs');

  if (await fileExists(localPath)) {
    return localPath;
  }

  // Check if globally available
  if (await commandExists('phpcs')) {
    return 'phpcs';
  }

  return null;
}

/**
 * Check if WooCommerce sniffs are installed
 */
async function hasWooCommerceSniffs() {
  const sniffsPath = join(process.cwd(), 'vendor/woocommerce/woocommerce-sniffs');
  return await fileExists(sniffsPath);
}

/**
 * Check if composer is available
 */
async function hasComposer() {
  return await commandExists('composer');
}

/**
 * Install WooCommerce sniffs via composer
 */
async function installSniffs() {
  const spinner = logger.spinner('Installing woocommerce/woocommerce-sniffs...');

  try {
    await execa('composer', ['require', '--dev', 'woocommerce/woocommerce-sniffs'], {
      timeout: 300000, // 5 minutes
      cwd: process.cwd()
    });
    spinner.succeed('WooCommerce sniffs installed');
    return true;
  } catch (error) {
    spinner.fail('Failed to install WooCommerce sniffs');
    logger.error(error.message);
    return false;
  }
}

/**
 * Generate a default phpcs.xml file
 */
async function generatePhpcsConfig(config) {
  const textDomain = config.slug || 'my-plugin';
  const minWpVersion = '6.0';
  const phpVersion = '7.4-';

  const xmlContent = `<?xml version="1.0"?>
<ruleset name="WooCommerce Extension Coding Standards">
    <description>PHPCS ruleset for ${config.slug || 'WooCommerce extension'}</description>

    <!-- What to scan -->
    <file>.</file>

    <!-- Exclude paths -->
    <exclude-pattern>*/vendor/*</exclude-pattern>
    <exclude-pattern>*/node_modules/*</exclude-pattern>
    <exclude-pattern>*/.dist/*</exclude-pattern>
    <exclude-pattern>*/dist/*</exclude-pattern>
    <exclude-pattern>*/tests/*</exclude-pattern>
    <exclude-pattern>*/assets/*</exclude-pattern>
    <exclude-pattern>*/*.min.js</exclude-pattern>

    <!-- Configs -->
    <config name="minimum_supported_wp_version" value="${minWpVersion}" />
    <config name="testVersion" value="${phpVersion}" />

    <!-- Rules -->
    <rule ref="WooCommerce-Core" />

    <rule ref="WordPress.WP.I18n">
        <properties>
            <property name="text_domain" type="array" value="${textDomain}" />
        </properties>
    </rule>

    <rule ref="PHPCompatibility">
        <exclude-pattern>tests/</exclude-pattern>
    </rule>

    <!-- Allow short array syntax -->
    <rule ref="Generic.Arrays.DisallowShortArraySyntax.Found">
        <severity>0</severity>
    </rule>
</ruleset>
`;

  await writeFile(join(process.cwd(), 'phpcs.xml'), xmlContent, 'utf-8');
  logger.success('Created phpcs.xml');
}

/**
 * Run PHPCS command
 */
export async function phpcsCommand(options) {
  console.log(chalk.bold.cyan('\n  PHP CodeSniffer - WooCommerce Standards\n'));

  const config = await loadConfig();

  // Check for phpcs binary
  const phpcs = await getPhpcsBinary();

  if (!phpcs) {
    logger.error('PHPCS not found');
    console.log();
    logger.info('Install via composer:');
    console.log(chalk.gray('  composer require --dev woocommerce/woocommerce-sniffs'));
    console.log();
    process.exit(1);
  }

  // Check for WooCommerce sniffs
  if (!await hasWooCommerceSniffs()) {
    logger.warn('WooCommerce sniffs not installed');
    console.log();

    if (await hasComposer()) {
      const { install } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'install',
          message: 'Install woocommerce/woocommerce-sniffs now?',
          default: true
        }
      ]);

      if (install) {
        const success = await installSniffs();
        if (!success) {
          process.exit(1);
        }
        console.log();
      } else {
        process.exit(1);
      }
    } else {
      logger.info('Install manually:');
      console.log(chalk.gray('  composer require --dev woocommerce/woocommerce-sniffs'));
      process.exit(1);
    }
  }

  // Check for phpcs.xml config
  const hasConfig = await fileExists(join(process.cwd(), 'phpcs.xml')) ||
                    await fileExists(join(process.cwd(), 'phpcs.xml.dist'));

  if (!hasConfig && !options.noConfig) {
    logger.warn('No phpcs.xml found');
    console.log();

    const { generate } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'generate',
        message: 'Generate a phpcs.xml config file?',
        default: true
      }
    ]);

    if (generate) {
      await generatePhpcsConfig(config);
      console.log();
    }
  }

  // Build phpcs arguments
  const args = [];

  // If no config file, use WooCommerce-Core standard
  if (!hasConfig && !await fileExists(join(process.cwd(), 'phpcs.xml'))) {
    args.push('--standard=WooCommerce-Core');
  }

  // Add common options
  if (options.fix) {
    // Use phpcbf for fixing
    const phpcbf = phpcs.replace('phpcs', 'phpcbf');
    return await runPhpcbf(phpcbf, options);
  }

  // Report format
  args.push('--report=full');

  // Colors
  args.push('--colors');

  // Show only errors (not warnings) if specified
  if (options.errorsOnly) {
    args.push('-n');
  }

  // File or directory to scan
  const target = options.path || '.';
  args.push(target);

  // Extensions to check
  args.push('--extensions=php');

  // Exclusions if no config file
  if (!hasConfig && !await fileExists(join(process.cwd(), 'phpcs.xml'))) {
    args.push('--ignore=vendor/*,node_modules/*,dist/*,.dist/*,tests/*');
  }

  console.log(chalk.gray(`Running: ${phpcs} ${args.join(' ')}\n`));

  try {
    const result = await execa(phpcs, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      reject: false
    });

    console.log();

    if (result.exitCode === 0) {
      logger.success('No coding standards violations found!');
      return { success: true, exitCode: 0 };
    } else if (result.exitCode === 1) {
      logger.error('Coding standards violations found');
      logger.info('Run with --fix to auto-fix some issues');
      return { success: false, exitCode: 1 };
    } else if (result.exitCode === 2) {
      logger.error('Fixable coding standards violations found');
      logger.info('Run with --fix to auto-fix these issues');
      return { success: false, exitCode: 2 };
    } else {
      logger.error(`PHPCS exited with code ${result.exitCode}`);
      return { success: false, exitCode: result.exitCode };
    }
  } catch (error) {
    logger.error(`PHPCS failed: ${error.message}`);
    return { success: false, exitCode: 1 };
  }
}

/**
 * Run PHPCBF to auto-fix issues
 */
async function runPhpcbf(phpcbf, options) {
  console.log(chalk.yellow('Running PHPCBF to auto-fix issues...\n'));

  const args = [];
  const target = options.path || '.';
  args.push(target);
  args.push('--extensions=php');

  // Check if config exists
  const hasConfig = await fileExists(join(process.cwd(), 'phpcs.xml')) ||
                    await fileExists(join(process.cwd(), 'phpcs.xml.dist'));

  if (!hasConfig) {
    args.push('--standard=WooCommerce-Core');
    args.push('--ignore=vendor/*,node_modules/*,dist/*,.dist/*,tests/*');
  }

  try {
    const result = await execa(phpcbf, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      reject: false
    });

    console.log();

    if (result.exitCode === 0) {
      logger.success('No fixable issues found');
      return { success: true, exitCode: 0 };
    } else if (result.exitCode === 1) {
      logger.success('Fixed some coding standards issues');
      logger.info('Review the changes and run phpcs again');
      return { success: true, exitCode: 1 };
    } else if (result.exitCode === 2) {
      logger.warn('Some issues could not be auto-fixed');
      return { success: false, exitCode: 2 };
    } else {
      logger.error(`PHPCBF exited with code ${result.exitCode}`);
      return { success: false, exitCode: result.exitCode };
    }
  } catch (error) {
    logger.error(`PHPCBF failed: ${error.message}`);
    return { success: false, exitCode: 1 };
  }
}

/**
 * Run PHPCS as part of deploy/sync (non-interactive)
 * Returns true if passed, false if failed
 */
export async function runPhpcsCheck(options = {}) {
  const phpcs = await getPhpcsBinary();

  if (!phpcs) {
    if (options.skipIfMissing) {
      logger.warn('PHPCS not available, skipping code standards check');
      return true;
    }
    return false;
  }

  if (!await hasWooCommerceSniffs()) {
    if (options.skipIfMissing) {
      logger.warn('WooCommerce sniffs not installed, skipping code standards check');
      return true;
    }
    return false;
  }

  const args = ['--report=summary', '--extensions=php'];

  const hasConfig = await fileExists(join(process.cwd(), 'phpcs.xml')) ||
                    await fileExists(join(process.cwd(), 'phpcs.xml.dist'));

  if (!hasConfig) {
    args.push('--standard=WooCommerce-Core');
    args.push('--ignore=vendor/*,node_modules/*,dist/*,.dist/*,tests/*');
  }

  args.push('.');

  try {
    const result = await execa(phpcs, args, {
      cwd: process.cwd(),
      reject: false
    });

    if (result.exitCode === 0) {
      return true;
    } else {
      // Show the summary
      if (result.stdout) {
        console.log(result.stdout);
      }
      return false;
    }
  } catch (error) {
    logger.error(`PHPCS check failed: ${error.message}`);
    return false;
  }
}
