import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted mocks (must be before any imports that use them)
// ============================================================================

const { mockListTools, mockCallTool, mockConnect, mockClose } = vi.hoisted(() => {
    const mockListTools = vi.fn();
    const mockCallTool = vi.fn();
    const mockConnect = vi.fn();
    const mockClose = vi.fn();
    return { mockListTools, mockCallTool, mockConnect, mockClose };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
    return {
        Client: function Client() {
            return {
                connect: mockConnect,
                close: mockClose,
                listTools: mockListTools,
                callTool: mockCallTool,
            };
        },
    };
});

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
    return {
        StdioClientTransport: function StdioClientTransport(params: unknown) {
            return { _params: params, pid: 12345 };
        },
    };
});

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => {
    return {
        SSEClientTransport: function SSEClientTransport(url: unknown) {
            return { _url: url };
        },
    };
});

vi.mock('@nanogemclaw/core', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

// Mock gemini-tools cache invalidation
vi.mock('../../../src/gemini-tools.js', () => ({
    clearDeclarationCache: vi.fn(),
}));

// ============================================================================
// Import the module under test AFTER mocks are registered
// ============================================================================

import { McpBridge } from '../mcp-bridge.js';
import type { McpServerConfig } from '../mcp-types.js';

// ============================================================================
// Test fixtures
// ============================================================================

const stdioConfig: McpServerConfig = {
    id: 'testserver',
    name: 'Test Server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'some-mcp-server'],
    permission: 'any',
    enabled: true,
    timeout: 5000,
    autoReconnect: false,
};

const sseConfig: McpServerConfig = {
    id: 'sseserver',
    name: 'SSE Server',
    transport: 'sse',
    url: 'http://localhost:8080/sse',
    permission: 'any',
    enabled: true,
    timeout: 5000,
    autoReconnect: false,
};

const mockToolExecutionContext = {
    groupFolder: 'test',
    chatJid: '-100123',
    isMain: false,
    sendMessage: vi.fn(),
};

const DEFAULT_TOOLS = [
    {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path' },
            },
            required: ['path'],
        },
    },
    {
        name: 'list_dir',
        description: 'List directory',
        inputSchema: {
            type: 'object',
            properties: {
                dir: { type: 'string' },
            },
        },
    },
];

// ============================================================================
// Tests
// ============================================================================

