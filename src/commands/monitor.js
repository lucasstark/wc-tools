import chalk from 'chalk';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import semver from 'semver';
import { loadConfig, getCurrentVersion } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';
import { getCredentials } from '../utils/env-loader.js';

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
 * Start monitor for a single extension
 */
async function startSingleMonitor(extensionPath, options = {}) {
  const originalCwd = process.cwd();

  try {
    if (extensionPath) {
      process.chdir(extensionPath);
    }

    const config = await loadConfig();
    const version = await getCurrentVersion();
    const credentials = getCredentials();

    const monitorConfig = {
      productId: config.productId,
      version,
      slug: config.slug,
      credentials: {
        username: credentials.username,
        password: credentials.password,
        apiUrl: credentials.apiUrl
      },
      workingDir: process.cwd(),
      commitMessage: options.commitMessage || `Deploy version ${version}`,
      statusFile: options.statusFile || null,
      isBatchDeploy: options.isBatchDeploy || false,
      batchIndex: options.batchIndex || 0,
      batchTotal: options.batchTotal || 1
    };

    const configBase64 = Buffer.from(JSON.stringify(monitorConfig)).toString('base64');
    const monitorPath = join(__dirname, '../monitor/deploy-monitor.js');

    if (options.background) {
      // Detached background mode
      const child = spawn('node', [monitorPath, configBase64], {
        detached: true,
        stdio: 'ignore',
        cwd: process.cwd()
      });
      child.unref();
      return { pid: child.pid, slug: config.slug, version };
    } else {
      // Foreground mode - inherit stdio
      const child = spawn('node', [monitorPath, configBase64], {
        stdio: 'inherit',
        cwd: process.cwd()
      });

      return new Promise((resolve, reject) => {
        child.on('exit', (code) => {
          resolve({ code, slug: config.slug, version });
        });
        child.on('error', (err) => {
          reject(err);
        });
      });
    }
  } finally {
    process.chdir(originalCwd);
  }
}

/**
 * Monitor command - watch deployment status with notifications
 */
export async function monitorCommand(paths, options) {
  console.log(chalk.bold.cyan('\n  Deployment Monitor\n'));

  // Determine if we're monitoring multiple extensions or just one
  let extensionPaths = [];

  if (options.all) {
    // Load all extensions from config
    const configPath = options.config || DEFAULT_CONFIG_PATH;
    const config = loadExtensionsConfig(configPath);

    if (!config || !config.extensions || config.extensions.length === 0) {
      logger.error('No extensions configured.');
      logger.info(`Create ${configPath} or use --config to specify a config file`);
      process.exit(1);
    }

    extensionPaths = config.extensions;
  } else if (paths && paths.length > 0) {
    extensionPaths = paths;
  } else {
    // Single extension - current directory
    extensionPaths = [process.cwd()];
  }

  if (extensionPaths.length === 1 && !options.all) {
    // Single extension mode - foreground monitor
    logger.info('Starting deployment monitor...');
    console.log();

    try {
      const result = await startSingleMonitor(extensionPaths[0], {
        background: false
      });

      // Monitor exited
      process.exit(result.code || 0);
    } catch (error) {
      logger.error(`Monitor failed: ${error.message}`);
      process.exit(1);
    }
  } else {
    // Multi-extension mode - use dashboard
    logger.info(`Monitoring ${extensionPaths.length} extensions...`);
    console.log();

    // Create status file
    const statusFile = join(homedir(), '.es-deployment-status.json');

    // Initialize status file with current versions
    const initialStatus = [];

    for (const extPath of extensionPaths) {
      try {
        const originalCwd = process.cwd();
        process.chdir(extPath);

        const config = await loadConfig();
        const version = await getCurrentVersion();

        initialStatus.push({
          productId: config.productId,
          slug: config.slug,
          version,
          status: 'initializing',
          progress: 0,
          startTime: Date.now()
        });

        process.chdir(originalCwd);
      } catch (error) {
        logger.warn(`Could not load ${extPath}: ${error.message}`);
      }
    }

    if (initialStatus.length === 0) {
      logger.error('No valid extensions found');
      process.exit(1);
    }

    writeFileSync(statusFile, JSON.stringify(initialStatus, null, 2));

    // Start monitors for each extension in background
    for (let i = 0; i < extensionPaths.length; i++) {
      const extPath = extensionPaths[i];

      try {
        const result = await startSingleMonitor(extPath, {
          background: true,
          statusFile,
          isBatchDeploy: true,
          batchIndex: i,
          batchTotal: extensionPaths.length
        });

        console.log(chalk.gray(`  ✓ Started monitor for ${result.slug} v${result.version} (PID: ${result.pid})`));
      } catch (error) {
        console.log(chalk.red(`  ✗ Failed to start monitor for ${extPath}: ${error.message}`));
      }
    }

    console.log();

    // Launch dashboard
    logger.step('Launching monitoring dashboard...');
    console.log();

    const dashboardPath = join(__dirname, '../monitor/dashboard.js');

    const dashboard = spawn('node', [dashboardPath, statusFile], {
      stdio: 'inherit'
    });

    dashboard.on('exit', (code) => {
      if (code === 0) {
        console.log(chalk.green.bold('\n✨ All deployments completed!\n'));
        logger.info('For each successful deployment, tag and push:');
        initialStatus.forEach(s => {
          const extPath = extensionPaths.find(p => p.includes(s.slug)) || s.slug;
          console.log(chalk.gray(`  cd ${extPath} && git tag ${s.version} && git push && git push --tags`));
        });
        console.log();
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
}
