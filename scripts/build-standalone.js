#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Build distributable packages for Gemini Sharp
 * Creates platform-specific archives with Node.js runtime and the CLI
 */

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  existsSync,
  copyFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const bundleDir = join(rootDir, 'bundle');
const distDir = join(rootDir, 'dist-standalone');

const platforms = {
  'linux-x64': { ext: '' },
  'linux-arm64': { ext: '' },
  'mac-x64': { ext: '' },
  'mac-arm64': { ext: '' },
  'win-x64': { ext: '.cmd' },
};

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: rootDir,
    ...options,
  });
  if (result.status !== 0 && !options.allowFailure) {
    console.error(`Command failed with status ${result.status}`);
    process.exit(1);
  }
  return result;
}

function ensureBundle() {
  const bundleFile = join(bundleDir, 'gemini.js');
  if (!existsSync(bundleFile)) {
    console.log('Bundle not found, building...');
    run('npm', ['run', 'bundle']);
  }
  return bundleFile;
}

function getCurrentPlatform() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'win32') return 'win-x64';
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
}

function createLauncher(platformDir, isWindows) {
  if (isWindows) {
    const batContent = `@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%\\bundle\\gemini.js" %*
`;
    writeFileSync(join(platformDir, 'gsharp.cmd'), batContent);
    writeFileSync(join(platformDir, 'gemini-sharp.cmd'), batContent);
  } else {
    const shContent = `#!/bin/sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$SCRIPT_DIR/bundle/gemini.js" "$@"
`;
    const gsharpPath = join(platformDir, 'gsharp');
    const geminiSharpPath = join(platformDir, 'gemini-sharp');
    writeFileSync(gsharpPath, shContent, { mode: 0o755 });
    writeFileSync(geminiSharpPath, shContent, { mode: 0o755 });
  }
}

function buildPackage(platformKey) {
  const config = platforms[platformKey];
  if (!config) {
    console.error(`Unknown platform: ${platformKey}`);
    process.exit(1);
  }

  const isWindows = platformKey.startsWith('win');
  const platformDir = join(distDir, `gsharp-${platformKey}`);
  const bundleDestDir = join(platformDir, 'bundle');

  mkdirSync(bundleDestDir, { recursive: true });

  console.log(`\nBuilding package for ${platformKey}...`);

  // Copy bundle files
  const bundleFiles = readdirSync(bundleDir);
  for (const file of bundleFiles) {
    copyFileSync(join(bundleDir, file), join(bundleDestDir, file));
  }
  console.log(`  Copied ${bundleFiles.length} bundle files`);

  // Copy native addons
  copyNativeAddons(platformKey, bundleDestDir);

  // Create launcher scripts
  createLauncher(platformDir, isWindows);
  console.log('  Created launcher scripts');

  // Create README
  const readmeContent = `# Gemini Sharp (gsharp)

A privacy-focused, enhanced Gemini CLI.

## Installation

1. Extract this archive to a directory of your choice
2. Add the directory to your PATH, or run directly:
   ${isWindows ? '.\\gsharp.cmd' : './gsharp'}

## Requirements

- Node.js 20+ must be installed and available as 'node' in PATH
- Or download Node.js from: https://nodejs.org/

## Usage

  gsharp              # Start interactive mode
  gsharp "prompt"     # Run with a prompt
  gsharp --help       # Show help

## More Info

https://github.com/johnzfitch/gemini-xo
`;
  writeFileSync(join(platformDir, 'README.txt'), readmeContent);

  console.log(`\nPackage ready: ${platformDir}`);
  return platformDir;
}

function copyNativeAddons(platform, destDir) {
  const ptyMap = {
    'win-x64': '@lydell/node-pty-win32-x64',
    'mac-x64': '@lydell/node-pty-darwin-x64',
    'mac-arm64': '@lydell/node-pty-darwin-arm64',
    'linux-x64': '@lydell/node-pty-linux-x64',
    'linux-arm64': '@lydell/node-pty-linux-arm64',
  };

  const ptyPackage = ptyMap[platform];
  if (!ptyPackage) return;

  try {
    const ptyPath = join(rootDir, 'node_modules', ptyPackage);
    if (existsSync(ptyPath)) {
      const files = readdirSync(ptyPath).filter((f) => f.endsWith('.node'));
      for (const file of files) {
        copyFileSync(join(ptyPath, file), join(destDir, file));
        console.log(`  Copied native addon: ${file}`);
      }
    }
  } catch (_e) {
    console.warn(`  Warning: Could not copy native addons for ${platform}`);
  }
}

// Main
const args = process.argv.slice(2);
const specificPlatform = args.find((a) => !a.startsWith('--'));
const buildAll = args.includes('--all');

ensureBundle();
mkdirSync(distDir, { recursive: true });

if (buildAll) {
  console.log('Building packages for all platforms...');
  for (const platform of Object.keys(platforms)) {
    buildPackage(platform);
  }
} else if (specificPlatform && platforms[specificPlatform]) {
  buildPackage(specificPlatform);
} else if (specificPlatform) {
  console.error(`Unknown platform: ${specificPlatform}`);
  console.log('Available:', Object.keys(platforms).join(', '));
  process.exit(1);
} else {
  buildPackage(getCurrentPlatform());
}

console.log('\nDone! Packages are in dist-standalone/');
console.log('Note: Users need Node.js 20+ installed to run these packages.');
