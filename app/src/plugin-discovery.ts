/**
 * Plugin Discovery
 *
 * Pure read-only functions for discovering plugins from the filesystem.
 * Three sources: local plugins/ directory, @nanogemclaw-plugin/* npm scope, and manifest.
 */

import path from 'path';
import fs from 'fs';
import { logger } from '@nanogemclaw/core/logger';
import type { DiscoveredPlugin, PluginRegistryEntry } from './plugin-types.js';

// ============================================================================
// Directory discovery
// ============================================================================

/**
 * Scan a local plugins directory for valid plugin packages.
 * A valid plugin must have a package.json with @nanogemclaw/plugin-api in any dependency field.
 */
export function discoverDirectoryPlugins(
  pluginsDir: string,
): DiscoveredPlugin[] {
  if (!fs.existsSync(pluginsDir)) {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  } catch (err) {
    logger.warn({ err, pluginsDir }, 'Failed to read plugins directory');
    return [];
  }

  const resolvedPluginsDir = path.resolve(pluginsDir);
  const discovered: Array<{ dirName: string; plugin: DiscoveredPlugin }> = [];

  for (const entry of entries) {
    // Skip non-directories
    if (!entry.isDirectory()) continue;

    // Skip dotfiles
    if (entry.name.startsWith('.')) continue;

    const pluginPath = path.join(resolvedPluginsDir, entry.name);

    // Skip symlinks
    try {
      const stat = fs.lstatSync(pluginPath);
      if (stat.isSymbolicLink()) {
        logger.warn(
          { path: pluginPath },
          'Skipping symlinked plugin directory',
        );
        continue;
      }
    } catch (err) {
      logger.warn(
        { err, path: pluginPath },
        'Failed to stat plugin directory, skipping',
      );
      continue;
    }

    // Path traversal guard
    const resolvedPluginPath = path.resolve(pluginPath);
    if (
      !resolvedPluginPath.startsWith(resolvedPluginsDir + path.sep) &&
      resolvedPluginPath !== resolvedPluginsDir
    ) {
      logger.warn(
        { path: resolvedPluginPath, pluginsDir: resolvedPluginsDir },
        'Plugin path escapes plugins directory, skipping',
      );
      continue;
    }

    try {
      const pkgJsonPath = path.join(resolvedPluginPath, 'package.json');
      if (!fs.existsSync(pkgJsonPath)) {
        logger.debug(
          { path: resolvedPluginPath },
          'Plugin directory missing package.json, skipping',
        );
        continue;
      }

      const pkgRaw = fs.readFileSync(pkgJsonPath, 'utf-8');
      const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;

      // Check for @nanogemclaw/plugin-api in any dependency field
      const allDeps = {
        ...((pkg['dependencies'] as Record<string, string> | undefined) ?? {}),
        ...((pkg['devDependencies'] as Record<string, string> | undefined) ??
          {}),
        ...((pkg['peerDependencies'] as Record<string, string> | undefined) ??
          {}),
      };

      if (!('@nanogemclaw/plugin-api' in allDeps)) {
        logger.debug(
          { path: resolvedPluginPath },
          'Plugin directory lacks @nanogemclaw/plugin-api dependency, skipping',
        );
        continue;
      }

      // Resolve source entry point
      let relativeSource: string;
      const exports = pkg['exports'] as Record<string, unknown> | undefined;
      if (typeof pkg['main'] === 'string') {
        relativeSource = pkg['main'];
      } else if (exports && typeof exports['.'] === 'string') {
        relativeSource = exports['.'];
      } else {
        relativeSource = './src/index.ts';
      }

      const absoluteSource = path.resolve(resolvedPluginPath, relativeSource);

      // Final path traversal guard on resolved source
      if (
        !absoluteSource.startsWith(resolvedPluginPath + path.sep) &&
        absoluteSource !== resolvedPluginPath
      ) {
        logger.warn(
          { source: absoluteSource, pluginPath: resolvedPluginPath },
          'Plugin source path escapes plugin directory, skipping',
        );
        continue;
      }

      discovered.push({
        dirName: entry.name,
        plugin: {
          source: absoluteSource,
          origin: 'directory',
          config: {},
          enabled: true,
        },
      });
    } catch (err) {
      logger.warn(
        { err, path: pluginPath },
        'Error processing plugin directory, skipping',
      );
    }
  }

  // Sort alphabetically by directory name, then extract plugins
  discovered.sort((a, b) => a.dirName.localeCompare(b.dirName));
  return discovered.map((d) => d.plugin);
}

// ============================================================================
// npm scope discovery
// ============================================================================

/**
 * Scan node_modules/@nanogemclaw-plugin/* for installed scope packages.
 */
export function discoverNpmScopePlugins(
  nodeModulesDir: string,
): DiscoveredPlugin[] {
  const scopeDir = path.join(nodeModulesDir, '@nanogemclaw-plugin');

  if (!fs.existsSync(scopeDir)) {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(scopeDir, { withFileTypes: true });
  } catch (err) {
    logger.warn(
      { err, scopeDir },
      'Failed to read @nanogemclaw-plugin scope directory',
    );
    return [];
  }

  const discovered: DiscoveredPlugin[] = [];

  for (const entry of entries) {
    // Skip non-directories
    if (!entry.isDirectory()) continue;

    try {
      const pkgJsonPath = path.join(scopeDir, entry.name, 'package.json');
      if (!fs.existsSync(pkgJsonPath)) {
        logger.debug(
          { name: entry.name },
          '@nanogemclaw-plugin package missing package.json, skipping',
        );
        continue;
      }

      const source = `@nanogemclaw-plugin/${entry.name}`;

      discovered.push({
        source,
        origin: 'npm-scope',
        config: {},
        enabled: true,
      });
    } catch (err) {
      logger.warn(
        { err, name: entry.name },
        'Error processing @nanogemclaw-plugin package, skipping',
      );
    }
  }

  // Sort alphabetically by package name
  discovered.sort((a, b) => a.source.localeCompare(b.source));

  return discovered;
}

// ============================================================================
// Merge sources
// ============================================================================

/**
 * Merge plugin sources from all three origins.
 * Manifest entries win on collision (by source path).
 * Order: manifest first → directory (alpha) → npm-scope (alpha), no duplicates.
 */
export function mergePluginSources(
  manifestEntries: PluginRegistryEntry[],
  directoryPlugins: DiscoveredPlugin[],
  npmScopePlugins: DiscoveredPlugin[],
): DiscoveredPlugin[] {
  const merged: DiscoveredPlugin[] = [];
  const seenSources = new Set<string>();

  // 1. Manifest entries first (with origin: 'manifest')
  for (const entry of manifestEntries) {
    const isPathLike = entry.source.startsWith('.') || path.isAbsolute(entry.source);
    const normalizedSource = isPathLike
      ? path.resolve(entry.source)
      : entry.source;
    seenSources.add(normalizedSource);
    merged.push({ ...entry, origin: 'manifest' });
  }

  // 2. Directory plugins not already in manifest
  for (const plugin of directoryPlugins) {
    const normalizedSource = path.resolve(plugin.source);
    if (!seenSources.has(normalizedSource)) {
      seenSources.add(normalizedSource);
      merged.push(plugin);
    }
  }

  // 3. npm-scope plugins not already seen
  for (const plugin of npmScopePlugins) {
    if (!seenSources.has(plugin.source)) {
      seenSources.add(plugin.source);
      merged.push(plugin);
    }
  }

  return merged;
}
