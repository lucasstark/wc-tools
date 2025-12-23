# ES CLI Development Context

This file contains context for continuing development on the ES CLI tool.

## Project Overview

**Location:** `/Users/lucasstark/Packages/wc-deploy`
**Package name:** `es-cli`
**Commands:** `es` (primary), `wc-deploy` (alias)
**Author:** Lucas Stark / Element Stark

A Node.js CLI for building and deploying WooCommerce extensions to WooCommerce.com.

## Architecture

```
wc-deploy/
├── bin/
│   └── wc-deploy.js          # CLI entry point (Commander.js)
├── src/
│   ├── commands/             # Command handlers
│   │   ├── build.js
│   │   ├── deploy.js         # Full deployment with background monitor
│   │   ├── init.js
│   │   ├── phpcs.js          # PHPCS with security ruleset
│   │   ├── pot.js
│   │   ├── qit.js            # QIT tests (builds first)
│   │   ├── status.js
│   │   ├── sync.js           # Quick WP/WC compatibility updates
│   │   └── version.js
│   ├── monitor/
│   │   └── deploy-monitor.js # Background process for deployment monitoring
│   ├── tasks/                # Reusable task modules
│   │   ├── builder.js
│   │   ├── changelog-updater.js
│   │   ├── css-minifier.js
│   │   ├── deployer.js       # WooCommerce.com API integration
│   │   ├── git-manager.js    # Git operations (commit, tag, push)
│   │   ├── pot-generator.js
│   │   ├── version-updater.js
│   │   └── zip-builder.js    # Cleans dist before building
│   └── utils/
│       ├── compatibility.js  # WP/WC version fetching and comparison
│       ├── config-loader.js  # .deployrc.json loader
│       ├── deployed-version.js
│       ├── env-loader.js     # ~/.wccom-deploy credentials
│       └── logger.js         # Chalk-based logging with spinners
└── .claude/
    ├── dev-context.md        # This file
    └── progrmatic-deployment.txt  # WooCommerce.com API docs
```

## Key Design Decisions

### 1. Background Deployment Monitoring
The `deploy` command spawns a detached background process (`deploy-monitor.js`) that:
- Polls WooCommerce.com status every 30 seconds
- Only creates git tag after successful deployment
- Sends macOS notifications via `osascript`
- Handles both success and failure cases

**Rationale:** WooCommerce.com runs async tests after upload. We don't want to tag/push until we know the deployment actually succeeded.

### 2. Commit Before Deploy, Tag After
Deploy flow:
1. Update files
2. Build
3. Git commit (no tag, no push)
4. Upload to WooCommerce.com
5. Spawn monitor → exits
6. (Background) Monitor polls → on success: tag + push

### 3. PHPCS Security Ruleset
Uses global installation at `~/.composer/vendor/bin/phpcs` with custom security ruleset at `~/.composer/phpcs-security.xml`. Focuses on:
- Output escaping (XSS)
- Input sanitization
- SQL injection (`$wpdb->prepare()`)
- Nonce verification
- Dangerous functions (eval, exec, etc.)

### 4. QIT Auto-Build
The `qit` command automatically runs a build before tests to ensure you're testing current code. Use `--skip-build` to bypass.

### 5. Sync Command
Quick workflow for WP/WC compatibility updates. Does everything synchronously (doesn't use monitor). Consider updating to use monitor for consistency.

## Current State / Pending Work

### Completed
- [x] Core build/deploy functionality
- [x] PHPCS integration with security ruleset
- [x] QIT integration with auto-build
- [x] Sync command for compatibility updates
- [x] Background deployment monitor
- [x] macOS notifications for deploy status
- [x] Git tag only on successful deployment

### Pending / Considerations
- [ ] **Sync command consistency**: Should `sync` use the monitor pattern like `deploy`? Currently does everything synchronously.
- [ ] **Monitor logging**: Currently logs to nowhere when detached. Could log to a file.
- [ ] **Windows support**: Uses `osascript` for notifications (macOS only)
- [ ] **Error recovery docs**: Document how to recover from failed deployments

## API Endpoints

### WooCommerce.com Deployment API
Base URL: `https://woocommerce.com/wp-json/wc/submission/runner/v1`

**Deploy:**
```
POST /product/deploy
  - file: zip file
  - product_id
  - username
  - password
  - version
```

**Status:**
```
POST /product/deploy/status
  - product_id
  - username
  - password

Response:
{
  "status": "queued|completed|failed",
  "version": "1.0.0",
  "test_runs": {
    "12345": {
      "test_run_id": "12345",
      "status": "success|pending|failed",
      "test_type": "activation|security|api",
      "result_url": "https://qit.woo.com/?qit_results=12345"
    }
  }
}
```

**Changelog (public):**
```
GET /wp-json/wccom/changelog/1.0/product/{productId}
Returns: Plain text changelog
```

## Configuration Files

### ~/.wccom-deploy
```
WCCOM_USER=username
WCCOM_PASSWORD=app-password
WCCOM_API_URL=https://woocommerce.com/wp-json/wc/submission/runner/v1
```

### ~/.composer/phpcs-security.xml
Security-focused PHPCS ruleset. See file for full rules.

### .deployrc.json (per-plugin)
```json
{
  "productId": "123456",
  "slug": "plugin-slug",
  "mainFile": "plugin-slug.php",
  "versionFiles": [...],
  "distPath": "./dist"
}
```

## Testing Plugins

The user has several WooCommerce extensions:
- `/Users/lucasstark/Sites/woocommerce/app/public/wp-content/plugins/woocommerce-wishlists`
- `/Users/lucasstark/Sites/woocommerce/app/public/wp-content/plugins/woocommerce-dynamic-pricing`
- `/Users/lucasstark/Sites/woocommerce/app/public/wp-content/plugins/woocommerce-bulk-variations`
- etc.

## Common Issues

1. **ExperimentalWarning**: Suppressed via shebang `--disable-warning=ExperimentalWarning`
2. **Stale zip files**: Fixed - zip-builder now logs "Cleaning dist directory..." and deletes before rebuild
3. **Semver comparison**: Use `semver.gt()` not `>` for version comparison (3.4.10 vs 3.4.9)

## Dependencies

Key packages:
- `commander` - CLI framework
- `chalk` - Terminal colors
- `inquirer` - Interactive prompts
- `execa` - Command execution
- `archiver` - Zip creation
- `semver` - Version comparison
- `ora` - Spinners (via logger.js)