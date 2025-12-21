import { readFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { getCredentials } from '../utils/env-loader.js';

/**
 * Deploy to WooCommerce.com
 */
export async function deployToWooCommerce(config, version, dryRun = false) {
  if (!config.productId || config.productId === 'YOUR_PRODUCT_ID_HERE') {
    logger.warn('Product ID not configured in .deployrc.json, skipping WooCommerce.com deployment');
    return false;
  }

  if (dryRun) {
    logger.info('Would deploy to WooCommerce.com');
    logger.info(`Product ID: ${config.productId}`);
    logger.info(`Version: ${version}`);
    return true;
  }

  const spinner = logger.spinner('Deploying to WooCommerce.com...');

  try {
    const credentials = getCredentials();
    const zipPath = await findZipFile(config);

    if (!zipPath) {
      throw new Error(`No zip file found in ${config.distPath}`);
    }

    // Prepare form data
    const FormData = (await import('form-data')).default;
    const form = new FormData();

    // Read zip file
    const zipBuffer = await readFile(zipPath);
    form.append('file', zipBuffer, {
      filename: `${config.slug}.zip`,
      contentType: 'application/zip'
    });

    form.append('product_id', config.productId);
    form.append('username', credentials.username);
    form.append('password', credentials.password);
    form.append('version', version);

    // Make API request
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`${credentials.apiUrl}/product/deploy`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Deployment failed: ${error}`);
    }

    const result = await response.json();

    spinner.succeed('Deployment initiated on WooCommerce.com');

    logger.info(`Status: ${result.status || 'queued'}`);

    if (result.test_runs) {
      logger.info('\nTest runs:');
      for (const [id, testRun] of Object.entries(result.test_runs)) {
        logger.info(`  ${testRun.test_type}: ${testRun.status}`);
        if (testRun.result_url) {
          logger.info(`    ${testRun.result_url}`);
        }
      }
    }

    return true;
  } catch (error) {
    spinner.fail('Deployment failed');
    throw error;
  }
}

/**
 * Check deployment status
 */
export async function checkDeploymentStatus(config) {
  if (!config.productId || config.productId === 'YOUR_PRODUCT_ID_HERE') {
    logger.error('Product ID not configured in .deployrc.json');
    return false;
  }

  try {
    const credentials = getCredentials();

    const FormData = (await import('form-data')).default;
    const form = new FormData();

    form.append('product_id', config.productId);
    form.append('username', credentials.username);
    form.append('password', credentials.password);

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`${credentials.apiUrl}/product/deploy/status`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Status check failed: ${error}`);
    }

    const result = await response.json();

    logger.info(`\nDeployment Status: ${result.status}`);
    logger.info(`Version: ${result.version || 'unknown'}`);

    if (result.test_runs) {
      logger.info('\nTest Runs:');
      for (const [id, testRun] of Object.entries(result.test_runs)) {
        const statusColor = testRun.status === 'success' ? 'green' :
                           testRun.status === 'failed' ? 'red' : 'yellow';
        logger.info(`  ${testRun.test_type}: ${testRun.status}`);
        if (testRun.result_url) {
          logger.info(`    ${testRun.result_url}`);
        }
      }
    }

    return result;
  } catch (error) {
    logger.error(`Status check failed: ${error.message}`);
    return false;
  }
}

/**
 * Find the zip file in the dist directory
 */
async function findZipFile(config) {
  const { readdir } = await import('fs/promises');
  const distPath = join(process.cwd(), config.distPath);

  try {
    const files = await readdir(distPath);
    const zipFile = files.find(f => f.endsWith('.zip'));

    return zipFile ? join(distPath, zipFile) : null;
  } catch (error) {
    return null;
  }
}
