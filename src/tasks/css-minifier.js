import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { glob } from 'glob';
import CleanCSS from 'clean-css';
import { logger } from '../utils/logger.js';

/**
 * Minify CSS files in the project
 * Looks for .css files (excluding .min.css) and creates .min.css versions
 */
export async function minifyCssFiles(config, dryRun = false) {
  const cssDir = config.cssPath || 'assets/css';
  const cssPath = join(process.cwd(), cssDir);

  // Find all CSS files except already minified ones
  const pattern = join(cssPath, '**/*.css').replace(/\\/g, '/');
  const files = await glob(pattern, {
    ignore: ['**/*.min.css'],
    nodir: true
  });

  if (files.length === 0) {
    logger.info(`No CSS files found in ${cssDir}`);
    return { success: true, files: [] };
  }

  if (dryRun) {
    logger.info(`Would minify ${files.length} CSS file(s):`);
    files.forEach(f => logger.info(`  - ${basename(f)}`));
    return { success: true, files, dryRun: true };
  }

  const spinner = logger.spinner(`Minifying ${files.length} CSS file(s)...`);
  const results = [];
  const cleanCss = new CleanCSS({
    level: 2,
    sourceMap: false
  });

  try {
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      const minified = cleanCss.minify(content);

      if (minified.errors.length > 0) {
        logger.warn(`Errors minifying ${basename(file)}: ${minified.errors.join(', ')}`);
        results.push({ file, success: false, errors: minified.errors });
        continue;
      }

      // Write minified version
      const minPath = file.replace(/\.css$/, '.min.css');
      await writeFile(minPath, minified.styles, 'utf-8');

      results.push({
        file,
        minFile: minPath,
        success: true,
        originalSize: content.length,
        minifiedSize: minified.styles.length,
        savings: Math.round((1 - minified.styles.length / content.length) * 100)
      });
    }

    const successful = results.filter(r => r.success);
    spinner.succeed(`Minified ${successful.length}/${files.length} CSS file(s)`);

    // Show savings summary
    if (successful.length > 0) {
      const totalOriginal = successful.reduce((sum, r) => sum + r.originalSize, 0);
      const totalMinified = successful.reduce((sum, r) => sum + r.minifiedSize, 0);
      const totalSavings = Math.round((1 - totalMinified / totalOriginal) * 100);
      logger.info(`  Total savings: ${totalSavings}% (${formatBytes(totalOriginal)} → ${formatBytes(totalMinified)})`);
    }

    return { success: true, results };
  } catch (error) {
    spinner.fail('CSS minification failed');
    throw new Error(`CSS minification failed: ${error.message}`);
  }
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
