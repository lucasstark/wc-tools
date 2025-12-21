import { access, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import wpPot from 'wp-pot';
import { logger } from '../utils/logger.js';

/**
 * Extract text domain from main plugin file
 */
async function getTextDomain(mainFile) {
  try {
    const pluginPath = join(process.cwd(), mainFile);
    const content = await readFile(pluginPath, 'utf-8');

    // Match: * Text Domain: wc_wishlist
    const match = content.match(/\*\s*Text Domain:\s*([^\s\n]+)/i);
    return match ? match[1].trim() : null;
  } catch (error) {
    return null;
  }
}

/**
 * Extract domain path from main plugin file
 */
async function getDomainPath(mainFile) {
  try {
    const pluginPath = join(process.cwd(), mainFile);
    const content = await readFile(pluginPath, 'utf-8');

    // Match: * Domain Path: /i18n/languages/
    const match = content.match(/\*\s*Domain Path:\s*([^\s\n]+)/i);
    return match ? match[1].trim() : '/languages/';
  } catch (error) {
    return '/languages/';
  }
}

/**
 * Extract plugin metadata from main plugin file
 */
async function getPluginInfo(mainFile) {
  try {
    const pluginPath = join(process.cwd(), mainFile);
    const content = await readFile(pluginPath, 'utf-8');

    const getName = () => {
      const match = content.match(/\*\s*Plugin Name:\s*([^\n]+)/i);
      return match ? match[1].trim() : null;
    };

    const getAuthor = () => {
      const match = content.match(/\*\s*Author:\s*([^\n]+)/i);
      return match ? match[1].trim() : null;
    };

    const getVersion = () => {
      const match = content.match(/\*\s*Version:\s*([^\s\n]+)/i);
      return match ? match[1].trim() : null;
    };

    return {
      name: getName(),
      author: getAuthor(),
      version: getVersion()
    };
  } catch (error) {
    return { name: null, author: null, version: null };
  }
}

/**
 * Generate POT file using wp-pot (pure Node.js, no WP-CLI needed)
 */
export async function generatePotFile(config, dryRun = false) {
  const textDomain = await getTextDomain(config.mainFile);
  const domainPath = await getDomainPath(config.mainFile);
  const pluginInfo = await getPluginInfo(config.mainFile);

  if (!textDomain) {
    logger.warn('Text Domain not found in plugin file, skipping POT generation');
    return false;
  }

  const potDir = join(process.cwd(), domainPath.replace(/^\//, ''));
  const potFile = join(potDir, `${textDomain}.pot`);

  if (dryRun) {
    logger.info(`Would generate POT file: ${textDomain}.pot`);
    logger.info(`Output path: ${potFile}`);
    return true;
  }

  const spinner = logger.spinner('Generating POT file...');

  try {
    // Ensure the output directory exists
    await mkdir(potDir, { recursive: true });

    // Generate POT file using wp-pot
    wpPot({
      destFile: potFile,
      domain: textDomain,
      package: pluginInfo.name || config.slug,
      src: [
        join(process.cwd(), '**/*.php'),
        '!' + join(process.cwd(), 'node_modules/**'),
        '!' + join(process.cwd(), 'vendor/**'),
        '!' + join(process.cwd(), 'dist/**'),
        '!' + join(process.cwd(), 'tests/**')
      ],
      bugReport: config.bugReportUrl || '',
      lastTranslator: pluginInfo.author || '',
      team: pluginInfo.author || ''
    });

    spinner.succeed(`POT file generated: ${textDomain}.pot`);
    return true;
  } catch (error) {
    spinner.fail('POT file generation failed');
    logger.error(error.message);
    return false;
  }
}

/**
 * Check if POT file exists
 */
export async function checkPotFile(config) {
  const textDomain = await getTextDomain(config.mainFile);
  const domainPath = await getDomainPath(config.mainFile);

  if (!textDomain) {
    return { exists: false, path: null };
  }

  const potDir = join(process.cwd(), domainPath.replace(/^\//, ''));
  const potFile = join(potDir, `${textDomain}.pot`);

  try {
    await access(potFile);
    return { exists: true, path: potFile, textDomain };
  } catch (error) {
    return { exists: false, path: potFile, textDomain };
  }
}
