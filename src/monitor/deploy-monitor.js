#!/usr/bin/env node

// Suppress dotenv v17 debug output
process.env.DOTENV_CONFIG_DEBUG = 'false';
process.env.DOTENV_CONFIG_SILENT = 'true';

/**
 * Background deployment monitor
 *
 * Spawned by deploy command to poll WooCommerce.com for deployment status.
 * On success: sends notification (user manually tags and pushes)
 * On failure: sends notification with error details.
 *
 * ENHANCEMENTS:
 * - Shared status file support for multi-deployment dashboards
 * - Progress calculation
 * - Batch deployment mode with less noisy notifications
 * - Network retry logic
 * - Early failure detection
 *
 * Usage: node deploy-monitor.js <config-json-base64>
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const execAsync = promisify(exec);

// Configuration from command line
const configBase64 = process.argv[2];
if (!configBase64) {
  console.error('Missing config argument');
  process.exit(1);
}

const config = JSON.parse(Buffer.from(configBase64, 'base64').toString('utf-8'));

const {
  productId,
  version,
  slug,
  credentials,
  workingDir,
  commitMessage,
  statusFile = null,        // Optional: shared status file for dashboard
  isBatchDeploy = false,    // Optional: batch deployment mode
  batchIndex = 0,           // Optional: index in batch
  batchTotal = 1            // Optional: total in batch
} = config;

const POLL_INTERVAL = 30000; // 30 seconds
const MAX_ATTEMPTS = 60; // 30 minutes max

/**
 * Update shared status file (for dashboard)
 */
function updateSharedStatus(updates) {
  if (!statusFile) return;

  try {
    let data = [];
    if (existsSync(statusFile)) {
      const content = readFileSync(statusFile, 'utf8');
      data = content ? JSON.parse(content) : [];
    }

    const index = data.findIndex(d => d.productId === productId);

    if (index !== -1) {
      data[index] = { ...data[index], ...updates, lastUpdate: Date.now() };
    } else {
      data.push({
        productId,
        slug,
        version,
        startTime: Date.now(),
        ...updates
      });
    }

    writeFileSync(statusFile, JSON.stringify(data, null, 2));
  } catch (error) {
    // Don't crash if status file update fails
    console.error('Status file update failed:', error.message);
  }
}

/**
 * Calculate deployment progress percentage
 */
function calculateProgress(status) {
  if (!status.test_runs) return 5; // Just queued

  const testRuns = Object.values(status.test_runs);
  if (testRuns.length === 0) return 10;

  const completed = testRuns.filter(t =>
    !['pending', 'running', 'queued'].includes(t.status)
  ).length;

  return Math.round((completed / testRuns.length) * 100);
}

/**
 * Send macOS notification
 */
