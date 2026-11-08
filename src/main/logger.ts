import { redact } from "../core/redact";

type Sink = (line: string) => void;

const sinks = new Set<Sink>();
const history: string[] = [];

/** Every log line is redacted before it goes anywhere. */
export function log(message: string): void {
  const line = `${new Date().toTimeString().slice(0, 8)}  ${redact(message)}`;
  history.push(line);
  if (history.length > 500) history.shift();
  console.log(line);
  for (const sink of sinks) sink(line);
}

export function onLog(sink: Sink): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

export function logHistory(): string[] {
  return [...history];
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
