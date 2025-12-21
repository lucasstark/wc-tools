import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Fetch latest WordPress version from WordPress.org API
 * @returns {Promise<string>} e.g., "6.7.1"
 */
export async function fetchLatestWordPressVersion() {
  const res = await fetch('https://api.wordpress.org/core/version-check/1.7/');
  if (!res.ok) {
    throw new Error(`Failed to fetch WordPress version: ${res.statusText}`);
  }
  const data = await res.json();
  return data.offers[0].version;
}

/**
 * Fetch latest WooCommerce version from WordPress.org Plugin API
 * @returns {Promise<string>} e.g., "9.4.2"
 */
export async function fetchLatestWooCommerceVersion() {
  const res = await fetch(
    'https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&slug=woocommerce'
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch WooCommerce version: ${res.statusText}`);
  }
  const data = await res.json();
  return data.version;
}

/**
 * Parse plugin header for compatibility tags
 * @param {string} filePath - Path to main plugin file
 * @returns {Promise<{ testedUpTo: string|null, wcTestedUpTo: string|null, version: string|null }>}
 */
export async function parsePluginCompatibility(filePath) {
  const content = await readFile(filePath, 'utf-8');

  const testedUpToMatch = content.match(/^\s*\*?\s*Tested up to:\s*(.+)$/mi);
  const wcTestedUpToMatch = content.match(/^\s*\*?\s*WC tested up to:\s*(.+)$/mi);
  const versionMatch = content.match(/^\s*\*?\s*Version:\s*(.+)$/mi);

  return {
    testedUpTo: testedUpToMatch ? testedUpToMatch[1].trim() : null,
    wcTestedUpTo: wcTestedUpToMatch ? wcTestedUpToMatch[1].trim() : null,
    version: versionMatch ? versionMatch[1].trim() : null
  };
}

/**
 * Update compatibility headers in plugin file
 * @param {string} filePath
 * @param {{ testedUpTo?: string, wcTestedUpTo?: string }} updates
 */
export async function updatePluginCompatibility(filePath, updates) {
  let content = await readFile(filePath, 'utf-8');

  if (updates.testedUpTo) {
    content = content.replace(
      /^(\s*\*?\s*Tested up to:\s*).+$/mi,
      `$1${updates.testedUpTo}`
    );
  }

  if (updates.wcTestedUpTo) {
    content = content.replace(
      /^(\s*\*?\s*WC tested up to:\s*).+$/mi,
      `$1${updates.wcTestedUpTo}`
    );
  }

  await writeFile(filePath, content, 'utf-8');
}

/**
 * Compare versions - checks if current covers latest (major.minor only)
 * @param {string} current - e.g., "6.6" or "6.6.0"
 * @param {string} latest - e.g., "6.7.1"
 * @returns {boolean} - true if current >= latest (major.minor)
 */
export function isCompatibilityCurrent(current, latest) {
  if (!current || !latest) return false;

  const currentMM = majorMinor(current);
  const latestMM = majorMinor(latest);

  const [curMajor, curMinor] = currentMM.split('.').map(Number);
  const [latMajor, latMinor] = latestMM.split('.').map(Number);

  if (curMajor > latMajor) return true;
  if (curMajor < latMajor) return false;
  return curMinor >= latMinor;
}

/**
 * Extract major.minor from a version string
 * @param {string} version - e.g., "6.7.1"
 * @returns {string} - e.g., "6.7"
 */
export function majorMinor(version) {
  const parts = version.split('.');
  return `${parts[0]}.${parts[1] || '0'}`;
}
