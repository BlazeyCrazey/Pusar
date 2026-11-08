// Removes Roblox credentials from any text before it is logged, shown, or
// copied. Every log line in Pusar goes through this (see PLAN.md §5.7).

const RULES: Array<[RegExp, string]> = [
  // .ROBLOSECURITY cookie values always start with this warning banner.
  [/_\|WARNING:-DO-NOT-SHARE-THIS[^\s"';,}]*/g, "[REDACTED_COOKIE]"],
  [/(\.ROBLOSECURITY=)[^;\s"']+/gi, "$1[REDACTED]"],
  // Auth ticket inside a roblox-player: launch URI.
  [/(gameinfo:)[^+\s"']+/gi, "$1[REDACTED]"],
  // Header names followed by a value, in JSON or "name: value" form.
  [
    /((?:rbx-authentication-ticket|x-bound-auth-token|x-csrf-token|cookie)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
    "$1[REDACTED]",
  ],
];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
