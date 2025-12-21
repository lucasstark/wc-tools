# WC Deploy

A CLI tool for building and deploying WooCommerce extensions. Replaces the need for grunt in individual plugins with a single global tool that handles:

- CSS minification
- POT file generation (i18n)
- Distribution zip creation
- Version management
- Git tagging
- WooCommerce.com deployment

## Installation

```bash
cd ~/Packages/wc-deploy
npm install
npm link
```

Now `wc-deploy` command is available globally.

## Quick Start

```bash
# Navigate to your plugin directory
cd /path/to/your/woocommerce-extension

# Initialize configuration
wc-deploy init

# Build distribution package
wc-deploy build

# Full deployment
wc-deploy deploy
```

## Setup

### 1. Configure WooCommerce.com Credentials

Create a `.env` file in `~/Packages/wc-deploy/`:

```bash
WC_USERNAME=your_woocommerce_username
WC_APP_PASSWORD=your_application_password
```

**To get an application password:**
1. Go to https://woocommerce.com/my-account/
2. Navigate to your account settings
3. Create an application password for API access

### 2. Configure Each Extension

Run `wc-deploy init` in your plugin directory, or create `.deployrc.json` manually:

```json
{
  "productId": "171144",
  "slug": "woocommerce-wishlists",
  "mainFile": "woocommerce-wishlists.php",
  "versionFiles": [
    {
      "file": "woocommerce-wishlists.php",
      "pattern": " * Version: {{version}}"
    },
    {
      "file": "package.json",
      "pattern": "\"version\": \"{{version}}\""
    }
  ],
  "minifyCss": true,
  "generatePot": true,
  "distPath": "./dist"
}
```

## Commands

### `wc-deploy init`

Initialize a new `.deployrc.json` configuration file interactively.

```bash
wc-deploy init
wc-deploy init --force  # Overwrite existing config
```

### `wc-deploy build`

Build the distribution package. This runs:
1. Version consistency check
2. CSS minification (creates `.min.css` files)
3. POT file generation (requires WP-CLI)
4. Distribution zip creation

```bash
wc-deploy build
wc-deploy build --dry-run              # Preview without changes
wc-deploy build --skip-version-check   # Skip version check
wc-deploy build --force                # Continue despite version mismatch
```

### `wc-deploy pot`

Generate POT file for translations (standalone command).

```bash
wc-deploy pot
wc-deploy pot --dry-run
```

Requires [WP-CLI](https://wp-cli.org/) to be installed.

### `wc-deploy version <newVersion>`

Update version numbers in all configured files.

```bash
wc-deploy version 2.4.0
wc-deploy version 2.4.0 --dry-run
```

### `wc-deploy deploy`

Full deployment workflow:
1. Prompt for new version number
2. Prompt for changelog entry
3. Update version in all configured files
4. Update changelog.txt
5. Build distribution package
6. Create git commit and tag
7. Deploy to WooCommerce.com

```bash
wc-deploy deploy
wc-deploy deploy --version 2.4.0       # Specify version directly
wc-deploy deploy --dry-run             # Preview without changes
wc-deploy deploy --skip-build          # Skip build step
wc-deploy deploy --skip-tests          # Skip QIT tests
wc-deploy deploy --skip-deploy         # Skip WooCommerce.com deployment
```

### `wc-deploy status`

Check the status of a WooCommerce.com deployment.

```bash
wc-deploy status
```

## Configuration Options

### `.deployrc.json`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `productId` | string | required | WooCommerce.com product ID |
| `slug` | string | required | Plugin slug (used for zip naming) |
| `mainFile` | string | required | Main plugin PHP file |
| `versionFiles` | array | `[]` | Files where version should be updated |
| `minifyCss` | boolean | `true` | Enable CSS minification |
| `cssPath` | string | `"assets/css"` | Path to CSS files |
| `generatePot` | boolean | `true` | Enable POT file generation |
| `exclude` | array | `[]` | Additional files/folders to exclude from zip |
| `distPath` | string | `"./dist"` | Output directory for distribution files |
| `preBuildCommand` | string | `null` | Custom command to run before build |

### Default Exclusions

The following are always excluded from the distribution zip:
- `node_modules`, `.git`, `.github`, `.vscode`, `.idea`
- `dist`, `tests`, `grunt`
- `composer.json`, `composer.lock`, `package-lock.json`
- `Gruntfile.js`, `.deployrc.json`, `.env`
- `.phpcs.xml`, `phpcs.xml`, `.eslintrc`
- `README.md`, `.DS_Store`

## Migrating from Grunt

To migrate an existing plugin from grunt to wc-deploy:

1. **Navigate to your plugin directory:**
   ```bash
   cd /path/to/your-plugin
   ```

2. **Initialize wc-deploy:**
   ```bash
   wc-deploy init
   ```

3. **Test the build:**
   ```bash
   wc-deploy build --dry-run
   ```

4. **Once confirmed, you can remove grunt:**
   - Delete `Gruntfile.js`
   - Delete `grunt/` directory
   - Remove grunt dependencies from `package.json`

5. **Update your npm scripts** (optional):
   ```json
   {
     "scripts": {
       "build": "wc-deploy build"
     }
   }
   ```

## Requirements

- Node.js 18+
- [WP-CLI](https://wp-cli.org/) (for POT file generation)

## License

MIT
