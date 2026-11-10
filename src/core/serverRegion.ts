// Turns a Roblox server address into a place name such as "Ashburn, US".
//
// Roblox's logs give a private 10.x address for the game server and a public
// address for the relay in front of it (seen in real logs, 2026-11-09). Only
// the public one can be located, so private addresses never leave the machine.

const MAX_LABEL_LENGTH = 64;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isPublicIpv4(ip: string): boolean {
  if (!IPV4.test(ip)) return false;
  const [a = 0, b = 0, c = 0, d = 0] = ip.split(".").map(Number);
  if ([a, b, c, d].some((octet) => octet > 255)) return false;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  return true;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const known = new Map<string, string>();

/** Returns null when the place can't be worked out. Failures aren't remembered, so a later join can succeed. */
export async function lookUpServerRegion(ip: string): Promise<string | null> {
  if (!isPublicIpv4(ip)) return null;
  const cached = known.get(ip);
  if (cached) return cached;

  try {
    const res = await fetch(`https://ipinfo.io/${ip}/json`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const info = (await res.json()) as { city?: unknown; country?: unknown };
    const label = [text(info.city), text(info.country)].filter(Boolean).join(", ").slice(0, MAX_LABEL_LENGTH);
    if (!label) return null;
    known.set(ip, label);
    return label;
  } catch {
    return null;
  }
}
