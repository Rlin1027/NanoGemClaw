/**
 * NanoGemClaw Agent Runner
 * Runs Gemini CLI inside a container via spawn, receives config via stdin, outputs result to stdout
 * 
 * This replaces the Claude Agent SDK with Gemini CLI headless mode
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { writeIpcFile, IPC_DIR, MESSAGES_DIR, TASKS_DIR } from './ipc-tools.js';

// ============================================================================
// Types
// ============================================================================

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  /** Custom system prompt for group persona */
  systemPrompt?: string;
  /** Enable Google Search grounding (default: true) */
  enableWebSearch?: boolean;
  /** Path to media file (image/voice/document) for multi-modal input */
  mediaPath?: string;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface StreamEvent {
  type: 'init' | 'message' | 'tool_use' | 'tool_result' | 'error' | 'result';
  timestamp?: string;
  session_id?: string;
  model?: string;
  role?: 'user' | 'assistant';
  content?: string;
  tool_name?: string;
  tool_id?: string;
  parameters?: Record<string, unknown>;
  status?: string;
  output?: string;
  stats?: Record<string, unknown>;
}

// ============================================================================
// Output Handling
// ============================================================================

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

// ============================================================================
// Stdin Reading
// ============================================================================

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

// ============================================================================
// Gemini CLI Wrapper
// ============================================================================

