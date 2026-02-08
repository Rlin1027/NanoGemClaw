import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { AdditionalMount, MountAllowlist } from '../types.js';

// Set required env var before any imports
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
});

// Mock logger
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock config
vi.mock('../config.js', () => ({
  MOUNT_ALLOWLIST_PATH: '/test/config/mount-allowlist.json',
}));

// Mock fs module
const mockFs = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  realpathSync: vi.fn(),
};

vi.mock('fs', () => ({
  default: mockFs,
}));

describe('mount-security', () => {
  let validateMount: any;
  let validateAdditionalMounts: any;
  let generateAllowlistTemplate: any;
  let loadMountAllowlist: any;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();
    vi.resetModules();

    // Mock HOME environment variable
    process.env.HOME = '/Users/testuser';

    // Reset fs mocks to defaults
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('{}');
    mockFs.realpathSync.mockImplementation((p: string) => p);

    // Dynamically import to get fresh module instance
    const module = await import('../mount-security.js');
    validateMount = module.validateMount;
    validateAdditionalMounts = module.validateAdditionalMounts;
    generateAllowlistTemplate = module.generateAllowlistTemplate;
    loadMountAllowlist = module.loadMountAllowlist;
  });

  describe('loadMountAllowlist', () => {
    it('should return null when allowlist file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = loadMountAllowlist();

      expect(result).toBeNull();
      expect(mockFs.existsSync).toHaveBeenCalledWith(
        '/test/config/mount-allowlist.json',
      );
    });

    it('should load and parse valid allowlist file', () => {
      const validAllowlist: MountAllowlist = {
        allowedRoots: [{ path: '~/projects', allowReadWrite: true }],
        blockedPatterns: ['secret'],
        nonMainReadOnly: true,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(validAllowlist));

      const result = loadMountAllowlist();

      expect(result).not.toBeNull();
      expect(result?.allowedRoots).toHaveLength(1);
      expect(result?.allowedRoots[0].path).toBe('~/projects');
      expect(result?.nonMainReadOnly).toBe(true);
    });

    it('should merge default blocked patterns with custom patterns', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [],
        blockedPatterns: ['custom-pattern'],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));

      const result = loadMountAllowlist();

      expect(result?.blockedPatterns).toContain('custom-pattern');
      expect(result?.blockedPatterns).toContain('.ssh');
      expect(result?.blockedPatterns).toContain('.aws');
    });

    it('should return null when allowedRoots is not an array', () => {
      const invalidAllowlist = {
        allowedRoots: 'not-an-array',
        blockedPatterns: [],
        nonMainReadOnly: true,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidAllowlist));

      const result = loadMountAllowlist();

      expect(result).toBeNull();
    });

    it('should return null when blockedPatterns is not an array', () => {
      const invalidAllowlist = {
        allowedRoots: [],
        blockedPatterns: 'not-an-array',
        nonMainReadOnly: true,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidAllowlist));

      const result = loadMountAllowlist();

      expect(result).toBeNull();
    });

    it('should return null when nonMainReadOnly is not a boolean', () => {
      const invalidAllowlist = {
        allowedRoots: [],
        blockedPatterns: [],
        nonMainReadOnly: 'not-a-boolean',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidAllowlist));

      const result = loadMountAllowlist();

      expect(result).toBeNull();
    });

    it('should return null when JSON parsing fails', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid-json{');

      const result = loadMountAllowlist();

      expect(result).toBeNull();
    });

    it('should cache allowlist after first successful load', async () => {
      const validAllowlist: MountAllowlist = {
        allowedRoots: [],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(validAllowlist));

      // First load
      const result1 = loadMountAllowlist();
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(1);

      // Second load should use cache
      const result2 = loadMountAllowlist();
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(1); // Still 1, not 2
      expect(result1).toBe(result2);
    });
  });

  describe('validateMount', () => {
    it('should reject mount when no allowlist is configured', () => {
      mockFs.existsSync.mockReturnValue(false);

      const mount: AdditionalMount = {
        hostPath: '/some/path',
        containerPath: 'data',
      };

      const result = validateMount(mount, true);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('No mount allowlist configured');
    });

    it('should reject mount with containerPath containing ".."', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));

      const mount: AdditionalMount = {
        hostPath: '/allowed/path',
        containerPath: '../escape',
      };

      const result = validateMount(mount, true);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Invalid container path');
      expect(result.reason).toContain('..');
    });

    it('should reject mount with empty containerPath', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));

      const mount: AdditionalMount = {
        hostPath: '/allowed/path',
        containerPath: '',
      };

      const result = validateMount(mount, true);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Invalid container path');
    });

    it('should reject mount with containerPath starting with "/"', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));

      const mount: AdditionalMount = {
        hostPath: '/allowed/path',
        containerPath: '/absolute',
      };

      const result = validateMount(mount, true);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Invalid container path');
    });

    it('should reject mount when hostPath does not exist', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));
      mockFs.realpathSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const mount: AdditionalMount = {
        hostPath: '/nonexistent/path',
        containerPath: 'data',
      };

      const result = validateMount(mount, true);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Host path does not exist');
    });

    it('should reject mount matching blocked pattern in path component', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));
      mockFs.realpathSync.mockReturnValue('/allowed/.ssh/keys');

      const mount: AdditionalMount = {
        hostPath: '/allowed/.ssh/keys',
        containerPath: 'keys',
      };

      const result = validateMount(mount, true);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('matches blocked pattern');
      expect(result.reason).toContain('.ssh');
    });

    it('should reject mount matching custom blocked pattern', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: true }],
        blockedPatterns: ['secret-data'],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));
      mockFs.realpathSync.mockReturnValue('/allowed/secret-data');

      const mount: AdditionalMount = {
        hostPath: '/allowed/secret-data',
        containerPath: 'data',
      };

      const result = validateMount(mount, true);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('matches blocked pattern');
      expect(result.reason).toContain('secret-data');
    });

    it('should reject mount not under any allowed root', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));
      mockFs.realpathSync.mockImplementation((p: string) => {
        if (p === '/allowed') return '/allowed';
        return '/outside/path';
      });

      const mount: AdditionalMount = {
        hostPath: '/outside/path',
        containerPath: 'data',
      };

      const result = validateMount(mount, true);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not under any allowed root');
    });

    it('should allow valid mount under allowed root', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));
      mockFs.realpathSync.mockImplementation((p: string) => {
        if (p === '/allowed') return '/allowed';
        return '/allowed/subdir';
      });

      const mount: AdditionalMount = {
        hostPath: '/allowed/subdir',
        containerPath: 'data',
      };

      const result = validateMount(mount, true);

      expect(result.allowed).toBe(true);
      expect(result.realHostPath).toBe('/allowed/subdir');
    });

    it('should set readonly to true by default when not specified', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));
      mockFs.realpathSync.mockImplementation((p: string) => {
        if (p === '/allowed') return '/allowed';
        return '/allowed/data';
      });

      const mount: AdditionalMount = {
        hostPath: '/allowed/data',
        containerPath: 'data',
      };

      const result = validateMount(mount, true);

      expect(result.allowed).toBe(true);
      expect(result.effectiveReadonly).toBe(true);
    });

    it('should allow read-write when requested for main group and root allows it', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));
      mockFs.realpathSync.mockImplementation((p: string) => {
        if (p === '/allowed') return '/allowed';
        return '/allowed/data';
      });

      const mount: AdditionalMount = {
        hostPath: '/allowed/data',
        containerPath: 'data',
        readonly: false,
      };

      const result = validateMount(mount, true);

      expect(result.allowed).toBe(true);
      expect(result.effectiveReadonly).toBe(false);
    });

    it('should force readonly for non-main group when nonMainReadOnly is true', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: true,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));
      mockFs.realpathSync.mockImplementation((p: string) => {
        if (p === '/allowed') return '/allowed';
        return '/allowed/data';
      });

      const mount: AdditionalMount = {
        hostPath: '/allowed/data',
        containerPath: 'data',
        readonly: false,
      };

      const result = validateMount(mount, false); // isMain = false

      expect(result.allowed).toBe(true);
      expect(result.effectiveReadonly).toBe(true);
    });

    it('should force readonly when root does not allow read-write', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: false }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));
      mockFs.realpathSync.mockImplementation((p: string) => {
        if (p === '/allowed') return '/allowed';
        return '/allowed/data';
      });

      const mount: AdditionalMount = {
        hostPath: '/allowed/data',
        containerPath: 'data',
        readonly: false,
      };

      const result = validateMount(mount, true);

      expect(result.allowed).toBe(true);
      expect(result.effectiveReadonly).toBe(true);
    });

    it('should expand tilde in hostPath', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '~/projects', allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));
      mockFs.realpathSync.mockImplementation((p: string) => {
        if (p === '/Users/testuser/projects') return '/Users/testuser/projects';
        return '/Users/testuser/projects/myapp';
      });

      const mount: AdditionalMount = {
        hostPath: '~/projects/myapp',
        containerPath: 'app',
      };

      const result = validateMount(mount, true);

      expect(result.allowed).toBe(true);
      expect(result.realHostPath).toBe('/Users/testuser/projects/myapp');
    });
  });

  describe('validateAdditionalMounts', () => {
    it('should return empty array when all mounts are rejected', () => {
      mockFs.existsSync.mockReturnValue(false);

      const mounts: AdditionalMount[] = [
        { hostPath: '/path1', containerPath: 'data1' },
        { hostPath: '/path2', containerPath: 'data2' },
      ];

      const result = validateAdditionalMounts(mounts, 'test-group', true);

      expect(result).toHaveLength(0);
    });

    it('should return validated mounts with /workspace/extra/ prefix', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));
      mockFs.realpathSync.mockImplementation((p: string) => {
        if (p === '/allowed') return '/allowed';
        if (p === '/allowed/data1') return '/allowed/data1';
        if (p === '/allowed/data2') return '/allowed/data2';
        return p;
      });

      const mounts: AdditionalMount[] = [
        { hostPath: '/allowed/data1', containerPath: 'data1' },
        { hostPath: '/allowed/data2', containerPath: 'data2', readonly: false },
      ];

      const result = validateAdditionalMounts(mounts, 'test-group', true);

      expect(result).toHaveLength(2);
      expect(result[0].containerPath).toBe('/workspace/extra/data1');
      expect(result[1].containerPath).toBe('/workspace/extra/data2');
    });

    it('should filter out rejected mounts', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));
      mockFs.realpathSync.mockImplementation((p: string) => {
        if (p === '/allowed') return '/allowed';
        if (p === '/allowed/good') return '/allowed/good';
        throw new Error('ENOENT'); // Reject other paths
      });

      const mounts: AdditionalMount[] = [
        { hostPath: '/allowed/good', containerPath: 'good' },
        { hostPath: '/nonexistent', containerPath: 'bad' },
      ];

      const result = validateAdditionalMounts(mounts, 'test-group', true);

      expect(result).toHaveLength(1);
      expect(result[0].containerPath).toBe('/workspace/extra/good');
    });

    it('should use realHostPath in validated results', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));
      mockFs.realpathSync.mockImplementation((p: string) => {
        if (p === '/allowed') return '/real/allowed';
        if (p === '/allowed/link') return '/real/allowed/target';
        return p;
      });

      const mounts: AdditionalMount[] = [
        { hostPath: '/allowed/link', containerPath: 'data' },
      ];

      const result = validateAdditionalMounts(mounts, 'test-group', true);

      expect(result).toHaveLength(1);
      expect(result[0].hostPath).toBe('/real/allowed/target');
    });

    it('should respect readonly settings in validated results', () => {
      const allowlist: MountAllowlist = {
        allowedRoots: [{ path: '/allowed', allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(allowlist));
      mockFs.realpathSync.mockImplementation((p: string) => {
        if (p === '/allowed') return '/allowed';
        return '/allowed/data';
      });

      const mounts: AdditionalMount[] = [
        { hostPath: '/allowed/data', containerPath: 'ro' },
        { hostPath: '/allowed/data', containerPath: 'rw', readonly: false },
      ];

      const result = validateAdditionalMounts(mounts, 'test-group', true);

      expect(result).toHaveLength(2);
      expect(result[0].readonly).toBe(true);
      expect(result[1].readonly).toBe(false);
    });
  });

  describe('generateAllowlistTemplate', () => {
    it('should return valid JSON string', () => {
      const template = generateAllowlistTemplate();

      expect(() => JSON.parse(template)).not.toThrow();
    });

    it('should include all required fields', () => {
      const template = generateAllowlistTemplate();
      const parsed: MountAllowlist = JSON.parse(template);

      expect(parsed).toHaveProperty('allowedRoots');
      expect(parsed).toHaveProperty('blockedPatterns');
      expect(parsed).toHaveProperty('nonMainReadOnly');
    });

    it('should have allowedRoots as array', () => {
      const template = generateAllowlistTemplate();
      const parsed: MountAllowlist = JSON.parse(template);

      expect(Array.isArray(parsed.allowedRoots)).toBe(true);
      expect(parsed.allowedRoots.length).toBeGreaterThan(0);
    });

    it('should have blockedPatterns as array', () => {
      const template = generateAllowlistTemplate();
      const parsed: MountAllowlist = JSON.parse(template);

      expect(Array.isArray(parsed.blockedPatterns)).toBe(true);
    });

    it('should have nonMainReadOnly as boolean', () => {
      const template = generateAllowlistTemplate();
      const parsed: MountAllowlist = JSON.parse(template);

      expect(typeof parsed.nonMainReadOnly).toBe('boolean');
    });

    it('should include example allowedRoots with required properties', () => {
      const template = generateAllowlistTemplate();
      const parsed: MountAllowlist = JSON.parse(template);

      const firstRoot = parsed.allowedRoots[0];
      expect(firstRoot).toHaveProperty('path');
      expect(firstRoot).toHaveProperty('allowReadWrite');
      expect(typeof firstRoot.path).toBe('string');
      expect(typeof firstRoot.allowReadWrite).toBe('boolean');
    });
  });
});
