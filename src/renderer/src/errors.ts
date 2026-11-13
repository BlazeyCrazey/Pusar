/** The text to show for something that went wrong. Errors from the main process are already sentences. */
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
