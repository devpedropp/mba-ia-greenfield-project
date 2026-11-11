export function videoIdFromKey(key: string): string {
  const match = key.match(/^videos\/([^/]+)\//);
  if (!match) {
    throw new Error(`Unable to derive videoId from storage key "${key}"`);
  }
  return match[1];
}