async function runGeminiAgent(input: ContainerInput): Promise<ContainerOutput> {
  const args: string[] = [];

  // Build prompt with context
  let prompt = input.prompt;
  if (input.isScheduledTask) {
    prompt = `[SCHEDULED TASK - You are running automatically, not in response to a user message. Use the send_message tool if needed to communicate with the user.]\n\n${input.prompt}`;
  }

  // Inject custom system prompt if provided
  if (input.systemPrompt) {
    prompt = `[SYSTEM INSTRUCTIONS]\n${input.systemPrompt}\n[END SYSTEM INSTRUCTIONS]\n\n${prompt}`;
  }

  // Add system context about available IPC tools
  const systemContext = buildSystemContext(input);
  prompt = `${systemContext}\n\n---\n\nUser Request:\n${prompt}`;

  // Gemini CLI arguments
  args.push('-p', prompt);
  args.push('--output-format', 'stream-json');
  args.push('--yolo');  // Auto-approve all tool calls (like bypassPermissions)

  // Resume session if provided
  if (input.sessionId) {
    args.push('--resume', input.sessionId);
  }

  // Note: Model selection is handled by Gemini CLI settings (Auto mode)
  // Users can configure preferred model via `gemini /settings`

  log(`Running: gemini ${args.slice(0, 4).join(' ')}...`);

  return new Promise((resolve) => {
    const startTime = Date.now();

    const gemini = spawn('gemini', args, {
      cwd: '/workspace/group',
      env: {
        ...process.env,
        HOME: '/home/node',
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let sessionId: string | undefined;
    let lastResponse: string | null = null;

    gemini.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;

      // Parse streaming events
      const lines = chunk.split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const event: StreamEvent = JSON.parse(line);

          // Capture session ID from init event
          if (event.type === 'init' && event.session_id) {
            sessionId = event.session_id;
            log(`Session: ${sessionId}`);
          }

          // Capture assistant response - accumulate all message chunks
          if (event.type === 'message' && event.role === 'assistant' && event.content) {
            // Gemini CLI may send multiple message events for a single response
            // Append instead of overwrite to capture the full response
            if (lastResponse === null) {
              lastResponse = event.content;
            } else {
              lastResponse += event.content;
            }
          }

          // Log tool usage
          if (event.type === 'tool_use') {
            log(`Tool: ${event.tool_name}`);
          }
        } catch {
          // Not JSON, skip
        }
      }
    });

    gemini.stderr.on('data', (data) => {
      stderr += data.toString();
      // Log stderr but keep it brief
      const lines = data.toString().trim().split('\n');
      for (const line of lines.slice(-3)) {
        if (line && !line.includes('Session cleanup disabled')) {
          log(line.slice(0, 200));
        }
      }
    });

    // Timeout handling
    const timeout = setTimeout(() => {
      gemini.kill('SIGKILL');
      resolve({
        status: 'error',
        result: null,
        error: 'Agent timed out after 5 minutes',
      });
    }, 5 * 60 * 1000);

    gemini.on('close', (code) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startTime;

      if (code !== 0) {
        log(`Exit code ${code} after ${durationMs}ms`);
        resolve({
          status: 'error',
          result: null,
          newSessionId: sessionId,
          error: `Exit code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      // Extract response from events
      let response = lastResponse;

      // Fallback: try parsing last line as JSON
      if (!response) {
        const lines = stdout.trim().split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const event = JSON.parse(lines[i]);
            if (event.response) {
              response = event.response;
              break;
            }
            if (event.type === 'message' && event.role === 'assistant') {
              response = event.content;
              break;
            }
          } catch {
            continue;
          }
        }
      }

      log(`Completed in ${durationMs}ms`);

      resolve({
        status: 'success',
        result: response,
        newSessionId: sessionId,
      });
    });

    gemini.on('error', (err) => {
      clearTimeout(timeout);
      log(`Spawn error: ${err.message}`);
      resolve({
        status: 'error',
        result: null,
        error: `Spawn error: ${err.message}`,
      });
    });
  });
}

// ============================================================================
// System Context for IPC Tools
// ============================================================================

function loadRecentConversations(limit: number = 5): string {
  const conversationsDir = '/workspace/group/conversations';
  if (!fs.existsSync(conversationsDir)) return '';

  try {
    const files = fs.readdirSync(conversationsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(conversationsDir, f))
      .map(f => ({ path: f, mtime: fs.statSync(f).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime) // Newest first
      .slice(0, limit);

    if (files.length === 0) return '';

    // Reverse to chronological order for the prompt
    const archives = files.reverse().map(f => {
      const content = fs.readFileSync(f.path, 'utf-8');
      return `--- ARCHIVED CONVERSATION (${path.basename(f.path)}) ---\n${content}\n`;
    }).join('\n');

    return `\n\n=== LONG-TERM MEMORY (Recent Archives) ===\n${archives}\n==========================================\n`;
  } catch (err) {
    log(`Failed to load long-term memory: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

function buildSystemContext(input: ContainerInput): string {
  const { groupFolder, chatJid, isMain } = input;

  // Load long-term memory (NanoGemClaw feature: utilizing Gemini's large context window)
  const memoryContext = loadRecentConversations(10);

  // Read available tasks
  let tasksInfo = '';
  const tasksFile = path.join(IPC_DIR, 'current_tasks.json');
  if (fs.existsSync(tasksFile)) {
    try {
      const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
      const filteredTasks = isMain ? tasks : tasks.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);
      if (filteredTasks.length > 0) {
        tasksInfo = `\n\nCurrent scheduled tasks:\n${JSON.stringify(filteredTasks, null, 2)}`;
      }
    } catch {
      // Ignore
    }
  }

  // Read available groups (main only)
  let groupsInfo = '';
  if (isMain) {
    const groupsFile = path.join(IPC_DIR, 'available_groups.json');
    if (fs.existsSync(groupsFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(groupsFile, 'utf-8'));
        if (data.groups && data.groups.length > 0) {
          groupsInfo = `\n\nAvailable WhatsApp groups:\n${JSON.stringify(data.groups.slice(0, 10), null, 2)}`;
        }
      } catch {
        // Ignore
      }
    }
  }

  return `You are an AI assistant for NanoGemClaw. You are helping with the "${groupFolder}" group.

IMPORTANT: To interact with the messaging system, you must write JSON files to specific directories:

1. TO SEND A MESSAGE - Write to /workspace/ipc/messages/:
   {"type":"message","chatJid":"${chatJid}","text":"your message","timestamp":"..."}

2. TO SCHEDULE A TASK - Write to /workspace/ipc/tasks/:
   {"type":"schedule_task","prompt":"what to do","schedule_type":"cron|interval|once","schedule_value":"...","groupFolder":"${groupFolder}","chatJid":"${chatJid}"}

3. TO MANAGE TASKS - Write to /workspace/ipc/tasks/:
   {"type":"pause_task","taskId":"..."}
   {"type":"resume_task","taskId":"..."}
   {"type":"cancel_task","taskId":"..."}

${isMain ? `4. TO REGISTER A GROUP (main only) - Write to /workspace/ipc/tasks/:
   {"type":"register_group","jid":"...","name":"...","folder":"...","trigger":"@Andy"}` : ''}

WEB BROWSING:
You have access to the \`agent-browser\` CLI tool for advanced web interaction (Javascript, screenshots, etc).
Documentation is available at: \`/workspace/docs/agent-browser.md\`.
Example: \`agent-browser open https://google.com && agent-browser snapshot -i\`

Current context:
- Group: ${groupFolder}
- Chat JID: ${chatJid}
- Is Main Group: ${isMain}${tasksInfo}${groupsInfo}${memoryContext}

When you need to send a message or manage tasks, use the shell to write JSON files to the appropriate IPC directory.
Example: echo '{"type":"message","chatJid":"${chatJid}","text":"Hello!","timestamp":"'$(date -Iseconds)'"}' > /workspace/ipc/messages/$(date +%s)-msg.json`;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  let input: ContainerInput;

  try {
    const stdinData = await readStdin();
    input = JSON.parse(stdinData);
    log(`Received input for group: ${input.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`
    });
    process.exit(1);
  }

  // Validate required input fields
  const missingFields: string[] = [];
  if (!input.prompt) missingFields.push('prompt');
  if (!input.groupFolder) missingFields.push('groupFolder');
  if (!input.chatJid) missingFields.push('chatJid');

  if (missingFields.length > 0) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Missing required input fields: ${missingFields.join(', ')}`
    });
    process.exit(1);
  }

  // Ensure IPC directories exist
  fs.mkdirSync(MESSAGES_DIR, { recursive: true });
  fs.mkdirSync(TASKS_DIR, { recursive: true });

  try {
    const output = await runGeminiAgent(input);
    writeOutput(output);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      error: errorMessage
    });
    process.exit(1);
  }
}

main();
