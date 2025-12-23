import { execa } from 'execa';
import { logger } from '../utils/logger.js';

/**
 * Check if git repository is clean
 */
export async function checkGitStatus() {
  try {
    const { stdout } = await execa('git', ['status', '--porcelain']);
    return stdout.trim() === '';
  } catch (error) {
    return false;
  }
}

/**
 * Commit changes only (no tag, no push)
 * Used by deploy command - tagging happens after deployment succeeds
 */
export async function gitCommitOnly(version, message, dryRun = false) {
  if (dryRun) {
    logger.info(`Would commit with message: "Release version ${version}"`);
    return;
  }

  try {
    // Add all changes
    await execa('git', ['add', '-A']);

    // Commit
    const commitMessage = `Release version ${version}\n\n${message}`;
    await execa('git', ['commit', '-m', commitMessage]);

    logger.success('Created git commit (tag pending deployment)');
  } catch (error) {
    throw new Error(`Git commit failed: ${error.message}`);
  }
}

/**
 * Commit changes and create tag
 */
export async function gitCommitAndTag(version, message, dryRun = false) {
  if (dryRun) {
    logger.info(`Would commit with message: "Release version ${version}"`);
    logger.info(`Would create tag: ${version}`);
    return;
  }

  try {
    // Add all changes
    await execa('git', ['add', '-A']);

    // Commit
    const commitMessage = `Release version ${version}\n\n${message}`;
    await execa('git', ['commit', '-m', commitMessage]);

    logger.success('Created git commit');

    // Create tag
    await execa('git', ['tag', '-a', version, '-m', `Version ${version}`]);

    logger.success(`Created git tag: ${version}`);

    // Ask about pushing
    logger.info('Run "git push && git push --tags" to push changes');
  } catch (error) {
    throw new Error(`Git operation failed: ${error.message}`);
  }
}

/**
 * Push commits and tags to remote
 */
export async function gitPush(dryRun = false) {
  if (dryRun) {
    logger.info('Would push commits and tags to remote');
    return;
  }

  try {
    await execa('git', ['push']);
    await execa('git', ['push', '--tags']);
    logger.success('Pushed to remote');
  } catch (error) {
    throw new Error(`Git push failed: ${error.message}`);
  }
}
