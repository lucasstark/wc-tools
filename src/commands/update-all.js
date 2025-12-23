import chalk from 'chalk';
import semver from 'semver';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { execa } from 'execa';
import { loadConfig, getCurrentVersion } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';
import { getCredentials } from '../utils/env-loader.js';
import {
  fetchLatestWordPressVersion,
  fetchLatestWooCommerceVersion,
  parsePluginCompatibility,
  updatePluginCompatibility,
  isCompatibilityCurrent,
  majorMinor
} from '../utils/compatibility.js';
import { updateVersionInFiles } from '../tasks/version-updater.js';
import { updateChangelog } from '../tasks/changelog-updater.js';
import { runBuild } from '../tasks/builder.js';
import { deployToWooCommerce } from '../tasks/deployer.js';
import { runPhpcsCheck } from './phpcs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default extensions config location
const DEFAULT_CONFIG_PATH = join(homedir(), '.es-extensions.json');

/**
 * Check if git repository is clean
 */
async function isRepoClean(cwd) {
  try {
    const result = await execa('git', ['status', '--porcelain'], { cwd, timeout: 5000 });
    return result.stdout.trim() === '';
  } catch (error) {
    return false;
  }
}

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
 * Analyze an extension for update eligibility
 */
async function analyzeExtension(extensionPath, latestWP, latestWC) {
  const result = {
    path: extensionPath,
    eligible: false,
    reason: null,
    config: null,
    currentVersion: null,
    wpNeedsUpdate: false,
    wcNeedsUpdate: false
  };

  // Check if path exists
  if (!existsSync(extensionPath)) {
    result.reason = 'Path does not exist';
    return result;
  }

  // Check for .deployrc.json
  const configPath = join(extensionPath, '.deployrc.json');
  if (!existsSync(configPath)) {
    result.reason = 'No .deployrc.json found';
    return result;
  }

  try {
    result.config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    result.reason = 'Invalid .deployrc.json';
    return result;
  }

  // Check if repo is clean
  const clean = await isRepoClean(extensionPath);
  if (!clean) {
    result.reason = 'Uncommitted changes';
    return result;
  }

  // Check compatibility
  const mainFilePath = join(extensionPath, result.config.mainFile);
  if (!existsSync(mainFilePath)) {
    result.reason = 'Main file not found';
    return result;
  }

  const current = await parsePluginCompatibility(mainFilePath);
  result.currentVersion = current.version;

  result.wpNeedsUpdate = !isCompatibilityCurrent(current.testedUpTo, latestWP);
  result.wcNeedsUpdate = !isCompatibilityCurrent(current.wcTestedUpTo, latestWC);

  if (!result.wpNeedsUpdate && !result.wcNeedsUpdate) {
    result.reason = 'Already up to date';
    return result;
  }

  result.eligible = true;
  return result;
}

/**
 * Run sync for a single extension (returns immediately, monitor handles completion)
 */
async function runExtensionSync(extensionPath, config, latestWP, latestWC, statusFile, batchIndex, batchTotal) {
  const mainFilePath = join(extensionPath, config.mainFile);
  const current = await parsePluginCompatibility(mainFilePath);
  const currentVersion = current.version;

  // Calculate new version
  const newVersion = semver.inc(currentVersion, 'patch');

  // Build updates
  const compatUpdates = {};
  const changelogEntries = [];

  const wpNeedsUpdate = !isCompatibilityCurrent(current.testedUpTo, latestWP);
  const wcNeedsUpdate = !isCompatibilityCurrent(current.wcTestedUpTo, latestWC);

  if (wpNeedsUpdate) {
    compatUpdates.testedUpTo = majorMinor(latestWP);
    changelogEntries.push(`Update: Tested up to WordPress ${majorMinor(latestWP)}`);
  }
  if (wcNeedsUpdate) {
    compatUpdates.wcTestedUpTo = majorMinor(latestWC);
    changelogEntries.push(`Update: Tested up to WooCommerce ${majorMinor(latestWC)}`);
  }

  // Update compatibility headers
  await updatePluginCompatibility(mainFilePath, compatUpdates);

  // Update version in files
  const originalCwd = process.cwd();
  process.chdir(extensionPath);

  try {
    await updateVersionInFiles(config, newVersion, false);
    await updateChangelog(newVersion, changelogEntries, false);

    // Build
    await runBuild(config, false);

    // Commit (no tag - monitor will handle that)
    await execa('git', ['add', '-A'], { cwd: extensionPath });

    const commitParts = [];
    if (wpNeedsUpdate) commitParts.push(`WordPress ${majorMinor(latestWP)}`);
    if (wcNeedsUpdate) commitParts.push(`WooCommerce ${majorMinor(latestWC)}`);
    const commitMessage = `Compatibility: ${commitParts.join(', ')}`;

    await execa('git', ['commit', '-m', commitMessage], { cwd: extensionPath });

    // Deploy
    await deployToWooCommerce(config, newVersion, false);

    // Spawn monitor with batch mode
    const credentials = getCredentials();

    const monitorConfig = {
      productId: config.productId,
      version: newVersion,
      slug: config.slug,
      credentials: {
        username: credentials.username,
        password: credentials.password,
        apiUrl: credentials.apiUrl
      },
      workingDir: extensionPath,
      commitMessage,
      statusFile,
      isBatchDeploy: true,
      batchIndex,
      batchTotal
    };

    const configBase64 = Buffer.from(JSON.stringify(monitorConfig)).toString('base64');
    const monitorPath = join(__dirname, '../monitor/deploy-monitor.js');

    const child = spawn('node', [monitorPath, configBase64], {
      detached: true,
      stdio: 'ignore',
      cwd: extensionPath
    });

    child.unref();

    return { success: true, version: newVersion, pid: child.pid };
  } finally {
    process.chdir(originalCwd);
  }
}

