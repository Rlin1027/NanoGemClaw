/**
 * Response Parser - Parse and extract structured data from agent responses.
 */

// ============================================================================
// Follow-up Suggestions Parsing
// ============================================================================

/**
 * Extract follow-up suggestions from agent response.
 * Lines starting with ">>>" are treated as suggestions.
 */
export function extractFollowUps(text: string): {
  cleanText: string;
  followUps: string[];
} {
  const lines = text.split('\n');
  const followUps: string[] = [];
  const contentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>>>')) {
      const suggestion = trimmed.slice(3).trim();
      if (suggestion) followUps.push(suggestion);
    } else {
      contentLines.push(line);
    }
  }

  // Remove trailing empty lines from content
  while (
    contentLines.length > 0 &&
    contentLines[contentLines.length - 1].trim() === ''
  ) {
    contentLines.pop();
  }

  return {
    cleanText: contentLines.join('\n'),
    followUps: followUps.slice(0, 3), // Max 3 suggestions
  };
}
