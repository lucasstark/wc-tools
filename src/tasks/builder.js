import { execa } from 'execa';
import { access } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { minifyCssFiles } from './css-minifier.js';
import { generatePotFile } from './pot-generator.js';
import { buildDistributionZip, validateZip } from './zip-builder.js';

/**
 * Run the complete build process using built-in tasks
 * This replaces the need for grunt in individual plugins
 */
export async function runBuild(config, dryRun = false) {
  console.log();

  // Step 1: CSS Minification (if enabled)
  if (config.minifyCss !== false) {
    logger.step('Minifying CSS files...');
    try {
      await minifyCssFiles(config, dryRun);
    } catch (error) {
      logger.warn(`CSS minification skipped: ${error.message}`);
    }
  }

  // Step 2: Generate POT file (if enabled)
  if (config.generatePot !== false) {
    logger.step('Generating POT file...');
    try {
      await generatePotFile(config, dryRun);
    } catch (error) {
      logger.warn(`POT generation skipped: ${error.message}`);
    }
  }

  // Step 3: Run custom pre-build command if specified
  if (config.preBuildCommand) {
    logger.step('Running pre-build command...');
    await runCommand(config.preBuildCommand, dryRun);
  }

  // Step 4: Build distribution zip
  logger.step('Building distribution package...');
  const result = await buildDistributionZip(config, null, dryRun);

  if (!dryRun && result.zipPath) {
    const valid = await validateZip(result.zipPath);
    if (!valid) {
      throw new Error('Generated zip file appears to be invalid or empty');
    }
  }

  return result;
}

/**
 * Run the legacy build command (for backward compatibility)
 * Use this when buildCommand is explicitly set in config
 */
export async function runLegacyBuild(config, dryRun = false) {
  if (!config.buildCommand) {
    logger.warn('No build command configured, skipping legacy build');
    return;
  }

  if (dryRun) {
    logger.info(`Would run: ${config.buildCommand}`);
    return;
  }

  const spinner = logger.spinner('Running build command...');

  try {
    // Parse command and args
    const parts = config.buildCommand.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const command = parts[0];
    const args = parts.slice(1).map(arg => arg.replace(/^"|"$/g, ''));

    await execa(command, args, {
      stdio: 'inherit',
      cwd: process.cwd(),
      shell: true
    });

    spinner.succeed('Build command completed');
  } catch (error) {
    spinner.fail('Build command failed');
    throw new Error(`Build command failed: ${error.message}`);
  }
}

/**
 * Run a shell command
 */
async function runCommand(command, dryRun = false) {
  if (dryRun) {
    logger.info(`Would run: ${command}`);
    return;
  }

  const spinner = logger.spinner(`Running: ${command}`);

  try {
    await execa(command, {
      stdio: 'inherit',
      cwd: process.cwd(),
      shell: true
    });

    spinner.succeed('Command completed');
  } catch (error) {
    spinner.fail('Command failed');
    throw new Error(`Command failed: ${error.message}`);
  }
}

/**
 * Check if dist directory exists and has content
 */
export async function validateBuild(config) {
  try {
    const distPath = join(process.cwd(), config.distPath || './dist');
    await access(distPath);
    return true;
  } catch (error) {
    return false;
  }
}
