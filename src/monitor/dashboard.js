#!/usr/bin/env node

/**
 * WooCommerce Deployment Dashboard
 *
 * Real-time terminal UI for monitoring multiple concurrent deployments.
 * Displays status, progress, and duration for each deployment.
 * Auto-exits when all deployments complete.
 *
 * Usage: node dashboard.js <status-file-path>
 */

import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { readFileSync, existsSync, watchFile } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const statusFile = process.argv[2];

if (!statusFile) {
  console.error('Usage: node dashboard.js <status-file-path>');
  process.exit(1);
}

if (!existsSync(statusFile)) {
  console.error(`Status file not found: ${statusFile}`);
  process.exit(1);
}

// Create screen
const screen = blessed.screen({
  smartCSR: true,
  title: 'WooCommerce Deployment Monitor',
  fullUnicode: true
});

// Create grid layout
const grid = new contrib.grid({ rows: 12, cols: 12, screen });

// Main table showing all deployments
const table = grid.set(0, 0, 10, 12, contrib.table, {
  keys: true,
  fg: 'white',
  selectedFg: 'white',
  selectedBg: 'blue',
  interactive: false,
  label: ' WooCommerce Deployment Status ',
  width: '100%',
  height: '100%',
  border: { type: 'line', fg: 'cyan' },
  columnSpacing: 2,
  columnWidth: [8, 40, 13, 10, 10]
});

// Status bar at bottom
const statusBar = blessed.box({
  bottom: 0,
  left: 0,
  width: '100%',
  height: 2,
  content: 'Monitoring deployments... Press Q to quit',
  style: {
    fg: 'white',
    bg: 'blue'
  }
});

screen.append(statusBar);

let hasFinished = false;

/**
 * Get emoji for deployment status
 */
function getStatusEmoji(status) {
  const emojiMap = {
    idle: '💤',
    initializing: '⚙️ ',
    deploying: '🔄',
    queued: '⏳',
    processing: '⚙️ ',
    success: '✅',
    failed: '❌',
    timeout: '⏱️ ',
    error: '⚠️ ',
    warning: '⚠️ '
  };
  return emojiMap[status] || '❓';
}

/**
 * Format duration in human-readable form
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Update the dashboard display
 */
function updateDisplay() {
  try {
    if (!existsSync(statusFile)) {
      return;
    }

    const content = readFileSync(statusFile, 'utf8');
    if (!content) {
      return;
    }

    const data = JSON.parse(content);

    if (!Array.isArray(data) || data.length === 0) {
      return;
    }

    // Sort by status priority (active first, then completed/failed, idle last)
    const sortedData = [...data].sort((a, b) => {
      const priority = {
        deploying: 1, queued: 1, processing: 1, initializing: 1,
        success: 2, warning: 2,
        failed: 3, error: 3, timeout: 3,
        idle: 5
      };
      return (priority[a.status] || 4) - (priority[b.status] || 4);
    });

    // Prepare table data
    const headers = ['ID', 'Product', 'Status', 'Progress', 'Duration'];
    const rows = sortedData.map(d => {
      const statusEmoji = getStatusEmoji(d.status);
      const shortSlug = d.slug.replace('woocommerce-', '').substring(0, 38);
      const progress = d.progress || 0;

      // For idle extensions, show deployed version instead of progress/duration
      if (d.status === 'idle') {
        const versionText = d.deployedVersion ? `v${d.deployedVersion}` : d.version;
        return [
          d.productId.toString(),
          shortSlug,
          `${statusEmoji} ${versionText}`,
          '██████████ 100%',
          '-'
        ];
      }

      const duration = d.startTime ? formatDuration(Date.now() - d.startTime) : '-';
      const statusText = d.status.toUpperCase();

      return [
        d.productId.toString(),
        shortSlug,
        `${statusEmoji} ${statusText}`,
        `${'█'.repeat(Math.floor(progress / 10))}${'░'.repeat(10 - Math.floor(progress / 10))} ${progress}%`,
        duration
      ];
    });

    table.setData({ headers, data: rows });

    // Update status bar with summary
    const completed = data.filter(d => d.status === 'success').length;
    const failed = data.filter(d => d.status === 'failed' || d.status === 'error').length;
    const warnings = data.filter(d => d.status === 'warning').length;
    const idle = data.filter(d => d.status === 'idle').length;
    const inProgress = data.filter(d =>
      ['deploying', 'queued', 'processing', 'initializing'].includes(d.status)
    ).length;

    let statusText = '';
    if (inProgress > 0) statusText += `🔄 ${inProgress} Deploying`;
    if (completed > 0) statusText += `${statusText ? ' | ' : ''}✅ ${completed} Complete`;
    if (warnings > 0) statusText += ` | ⚠️  ${warnings} Warning`;
    if (failed > 0) statusText += ` | ❌ ${failed} Failed`;
    if (idle > 0) statusText += ` | 💤 ${idle} Idle`;
    statusText += ' | Press Q to quit';

    statusBar.setContent(statusText);

    screen.render();

    // Check if all deployments are finished (idle counts as finished)
    const allFinished = data.every(d =>
      ['success', 'failed', 'error', 'timeout', 'warning', 'idle'].includes(d.status)
    );

    if (allFinished && !hasFinished) {
      hasFinished = true;

      // Show completion message
      setTimeout(async () => {
        screen.destroy();

        console.log('\n✨ All deployments finished!');
        console.log(`Results: ${completed} succeeded, ${failed} failed, ${warnings} warnings\n`);

        // Summary table
        console.log('Final Status:');
        console.log('─'.repeat(70));
        data.forEach(d => {
          const emoji = getStatusEmoji(d.status);
          const slug = d.slug.replace('woocommerce-', '');
          const progress = d.progress || 0;
          console.log(`${emoji} ${slug.padEnd(45)} ${d.status.padEnd(12)} (${progress}%)`);
        });
        console.log('─'.repeat(70));

        // Speak completion
        try {
          if (completed === data.length) {
            await execAsync('say "All deployments completed successfully"');
          } else if (failed > 0) {
            await execAsync(`say "${failed} deployments failed"`);
          }
        } catch (e) {
          // Ignore speech errors
        }

        process.exit(failed > 0 ? 1 : 0);
      }, 3000);
    }

  } catch (error) {
    // Ignore parse errors - file might be mid-write
  }
}

// Watch for file changes and update
watchFile(statusFile, { interval: 2000 }, () => {
  updateDisplay();
});

// Initial display
updateDisplay();

// Update every 2 seconds (in case watch doesn't fire)
setInterval(updateDisplay, 2000);

// Handle quit
screen.key(['q', 'Q', 'C-c'], () => {
  screen.destroy();
  console.log('\n👋 Dashboard closed by user');
  process.exit(0);
});

// Handle window resize
process.stdout.on('resize', () => {
  screen.emit('resize');
});

screen.render();
