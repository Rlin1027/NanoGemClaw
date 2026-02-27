/**
 * Container volume mount configuration and CLI argument building.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { CONTAINER_IMAGE, DATA_DIR, GROUPS_DIR } from './config.js';
import { validateAdditionalMounts } from './mount-security.js';
import { RegisteredGroup } from './types.js';

export interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

export function getHomeDir(): string {
  const home = process.env.HOME || os.homedir();
  if (!home) {
    throw new Error(
      'Unable to determine home directory: HOME environment variable is not set and os.homedir() returned empty',
    );
  }
  return home;
}

export function buildVolumeMounts(
  group: RegisteredGroup,
  isMain: boolean,
): VolumeMount[] {
  if (!/^[a-zA-Z0-9_-]+$/.test(group.folder)) {
    throw new Error(`Invalid group folder name: ${group.folder}`);
  }
  const mounts: VolumeMount[] = [];
  const homeDir = getHomeDir();
  const projectRoot = process.cwd();

  if (isMain) {
    // Main gets the project root mounted read-only to prevent code tampering
    mounts.push({
      hostPath: projectRoot,
      containerPath: '/workspace/project',
      readonly: true, // Security: prevent code tampering
    });

    // Main gets its group folder as the working directory (writable)
    // Note: Apple Container doesn't allow duplicate host paths in mounts,
    // so we only mount groups/main once at /workspace/group
    mounts.push({
      hostPath: path.join(GROUPS_DIR, group.folder),
      containerPath: '/workspace/group',
      readonly: false,
    });
  } else {
    // Other groups only get their own folder
    mounts.push({
      hostPath: path.join(GROUPS_DIR, group.folder),
      containerPath: '/workspace/group',
      readonly: false,
    });

    // Global memory directory (read-only for non-main)
    // Apple Container only supports directory mounts, not file mounts
    const globalDir = path.join(GROUPS_DIR, 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({
        hostPath: globalDir,
        containerPath: '/workspace/global',
        readonly: true,
      });
    }
  }

  // Filtered Gemini settings directory — only copy settings.json, never oauth_creds.json.
  // We create a temp directory under the group's data path and copy only safe files,
  // so the container never has access to OAuth credentials.
  const hostGeminiDir = path.join(homeDir, '.gemini');
  const filteredGeminiDir = path.join(
    DATA_DIR,
    'gemini-filtered',
    group.folder,
  );
  fs.mkdirSync(filteredGeminiDir, { recursive: true });
  if (fs.existsSync(hostGeminiDir)) {
    const settingsSrc = path.join(hostGeminiDir, 'settings.json');
    const settingsDst = path.join(filteredGeminiDir, 'settings.json');
    if (fs.existsSync(settingsSrc)) {
      fs.copyFileSync(settingsSrc, settingsDst);
    }
  }
  mounts.push({
    hostPath: filteredGeminiDir,
    containerPath: '/home/node/.gemini',
    readonly: true, // Security: filtered copy — no OAuth credentials exposed
  });

  // Per-group Gemini sessions directory (isolated from other groups)
  // This overrides the global .gemini/tmp for session isolation
  const groupSessionsDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    '.gemini-tmp',
  );
  fs.mkdirSync(groupSessionsDir, { recursive: true });
  mounts.push({
    hostPath: groupSessionsDir,
    containerPath: '/home/node/.gemini/tmp',
    readonly: false,
  });

  // Per-group IPC namespace: each group gets its own IPC directory
  // This prevents cross-group privilege escalation via IPC
  const groupIpcDir = path.join(DATA_DIR, 'ipc', group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  mounts.push({
    hostPath: groupIpcDir,
    containerPath: '/workspace/ipc',
    readonly: false,
  });

  // Environment file directory (workaround for Apple Container -i env var bug)
  // Only expose specific auth variables needed by Gemini CLI, not the entire .env
  const envDir = path.join(DATA_DIR, 'env', group.folder); // per-group isolation
  fs.mkdirSync(envDir, { recursive: true });
  const envFile = path.join(projectRoot, '.env');
  if (fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf-8');
    const allowedVars = ['GEMINI_API_KEY', 'GOOGLE_API_KEY'];
    const filteredLines = envContent.split('\n').filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return false;
      return allowedVars.some((v) => trimmed.startsWith(`${v}=`));
    });

    if (filteredLines.length > 0) {
      const quotedLines = filteredLines.map((line) => {
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) return line;
        const key = line.slice(0, eqIdx);
        const val = line.slice(eqIdx + 1).replace(/'/g, "'\\''");
        return `${key}='${val}'`;
      });
      fs.writeFileSync(path.join(envDir, 'env'), quotedLines.join('\n') + '\n');
      mounts.push({
        hostPath: envDir,
        containerPath: '/workspace/env-dir',
        readonly: true,
      });
    }
  }

  // Additional mounts validated against external allowlist (tamper-proof from containers)
  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      isMain,
    );
    mounts.push(...validatedMounts);
  }

  return mounts;
}

export function buildContainerArgs(mounts: VolumeMount[]): string[] {
  const args: string[] = ['run', '-i', '--rm'];

  // Apple Container: --mount for readonly, -v for read-write
  for (const mount of mounts) {
    if (mount.readonly) {
      args.push(
        '--mount',
        `type=bind,source=${mount.hostPath},target=${mount.containerPath},readonly`,
      );
    } else {
      args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
    }
  }

  args.push(CONTAINER_IMAGE);

  return args;
}
