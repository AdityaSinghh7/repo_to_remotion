export const extractJsonObject = <T = unknown>(raw: string): T => {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // continue
  }

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim()) as T;
    } catch {
      // continue
    }
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const candidate = trimmed.slice(first, last + 1);
    return JSON.parse(candidate) as T;
  }

  throw new Error('No JSON object found in model output');
};

const stringifyUnknown = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stringifyUnknown(item)).join('\n');
  }

  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (typeof object.text === 'string') {
      return object.text;
    }

    if (typeof object.content === 'string') {
      return object.content;
    }

    if (Array.isArray(object.content)) {
      return stringifyUnknown(object.content);
    }
  }

  return '';
};

export const extractCodexAssistantTextFromJsonl = (jsonl: string): string => {
  const lines = jsonl
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates: string[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const direct = stringifyUnknown(event);
      if (direct) {
        candidates.push(direct);
      }

      if (Array.isArray(event.messages)) {
        for (const message of event.messages) {
          const text = stringifyUnknown(message);
          if (text) {
            candidates.push(text);
          }
        }
      }

      if (event.type === 'message' || event.type === 'assistant_message') {
        const text = stringifyUnknown(event.message ?? event.content ?? event);
        if (text) {
          candidates.push(text);
        }
      }
    } catch {
      // Ignore malformed lines and continue.
    }
  }

  if (candidates.length === 0) {
    throw new Error('No assistant message found in Codex JSON output');
  }

  return candidates[candidates.length - 1];
};