async function notify(title, message, sound = 'Glass') {
  const escapedTitle = title.replace(/"/g, '\\"');
  const escapedMessage = message.replace(/"/g, '\\"');

  const script = `display notification "${escapedMessage}" with title "${escapedTitle}" sound name "${sound}"`;

  try {
    await execAsync(`osascript -e '${script}'`);
  } catch (error) {
    console.error('Notification failed:', error.message);
  }
}

/**
 * Speak text (macOS)
 */
async function speak(text) {
  try {
    await execAsync(`say "${text.replace(/"/g, '\\"')}"`);
  } catch (error) {
    // Speech failed, ignore
  }
}

/**
 * Open URL in browser
 */
async function openUrl(url) {
  try {
    await execAsync(`open "${url}"`);
  } catch (error) {
    // Failed to open, ignore
  }
}

/**
 * Check deployment status via API with retry logic
 */
async function checkStatus(maxRetries = 3) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
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
        const body = await response.text().catch(() => 'Unable to read response');
        throw new Error(`API error: ${response.status} - ${body.substring(0, 200)}`);
      }

      const data = await response.json();

      // Validate response structure
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid API response: expected object');
      }

      return data;
    } catch (error) {
      lastError = error;

      // Only retry on network errors
      if (attempt < maxRetries - 1 &&
          (error.message.includes('ECONNREFUSED') ||
           error.message.includes('ETIMEDOUT') ||
           error.message.includes('ENOTFOUND') ||
           error.message.includes('fetch failed'))) {
        console.log(`  Network error, retrying (${attempt + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

/**
 * Check if all tests have completed (not pending/running)
 */
function areTestsComplete(status) {
  if (!status.test_runs || Object.keys(status.test_runs).length === 0) {
    return false;
  }

  const pendingStates = ['pending', 'running', 'queued'];

  for (const testRun of Object.values(status.test_runs)) {
    if (pendingStates.includes(testRun.status)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if deployment has conclusively failed early
 */
function hasFailedEarly(status) {
  if (status.status === 'failed' || status.status === 'error') {
    return true;
  }

  if (status.test_runs) {
    for (const testRun of Object.values(status.test_runs)) {
      if (testRun.status === 'failed' || testRun.status === 'error') {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if all tests passed
 */
function didTestsPass(status) {
  if (!status.test_runs) return false;

  for (const testRun of Object.values(status.test_runs)) {
    if (testRun.status !== 'success') {
      return false;
    }
  }

  return true;
}

/**
 * Get failed test details
 */
function getFailedTests(status) {
  const failed = [];

  if (status.test_runs) {
    for (const testRun of Object.values(status.test_runs)) {
      if (testRun.status !== 'success') {
        failed.push({
          type: testRun.test_type,
          status: testRun.status,
          url: testRun.result_url
        });
      }
    }
  }

  return failed;
}


/**
 * Main monitor loop
 */
async function monitor() {
  const prefix = isBatchDeploy ? `[${batchIndex + 1}/${batchTotal}] ` : '';
  console.log(`\n${prefix}Monitoring deployment for ${slug} v${version}`);
  console.log(`Product ID: ${productId}`);
  console.log(`Polling every ${POLL_INTERVAL / 1000} seconds (max ${MAX_ATTEMPTS} attempts)\n`);

  // Initialize status
  updateSharedStatus({
    status: 'queued',
    progress: 0,
    startTime: Date.now()
  });

  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;

    try {
      console.log(`[${new Date().toLocaleTimeString()}] Checking status (attempt ${attempts}/${MAX_ATTEMPTS})...`);

      const status = await checkStatus();
      const progress = calculateProgress(status);

      console.log(`  Status: ${status.status} (${progress}%)`);

      // Update shared status
      updateSharedStatus({
        status: status.status,
        progress,
        testRuns: status.test_runs
      });

      // Log test run statuses
      if (status.test_runs) {
        for (const testRun of Object.values(status.test_runs)) {
          console.log(`  ${testRun.test_type}: ${testRun.status}`);
        }
      }

      // Check for early failure
      if (hasFailedEarly(status)) {
        const failed = getFailedTests(status);
        const failedTypes = failed.map(f => f.type).join(', ');

        console.log(`\n❌ Tests failed: ${failedTypes}`);

        updateSharedStatus({
          status: 'failed',
          progress,
          failedTests: failed
        });

        if (isBatchDeploy) {
          await notify(
            `❌ Deploy ${batchIndex + 1}/${batchTotal} Failed`,
            `${slug} v${version}: ${failedTypes}`,
            'Basso'
          );
        } else {
          await notify(
            '❌ Deploy Failed',
            `${slug} v${version} failed: ${failedTypes}`,
            'Basso'
          );
          await speak('Deployment failed');

          if (failed[0]?.url) {
            await openUrl(failed[0].url);
          }
        }

        console.log('\nCommit was not pushed. To retry:');
        console.log('  1. Fix the issues');
        console.log('  2. Amend the commit: git commit --amend');
        console.log('  3. Rebuild: es build');
        console.log('  4. Redeploy: es deploy --skip-build');

        process.exit(1);
      }

      // Check if tests are complete
      if (areTestsComplete(status)) {
        if (didTestsPass(status)) {
          console.log('\n✅ All tests passed!');

          updateSharedStatus({ status: 'success', progress: 100 });

          if (isBatchDeploy) {
            await notify(
              `✅ Deploy ${batchIndex + 1}/${batchTotal}`,
              `${slug} v${version} - ready to tag`,
              'Glass'
            );
          } else {
            await notify(
              '✅ Deploy Success',
              `${slug} v${version} - ready to tag and push`,
              'Glass'
            );
            await speak('Deployment complete. Ready to tag.');

            const firstTestRun = Object.values(status.test_runs)[0];
            if (firstTestRun?.result_url) {
              await openUrl(firstTestRun.result_url);
            }
          }

          console.log('\nDeployment succeeded! Now tag and push:');
          console.log(`  git tag ${version}`);
          console.log('  git push && git push --tags');

          process.exit(0);
        }
      }

      // Still pending, wait and retry
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

    } catch (error) {
      console.error(`  Error: ${error.message}`);

      updateSharedStatus({
        status: 'error',
        error: error.message
      });

      // Stop on auth errors
      if (error.message.includes('401') || error.message.includes('403')) {
        console.error('Authentication error - stopping monitor');
        await notify(
          '🔒 Deploy Auth Error',
          `${slug}: ${error.message}`,
          'Basso'
        );
        process.exit(1);
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
  }

  // Timeout
  console.log('\n⏱️ Monitoring timed out after 30 minutes');

  updateSharedStatus({ status: 'timeout', progress: calculateProgress({}) });

  await notify(
    '⏱️ Deploy Timeout',
    `${slug} v${version} monitoring timed out`,
    'Funk'
  );

  console.log('\nCheck status manually: es status');
  console.log('If successful, tag manually:');
  console.log(`  git tag ${version}`);
  console.log('  git push && git push --tags');

  process.exit(2);
}

// Start monitoring
monitor().catch(error => {
  console.error('Monitor crashed:', error);
  process.exit(1);
});
