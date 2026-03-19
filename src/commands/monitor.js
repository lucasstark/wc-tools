import chalk from 'chalk';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { loadConfig, getCurrentVersion } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';
import { getCredentials } from '../utils/env-loader.js';
import { getDeployedVersion } from '../utils/deployed-version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default extensions config location
const DEFAULT_CONFIG_PATH = join(homedir(), '.es-extensions.json');

/**
 * Load extensions configuration
 */
function loadExtensionsConfig(configPath) {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    logger.error(`Failed to parse extensions config: ${error.message}`);
    return null;
  }
}

/**
 * Check deployment status for a product
 */
async function checkDeploymentStatus(productId, credentials) {
  try {
    const FormData = (await import('form-data')).default;
    const fetch = (await import('node-fetch')).default;

    const form = new FormData();
    form.append('product_id', productId);
    form.append('username', credentials.username);
    form.append('password', credentials.password);

    const response = await fetch(`${credentials.apiUrl}/product/deploy/status`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    });

    if (!response.ok) {
      return { status: 'idle', message: 'No active deployment' };
    }

    const data = await response.json();
    return data;
  } catch (error) {
    return { status: 'idle', message: error.message };
  }
}

/**
 * Calculate progress from status
 */
function calculateProgress(status) {
  if (!status.test_runs) return 0;

  const testRuns = Object.values(status.test_runs);
  if (testRuns.length === 0) return 10;

  const completed = testRuns.filter(t =>
    !['pending', 'running', 'queued'].includes(t.status)
  ).length;

  return Math.round((completed / testRuns.length) * 100);
}

/**
 * Monitor command - show deployment status for all extensions
 */
export async function monitorCommand(options) {
  console.log(chalk.bold.cyan('\n  WooCommerce Deployment Monitor\n'));

  // Load extensions from config
  const configPath = options.config || DEFAULT_CONFIG_PATH;
  const config = loadExtensionsConfig(configPath);

  if (!config || !config.extensions || config.extensions.length === 0) {
    logger.error('No extensions configured.');
    console.log();
    logger.info(`Create ${configPath} with:`);
    console.log(chalk.gray(`  {`));
    console.log(chalk.gray(`    "extensions": [`));
    console.log(chalk.gray(`      "/path/to/extension1",`));
    console.log(chalk.gray(`      "/path/to/extension2"`));
    console.log(chalk.gray(`    ]`));
    console.log(chalk.gray(`  }`));
    process.exit(1);
  }

  const credentials = getCredentials();
  const extensionPaths = config.extensions;

  logger.info(`Checking ${extensionPaths.length} extensions...\n`);

  // Gather status for all extensions
  const statuses = [];
  let hasActiveDeployment = false;

  for (const extPath of extensionPaths) {
    try {
      const originalCwd = process.cwd();
      process.chdir(extPath);

      const extConfig = await loadConfig();
      const localVersion = await getCurrentVersion();

      // Check deployment status
      const deployStatus = await checkDeploymentStatus(extConfig.productId, credentials);

      // Check if there's an active deployment
      const isActive = deployStatus.status &&
        ['queued', 'pending', 'running', 'processing', 'deploying'].includes(deployStatus.status);

      if (isActive) {
        hasActiveDeployment = true;
      }

      // Get deployed version if not actively deploying
      let deployedVersion = null;
      if (!isActive) {
        const deployed = await getDeployedVersion(extConfig.productId);
        deployedVersion = deployed?.version || 'unknown';
      }

      statuses.push({
        productId: extConfig.productId,
        slug: extConfig.slug,
        version: localVersion,
        deployedVersion,
        status: isActive ? deployStatus.status : 'idle',
        progress: isActive ? calculateProgress(deployStatus) : 100,
        testRuns: deployStatus.test_runs || null,
        startTime: isActive ? Date.now() : null,
        path: extPath
      });

      const statusIcon = isActive ? '🔄' : '✓';
      const statusText = isActive ? deployStatus.status.toUpperCase() : `v${deployedVersion}`;
      console.log(chalk.gray(`  ${statusIcon} ${extConfig.slug}: ${statusText}`));

      process.chdir(originalCwd);
    } catch (error) {
      console.log(chalk.red(`  ✗ ${extPath}: ${error.message}`));
    }
  }

  console.log();

  if (!hasActiveDeployment) {
    logger.success('No active deployments. All extensions are idle.');
    console.log();

    // Show summary table
    console.log(chalk.bold('Current Versions:'));
    console.log(chalk.gray('─'.repeat(60)));
    for (const s of statuses) {
      const name = s.slug.replace('woocommerce-', '').substring(0, 35).padEnd(35);
      console.log(`  ${name} ${chalk.cyan(s.deployedVersion || s.version)}`);
    }
    console.log(chalk.gray('─'.repeat(60)));
    process.exit(0);
  }

  // Write status file for dashboard
  const statusFile = join(homedir(), '.es-deployment-status.json');
  writeFileSync(statusFile, JSON.stringify(statuses, null, 2));

  // Start background monitors for active deployments
  logger.step('Starting monitors for active deployments...');

  for (let i = 0; i < statuses.length; i++) {
    const s = statuses[i];
    if (s.status !== 'idle') {
      const monitorConfig = {
        productId: s.productId,
        version: s.version,
        slug: s.slug,
        credentials: {
          username: credentials.username,
          password: credentials.password,
          apiUrl: credentials.apiUrl
        },
        workingDir: s.path,
        commitMessage: `Deploy version ${s.version}`,
        statusFile,
        isBatchDeploy: true,
        batchIndex: i,
        batchTotal: statuses.length
      };

      const configBase64 = Buffer.from(JSON.stringify(monitorConfig)).toString('base64');
      const monitorPath = join(__dirname, '../monitor/deploy-monitor.js');

      const child = spawn('node', [monitorPath, configBase64], {
        detached: true,
        stdio: 'ignore',
        cwd: s.path
      });
      child.unref();

      console.log(chalk.gray(`  ✓ Monitor started for ${s.slug} (PID: ${child.pid})`));
    }
  }

  console.log();

  // Launch dashboard
  logger.step('Launching dashboard...\n');

  const dashboardPath = join(__dirname, '../monitor/dashboard.js');

  const dashboard = spawn('node', [dashboardPath, statusFile], {
    stdio: 'inherit'
  });

  dashboard.on('exit', (code) => {
    if (code === 0) {
      console.log(chalk.green.bold('\n✨ All deployments completed!\n'));

      // Show tag commands for successful deployments
      const activeOnes = statuses.filter(s => s.status !== 'idle');
      if (activeOnes.length > 0) {
        logger.info('Tag and push successful deployments:');
        activeOnes.forEach(s => {
          console.log(chalk.gray(`  cd ${s.path} && git tag ${s.version} && git push && git push --tags`));
        });
        console.log();
      }
    }
    process.exit(code);
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n\n👋 Interrupted by user');
    dashboard.kill();
    process.exit(0);
  });
}
