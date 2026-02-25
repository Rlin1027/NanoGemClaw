/**
 * Tests for plugin auto-discovery functions.
 * Uses real temp directories (pure read-only functions — safe with real fs).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  discoverDirectoryPlugins,
  discoverNpmScopePlugins,
  mergePluginSources,
} from '../../app/src/plugin-discovery.js';

// ============================================================================
// Helpers
// ============================================================================

function makePkg(dir: string, extra: Record<string, unknown> = {}): void {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: path.basename(dir),
      version: '1.0.0',
      ...extra,
    }),
  );
}

function makePluginDir(
  parent: string,
  name: string,
  depField:
    | 'dependencies'
    | 'devDependencies'
    | 'peerDependencies' = 'dependencies',
): string {
  const pluginDir = path.join(parent, name);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(path.join(pluginDir, 'src'), { recursive: true });
  makePkg(pluginDir, {
    main: './src/index.ts',
    [depField]: { '@nanogemclaw/plugin-api': '*' },
  });
  fs.writeFileSync(path.join(pluginDir, 'src', 'index.ts'), '// plugin');
  return pluginDir;
}

// ============================================================================
// discoverDirectoryPlugins
// ============================================================================

describe('discoverDirectoryPlugins', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ngc-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns [] when directory does not exist', () => {
    const result = discoverDirectoryPlugins(path.join(tmpDir, 'nonexistent'));
    expect(result).toEqual([]);
  });

  it('returns [] when directory is empty', () => {
    const pluginsDir = path.join(tmpDir, 'plugins');
    fs.mkdirSync(pluginsDir);
    const result = discoverDirectoryPlugins(pluginsDir);
    expect(result).toEqual([]);
  });

  it('discovers valid plugin with @nanogemclaw/plugin-api in dependencies', () => {
    const pluginsDir = path.join(tmpDir, 'plugins');
    fs.mkdirSync(pluginsDir);
    makePluginDir(pluginsDir, 'my-plugin', 'dependencies');

    const result = discoverDirectoryPlugins(pluginsDir);
    expect(result).toHaveLength(1);
    expect(result[0].origin).toBe('directory');
    expect(result[0].enabled).toBe(true);
    expect(result[0].source).toContain('my-plugin');
  });

  it('discovers valid plugin with @nanogemclaw/plugin-api in peerDependencies', () => {
    const pluginsDir = path.join(tmpDir, 'plugins');
    fs.mkdirSync(pluginsDir);
    makePluginDir(pluginsDir, 'peer-plugin', 'peerDependencies');

    const result = discoverDirectoryPlugins(pluginsDir);
    expect(result).toHaveLength(1);
    expect(result[0].origin).toBe('directory');
  });

  it('skips subdirectory without package.json', () => {
    const pluginsDir = path.join(tmpDir, 'plugins');
    fs.mkdirSync(pluginsDir);
    fs.mkdirSync(path.join(pluginsDir, 'no-pkg'));

    const result = discoverDirectoryPlugins(pluginsDir);
    expect(result).toEqual([]);
  });

  it('skips subdirectory where package.json lacks @nanogemclaw/plugin-api', () => {
    const pluginsDir = path.join(tmpDir, 'plugins');
    fs.mkdirSync(pluginsDir);
    const pluginDir = path.join(pluginsDir, 'unrelated-plugin');
    fs.mkdirSync(pluginDir);
    makePkg(pluginDir, { dependencies: { lodash: '*' } });

    const result = discoverDirectoryPlugins(pluginsDir);
    expect(result).toEqual([]);
  });

  it('skips symlinked directories', () => {
    const pluginsDir = path.join(tmpDir, 'plugins');
    fs.mkdirSync(pluginsDir);
    // Create a real plugin dir outside plugins/
    const realPlugin = path.join(tmpDir, 'real-plugin');
    makePluginDir(tmpDir, 'real-plugin', 'dependencies');
    // Symlink it into plugins/
    const symlinkPath = path.join(pluginsDir, 'sym-plugin');
    fs.symlinkSync(realPlugin, symlinkPath);

    const result = discoverDirectoryPlugins(pluginsDir);
    expect(result).toEqual([]);
  });

  it('returns results sorted alphabetically by directory name', () => {
    const pluginsDir = path.join(tmpDir, 'plugins');
    fs.mkdirSync(pluginsDir);
    makePluginDir(pluginsDir, 'zebra-plugin', 'dependencies');
    makePluginDir(pluginsDir, 'alpha-plugin', 'dependencies');
    makePluginDir(pluginsDir, 'middle-plugin', 'dependencies');

    const result = discoverDirectoryPlugins(pluginsDir);
    expect(result).toHaveLength(3);
    // Sort by plugin directory name (path contains the plugin dir)
    expect(result[0].source).toContain('alpha-plugin');
    expect(result[1].source).toContain('middle-plugin');
    expect(result[2].source).toContain('zebra-plugin');
  });
});

// ============================================================================
// discoverNpmScopePlugins
// ============================================================================

describe('discoverNpmScopePlugins', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ngc-npm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns [] when scope directory does not exist', () => {
    const nodeModules = path.join(tmpDir, 'node_modules');
    fs.mkdirSync(nodeModules);
    // @nanogemclaw-plugin does not exist
    const result = discoverNpmScopePlugins(nodeModules);
    expect(result).toEqual([]);
  });

  it('discovers installed scoped packages', () => {
    const nodeModules = path.join(tmpDir, 'node_modules');
    const scopeDir = path.join(nodeModules, '@nanogemclaw-plugin');
    const pkgDir = path.join(scopeDir, 'my-ext');
    fs.mkdirSync(pkgDir, { recursive: true });
    makePkg(pkgDir, { name: '@nanogemclaw-plugin/my-ext' });

    const result = discoverNpmScopePlugins(nodeModules);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('@nanogemclaw-plugin/my-ext');
    expect(result[0].origin).toBe('npm-scope');
    expect(result[0].enabled).toBe(true);
  });

  it('skips entries without package.json', () => {
    const nodeModules = path.join(tmpDir, 'node_modules');
    const scopeDir = path.join(nodeModules, '@nanogemclaw-plugin');
    // A dir without package.json
    const noPkgDir = path.join(scopeDir, 'no-pkg-pkg');
    fs.mkdirSync(noPkgDir, { recursive: true });

    const result = discoverNpmScopePlugins(nodeModules);
    expect(result).toEqual([]);
  });
});

// ============================================================================
// mergePluginSources
// ============================================================================

describe('mergePluginSources', () => {
  it('returns only manifest entries when no auto-discovered plugins', () => {
    const manifest = [
      { source: '/abs/plugin-a/src/index.ts', config: {}, enabled: true },
    ];
    const result = mergePluginSources(manifest, [], []);
    expect(result).toHaveLength(1);
    expect(result[0].origin).toBe('manifest');
    expect(result[0].source).toBe('/abs/plugin-a/src/index.ts');
  });

  it('manifest entry overrides auto-discovered plugin with same source', () => {
    const absSource = '/abs/plugins/my-plugin/src/index.ts';
    const manifest = [
      { source: absSource, config: { key: 'value' }, enabled: false },
    ];
    const directoryPlugins = [
      {
        source: absSource,
        config: {},
        enabled: true,
        origin: 'directory' as const,
      },
    ];
    const result = mergePluginSources(manifest, directoryPlugins, []);
    expect(result).toHaveLength(1);
    expect(result[0].origin).toBe('manifest');
    expect(result[0].config).toEqual({ key: 'value' });
    expect(result[0].enabled).toBe(false);
  });

  it('manifest enabled: false disables an auto-discovered plugin', () => {
    const absSource = '/abs/plugins/disabled-plugin/src/index.ts';
    const manifest = [{ source: absSource, config: {}, enabled: false }];
    const directoryPlugins = [
      {
        source: absSource,
        config: {},
        enabled: true,
        origin: 'directory' as const,
      },
    ];
    const result = mergePluginSources(manifest, directoryPlugins, []);
    expect(result).toHaveLength(1);
    expect(result[0].enabled).toBe(false);
    expect(result[0].origin).toBe('manifest');
  });

  it('preserves order: manifest first → directory (alpha) → npm-scope (alpha), no duplicates', () => {
    const manifestEntries = [
      {
        source: '/abs/plugins/manifest-plugin/src/index.ts',
        config: {},
        enabled: true,
      },
    ];
    const directoryPlugins = [
      {
        source: '/abs/plugins/alpha-dir/src/index.ts',
        config: {},
        enabled: true,
        origin: 'directory' as const,
      },
      {
        source: '/abs/plugins/zebra-dir/src/index.ts',
        config: {},
        enabled: true,
        origin: 'directory' as const,
      },
    ];
    const npmScopePlugins = [
      {
        source: '@nanogemclaw-plugin/aaa',
        config: {},
        enabled: true,
        origin: 'npm-scope' as const,
      },
      {
        source: '@nanogemclaw-plugin/zzz',
        config: {},
        enabled: true,
        origin: 'npm-scope' as const,
      },
    ];

    const result = mergePluginSources(
      manifestEntries,
      directoryPlugins,
      npmScopePlugins,
    );

    expect(result).toHaveLength(5);
    expect(result[0].origin).toBe('manifest');
    expect(result[1].origin).toBe('directory');
    expect(result[1].source).toContain('alpha-dir');
    expect(result[2].origin).toBe('directory');
    expect(result[2].source).toContain('zebra-dir');
    expect(result[3].origin).toBe('npm-scope');
    expect(result[3].source).toBe('@nanogemclaw-plugin/aaa');
    expect(result[4].origin).toBe('npm-scope');
    expect(result[4].source).toBe('@nanogemclaw-plugin/zzz');
  });
});
