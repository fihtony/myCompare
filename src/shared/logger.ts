/**
 * Simple logging utility for both main and renderer processes.
 * Prefix format: [Source] message
 */

export function log(source: string, message: string, ...args: any[]): void {
  const prefix = `[${source}]`;
  console.log(prefix, message, ...args);
}

export function warn(source: string, message: string, ...args: any[]): void {
  const prefix = `[${source}]`;
  console.warn(prefix, message, ...args);
}

export function error(source: string, message: string, err?: Error | unknown): void {
  const prefix = `[${source}]`;
  if (err instanceof Error) {
    console.error(prefix, message, err.message);
  } else if (err) {
    console.error(prefix, message, String(err));
  } else {
    console.error(prefix, message);
  }
}
