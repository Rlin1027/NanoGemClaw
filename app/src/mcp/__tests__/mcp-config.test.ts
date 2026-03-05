import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateMcpConfig, loadMcpConfig } from '../mcp-config.js';

vi.mock('@nanogemclaw/core', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
    },
}));

describe('validateMcpConfig', () => {
    it('accepts valid stdio server config', () => {
        const result = validateMcpConfig({
            servers: [
                {
                    id: 'filesystem',
                    name: 'Filesystem',
                    transport: 'stdio',
                    command: 'npx',
                    args: ['-y', '@modelcontextprotocol/server-filesystem'],
                    permission: 'main',
                    enabled: true,
                },
            ],
        });

        expect(result.servers).toHaveLength(1);
        expect(result.servers[0].id).toBe('filesystem');
    });

    it('accepts valid sse server config', () => {
        const result = validateMcpConfig({
            servers: [
                {
                    id: 'weather',
                    name: 'Weather API',
                    transport: 'sse',
                    url: 'http://localhost:8080/sse',
                    permission: 'any',
                    enabled: true,
                },
            ],
        });

        expect(result.servers).toHaveLength(1);
        expect(result.servers[0].id).toBe('weather');
    });

    it('rejects invalid server ID (uppercase)', () => {
        const result = validateMcpConfig({
            servers: [
                {
                    id: 'MyServer',
                    name: 'Bad ID',
                    transport: 'stdio',
                    command: 'npx',
                    permission: 'any',
                    enabled: true,
                },
            ],
        });

        expect(result.servers).toHaveLength(0);
    });

    it('rejects invalid server ID (special chars)', () => {
        const result = validateMcpConfig({
            servers: [
                {
                    id: 'my-server',
                    name: 'Bad ID',
                    transport: 'stdio',
                    command: 'npx',
                    permission: 'any',
                    enabled: true,
                },
            ],
        });

        expect(result.servers).toHaveLength(0);
    });

    it('rejects stdio server without command', () => {
        const result = validateMcpConfig({
            servers: [
                {
                    id: 'bad',
                    name: 'Bad',
                    transport: 'stdio',
                    permission: 'any',
                    enabled: true,
                },
            ],
        });

        expect(result.servers).toHaveLength(0);
    });

    it('rejects sse server without url', () => {
        const result = validateMcpConfig({
            servers: [
                {
                    id: 'bad',
                    name: 'Bad',
                    transport: 'sse',
                    permission: 'any',
                    enabled: true,
                },
            ],
        });

        expect(result.servers).toHaveLength(0);
    });

    it('rejects sse server with invalid url', () => {
        const result = validateMcpConfig({
            servers: [
                {
                    id: 'bad',
                    name: 'Bad',
                    transport: 'sse',
                    url: 'not-a-url',
                    permission: 'any',
                    enabled: true,
                },
            ],
        });

        expect(result.servers).toHaveLength(0);
    });

    it('skips duplicate server IDs', () => {
        const result = validateMcpConfig({
            servers: [
                {
                    id: 'fs',
                    name: 'First',
                    transport: 'stdio',
                    command: 'npx',
                    permission: 'main',
                    enabled: true,
                },
                {
                    id: 'fs',
                    name: 'Duplicate',
                    transport: 'stdio',
                    command: 'npx',
                    permission: 'main',
                    enabled: true,
                },
            ],
        });

        expect(result.servers).toHaveLength(1);
        expect(result.servers[0].name).toBe('First');
    });

    it('returns empty servers for completely invalid input', () => {
        const result = validateMcpConfig('not an object');
        expect(result.servers).toHaveLength(0);
    });

    it('returns empty servers for null', () => {
        const result = validateMcpConfig(null);
        expect(result.servers).toHaveLength(0);
    });

    it('accepts multiple valid servers', () => {
        const result = validateMcpConfig({
            servers: [
                {
                    id: 'fs',
                    name: 'Filesystem',
                    transport: 'stdio',
                    command: 'npx',
                    permission: 'main',
                    enabled: true,
                },
                {
                    id: 'weather',
                    name: 'Weather',
                    transport: 'sse',
                    url: 'http://localhost:8080/sse',
                    permission: 'any',
                    enabled: false,
                },
            ],
        });

        expect(result.servers).toHaveLength(2);
    });
});

describe('loadMcpConfig', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('returns empty servers when file does not exist', async () => {
        const fs = await import('fs');
        vi.mocked(fs.default.existsSync).mockReturnValue(false);

        const result = loadMcpConfig('/fake/data');
        expect(result.servers).toHaveLength(0);
    });

    it('returns empty servers when file is invalid JSON', async () => {
        const fs = await import('fs');
        vi.mocked(fs.default.existsSync).mockReturnValue(true);
        vi.mocked(fs.default.readFileSync).mockReturnValue('not json' as unknown as Buffer);

        const result = loadMcpConfig('/fake/data');
        expect(result.servers).toHaveLength(0);
    });

    it('loads and validates valid config', async () => {
        const fs = await import('fs');
        vi.mocked(fs.default.existsSync).mockReturnValue(true);
        vi.mocked(fs.default.readFileSync).mockReturnValue(
            JSON.stringify({
                servers: [
                    {
                        id: 'fs',
                        name: 'Filesystem',
                        transport: 'stdio',
                        command: 'npx',
                        permission: 'main',
                        enabled: true,
                    },
                ],
            }) as unknown as Buffer,
        );

        const result = loadMcpConfig('/fake/data');
        expect(result.servers).toHaveLength(1);
        expect(result.servers[0].id).toBe('fs');
    });
});