describe('McpBridge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockConnect.mockResolvedValue(undefined);
        mockClose.mockResolvedValue(undefined);
        mockListTools.mockResolvedValue({ tools: DEFAULT_TOOLS });
    });

    describe('initial state', () => {
        it('starts in disconnected state', () => {
            const bridge = new McpBridge(stdioConfig);
            expect(bridge.getState()).toBe('disconnected');
        });

        it('returns empty tool declarations when disconnected', () => {
            const bridge = new McpBridge(stdioConfig);
            expect(bridge.getToolDeclarations()).toHaveLength(0);
        });
    });

    describe('connect() - stdio', () => {
        it('connects to stdio server and fetches tools', async () => {
            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            expect(bridge.getState()).toBe('connected');
            expect(mockConnect).toHaveBeenCalled();
            expect(mockListTools).toHaveBeenCalled();
        });

        it('returns tool declarations after connecting', async () => {
            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            const tools = bridge.getToolDeclarations();
            expect(tools).toHaveLength(2);
            expect(tools[0].name).toBe('mcp_testserver_read_file');
            expect(tools[1].name).toBe('mcp_testserver_list_dir');
        });

        it('prefixes tool names with mcp_{serverId}_', async () => {
            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            const tools = bridge.getToolDeclarations();
            for (const tool of tools) {
                expect(tool.name).toMatch(/^mcp_testserver_/);
            }
        });

        it('converts MCP tool schema to Gemini format', async () => {
            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            const tools = bridge.getToolDeclarations();
            const readFile = tools.find((t) => t.name === 'mcp_testserver_read_file');
            expect(readFile).toBeDefined();
            expect(readFile!.parameters).toMatchObject({
                type: 'OBJECT',
                properties: {
                    path: { type: 'STRING', description: 'File path' },
                },
                required: ['path'],
            });
        });

        it('sets correct permission from config', async () => {
            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            const tools = bridge.getToolDeclarations();
            for (const tool of tools) {
                expect(tool.permission).toBe('any');
            }
        });

        it('transitions to error state on connection failure', async () => {
            mockConnect.mockRejectedValueOnce(new Error('Connection refused'));

            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            expect(bridge.getState()).toBe('error');
        });

        it('does not re-connect when already connected', async () => {
            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            // Reset call count
            mockConnect.mockClear();

            // Second connect should be no-op
            await bridge.connect();
            expect(mockConnect).not.toHaveBeenCalled();
        });
    });

    describe('connect() - SSE', () => {
        it('connects to SSE server', async () => {
            const bridge = new McpBridge(sseConfig);
            await bridge.connect();

            expect(bridge.getState()).toBe('connected');
        });

        it('returns SSE tools after connecting', async () => {
            const bridge = new McpBridge(sseConfig);
            await bridge.connect();

            const tools = bridge.getToolDeclarations();
            expect(tools).toHaveLength(2);
            expect(tools[0].name).toBe('mcp_sseserver_read_file');
        });
    });

    describe('disconnect()', () => {
        it('disconnects and clears tools', async () => {
            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();
            expect(bridge.getToolDeclarations()).toHaveLength(2);

            await bridge.disconnect();

            expect(bridge.getState()).toBe('disconnected');
            expect(bridge.getToolDeclarations()).toHaveLength(0);
            expect(mockClose).toHaveBeenCalled();
        });

        it('is safe to call when already disconnected', async () => {
            const bridge = new McpBridge(stdioConfig);
            await bridge.disconnect(); // Should not throw

            expect(bridge.getState()).toBe('disconnected');
        });
    });

    describe('execute() closure', () => {
        it('returns error when bridge is disconnected after connecting', async () => {
            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            const tools = bridge.getToolDeclarations();
            const readFile = tools.find((t) => t.name === 'mcp_testserver_read_file');
            expect(readFile).toBeDefined();

            // Disconnect the bridge
            await bridge.disconnect();

            // Execute should return error, not throw
            const result = await readFile!.execute({ path: '/test' }, mockToolExecutionContext);
            const parsed = JSON.parse(result);
            expect(parsed.success).toBe(false);
            expect(parsed.error).toContain('testserver');
            expect(parsed.error).toContain('not connected');
        });

        it('calls callTool with unprefixed tool name', async () => {
            mockCallTool.mockResolvedValueOnce({
                content: [{ type: 'text', text: 'file contents' }],
                isError: false,
            });

            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            const tools = bridge.getToolDeclarations();
            const readFile = tools.find((t) => t.name === 'mcp_testserver_read_file');

            await readFile!.execute({ path: '/test/file.txt' }, mockToolExecutionContext);

            // Should be called with the original (unprefixed) tool name
            expect(mockCallTool).toHaveBeenCalledWith({
                name: 'read_file',
                arguments: { path: '/test/file.txt' },
            });
        });
    });

    describe('executeTool()', () => {
        it('returns success response for successful tool call', async () => {
            mockCallTool.mockResolvedValueOnce({
                content: [{ type: 'text', text: 'hello world' }],
                isError: false,
            });

            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            const result = await bridge.executeTool('read_file', { path: '/test' }, mockToolExecutionContext);
            const parsed = JSON.parse(result);

            expect(parsed.success).toBe(true);
            expect(parsed.data.text).toBe('hello world');
        });

        it('returns error response when MCP tool returns isError: true', async () => {
            mockCallTool.mockResolvedValueOnce({
                content: [{ type: 'text', text: 'File not found' }],
                isError: true,
            });

            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            const result = await bridge.executeTool('read_file', { path: '/nonexistent' }, mockToolExecutionContext);
            const parsed = JSON.parse(result);

            expect(parsed.success).toBe(false);
            expect(parsed.error).toContain('File not found');
        });

        it('returns error when not connected', async () => {
            const bridge = new McpBridge(stdioConfig);
            // Don't connect

            const result = await bridge.executeTool('read_file', {}, mockToolExecutionContext);
            const parsed = JSON.parse(result);

            expect(parsed.success).toBe(false);
            expect(parsed.error).toContain('not connected');
        });

        it('handles tool execution exceptions gracefully', async () => {
            mockCallTool.mockRejectedValueOnce(new Error('Network error'));

            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            const result = await bridge.executeTool('read_file', { path: '/test' }, mockToolExecutionContext);
            const parsed = JSON.parse(result);

            expect(parsed.success).toBe(false);
            expect(parsed.error).toContain('Network error');
        });
    });

    describe('tool schema conversion', () => {
        it('handles tools with no inputSchema', async () => {
            mockListTools.mockResolvedValueOnce({
                tools: [
                    {
                        name: 'ping',
                        description: 'Ping the server',
                        // No inputSchema
                    },
                ],
            });

            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            const tools = bridge.getToolDeclarations();
            expect(tools).toHaveLength(1);
            expect(tools[0].parameters).toEqual({ type: 'OBJECT', properties: {} });
        });

        it('handles string, number, boolean schema types', async () => {
            mockListTools.mockResolvedValueOnce({
                tools: [
                    {
                        name: 'test_tool',
                        description: 'Test',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                text: { type: 'string' },
                                count: { type: 'number' },
                                flag: { type: 'boolean' },
                            },
                        },
                    },
                ],
            });

            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            const tools = bridge.getToolDeclarations();
            expect(tools).toHaveLength(1);
            const params = tools[0].parameters as Record<string, unknown>;
            const props = params.properties as Record<string, unknown>;

            expect((props.text as Record<string, unknown>).type).toBe('STRING');
            expect((props.count as Record<string, unknown>).type).toBe('NUMBER');
            expect((props.flag as Record<string, unknown>).type).toBe('BOOLEAN');
        });

        it('handles array schema type', async () => {
            mockListTools.mockResolvedValueOnce({
                tools: [
                    {
                        name: 'test_tool',
                        description: 'Test',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                items: {
                                    type: 'array',
                                    items: { type: 'string' },
                                },
                            },
                        },
                    },
                ],
            });

            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            const tools = bridge.getToolDeclarations();
            expect(tools).toHaveLength(1);
            const params = tools[0].parameters as Record<string, unknown>;
            const props = params.properties as Record<string, unknown>;
            const items = props.items as Record<string, unknown>;

            expect(items.type).toBe('ARRAY');
            expect((items.items as Record<string, unknown>).type).toBe('STRING');
        });

        it('handles integer type as NUMBER', async () => {
            mockListTools.mockResolvedValueOnce({
                tools: [
                    {
                        name: 'test_tool',
                        description: 'Test',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                count: { type: 'integer' },
                            },
                        },
                    },
                ],
            });

            const bridge = new McpBridge(stdioConfig);
            await bridge.connect();

            const tools = bridge.getToolDeclarations();
            const params = tools[0].parameters as Record<string, unknown>;
            const props = params.properties as Record<string, unknown>;
            expect((props.count as Record<string, unknown>).type).toBe('NUMBER');
        });
    });
});
