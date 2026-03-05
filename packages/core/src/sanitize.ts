const INJECTION_SCAN_MAX_BYTES = 50 * 1024; // 50KB

const INJECTION_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'role_override', pattern: /you\s+are\s+now\s+a/i },
  { name: 'ignore_instructions', pattern: /ignore\s+(all\s+)?previous\s+instructions/i },
  { name: 'system_prompt', pattern: /system\s*:\s*you\s+are/i },
  { name: 'system_tag', pattern: /<system>/i },
  { name: 'inst_tag', pattern: /\[INST\]/i },
  { name: 'override_directive', pattern: /\bdo\s+not\s+follow\s+(your|the)\s+(original|initial|system)/i },
  { name: 'new_instructions', pattern: /new\s+instructions?\s*:/i },
];

export interface ScanResult {
  status: 'clean' | 'suspicious' | 'skipped';
  patterns?: string[];
  reason?: string;
}

export function scanForInjection(text: string): ScanResult {
  if (Buffer.byteLength(text, 'utf8') > INJECTION_SCAN_MAX_BYTES) {
    return { status: 'skipped', reason: 'size_limit' };
  }
  const matched: string[] = [];
  for (const { name, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      matched.push(name);
    }
  }
  if (matched.length === 0) return { status: 'clean' };
  return { status: 'suspicious', patterns: matched };
}