/**
 * Update all extensions command
 */
export async function updateAllCommand(options) {
  console.log(chalk.bold.cyan('\n  Multi-Extension Compatibility Update\n'));

  // Load extensions config
  const configPath = options.config || DEFAULT_CONFIG_PATH;
  let extensionPaths = [];

  if (options.paths && options.paths.length > 0) {
    // Use paths from command line
    extensionPaths = options.paths;
  } else {
    // Load from config file
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
      console.log();
      logger.info('Or pass paths directly: es update-all /path/to/ext1 /path/to/ext2');
      process.exit(1);
    }
    extensionPaths = config.extensions;
  }

  logger.info(`Found ${extensionPaths.length} extensions to check`);
  console.log();

  // Fetch latest versions
  logger.step('Fetching latest WP/WC versions...');
  let latestWP, latestWC;
  try {
    [latestWP, latestWC] = await Promise.all([
      fetchLatestWordPressVersion(),
      fetchLatestWooCommerceVersion()
    ]);
  } catch (error) {
    logger.error(`Failed to fetch versions: ${error.message}`);
    process.exit(1);
  }

  console.log(chalk.gray(`  WordPress:   ${chalk.white(latestWP)}`));
  console.log(chalk.gray(`  WooCommerce: ${chalk.white(latestWC)}`));
  console.log();

  // Analyze all extensions
  logger.step('Analyzing extensions...');
  const analyses = [];

  for (const extPath of extensionPaths) {
    const analysis = await analyzeExtension(extPath, latestWP, latestWC);
    analyses.push(analysis);

    const name = analysis.config?.slug || extPath.split('/').pop();
    if (analysis.eligible) {
      const updates = [];
      if (analysis.wpNeedsUpdate) updates.push('WP');
      if (analysis.wcNeedsUpdate) updates.push('WC');
      console.log(chalk.green(`  ✓ ${name}`) + chalk.gray(` (needs ${updates.join(', ')} update)`));
    } else {
      console.log(chalk.gray(`  ✗ ${name}: ${analysis.reason}`));
    }
  }

  console.log();

  const eligible = analyses.filter(a => a.eligible);

  if (eligible.length === 0) {
    logger.success('All extensions are up to date!');
    process.exit(0);
  }

  logger.info(`${eligible.length} extension(s) eligible for update`);
  console.log();

  // Dry run mode
  if (options.dryRun) {
    logger.info(chalk.yellow('DRY RUN MODE - No changes will be made'));
    console.log();
    eligible.forEach(a => {
      const updates = [];
      if (a.wpNeedsUpdate) updates.push(`WP ${majorMinor(latestWP)}`);
      if (a.wcNeedsUpdate) updates.push(`WC ${majorMinor(latestWC)}`);
      console.log(chalk.gray(`  Would update: ${a.config.slug} → ${updates.join(', ')}`));
    });
    process.exit(0);
  }

  // Create status file for dashboard
  const statusFile = join(homedir(), '.es-deployment-status.json');
  const initialStatus = eligible.map((a, i) => ({
    productId: a.config.productId,
    slug: a.config.slug,
    version: semver.inc(a.currentVersion, 'patch'),
    status: 'initializing',
    progress: 0,
    startTime: Date.now()
  }));

  writeFileSync(statusFile, JSON.stringify(initialStatus, null, 2));
  logger.success(`Status file created: ${statusFile}`);
  console.log();

  // Run PHPCS on each eligible extension first
  if (!options.skipPhpcs) {
    logger.step('Running PHPCS checks...');
    for (const analysis of eligible) {
      const originalCwd = process.cwd();
      process.chdir(analysis.path);
      try {
        const result = await runPhpcsCheck({ skipIfMissing: true });
        if (!result) {
          logger.error(`PHPCS failed for ${analysis.config.slug}`);
          logger.info('Fix issues or use --skip-phpcs to bypass');
          process.exit(1);
        }
        console.log(chalk.gray(`  ✓ ${analysis.config.slug}`));
      } finally {
        process.chdir(originalCwd);
      }
    }
    logger.success('All PHPCS checks passed');
    console.log();
  }

  // Process each extension
  logger.step('Updating extensions...');
  console.log();

  for (let i = 0; i < eligible.length; i++) {
    const analysis = eligible[i];
    console.log(chalk.cyan(`  [${i + 1}/${eligible.length}] ${analysis.config.slug}`));

    try {
      const result = await runExtensionSync(
        analysis.path,
        analysis.config,
        latestWP,
        latestWC,
        statusFile,
        i,
        eligible.length
      );
      console.log(chalk.green(`    ✓ Deployed v${result.version}, monitor PID: ${result.pid}`));
    } catch (error) {
      console.log(chalk.red(`    ✗ Failed: ${error.message}`));

      // Update status file with error
      try {
        const status = JSON.parse(readFileSync(statusFile, 'utf8'));
        const idx = status.findIndex(s => s.slug === analysis.config.slug);
        if (idx !== -1) {
          status[idx].status = 'error';
          status[idx].error = error.message;
          writeFileSync(statusFile, JSON.stringify(status, null, 2));
        }
      } catch (e) {
        // Ignore status update errors
      }
    }
  }

  console.log();
  logger.success('All deployments initiated!');
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
      eligible.forEach(a => {
        const newVer = semver.inc(a.currentVersion, 'patch');
        console.log(chalk.gray(`  cd ${a.path} && git tag ${newVer} && git push && git push --tags`));
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
