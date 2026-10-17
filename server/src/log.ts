export type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, message, ...fields }));
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
