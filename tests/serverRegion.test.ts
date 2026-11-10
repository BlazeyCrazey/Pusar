import { afterEach, describe, expect, it, vi } from "vitest";
import { isPublicIpv4, lookUpServerRegion } from "../src/core/serverRegion";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(reply: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (_url: string) => reply());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("isPublicIpv4", () => {
  it.each(["128.116.46.33", "8.8.8.8", "172.32.0.1", "100.128.0.1"])("accepts %s", (ip) => {
    expect(isPublicIpv4(ip)).toBe(true);
  });

  it.each(["10.32.41.202", "192.168.50.1", "172.16.0.1", "172.31.255.255", "127.0.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1"])(
    "rejects private or reserved %s",
    (ip) => {
      expect(isPublicIpv4(ip)).toBe(false);
    },
  );

  it.each(["", "1.2.3", "1.2.3.4.5", "256.1.1.1", "1..2.3", "a.b.c.d", "128.116.46.33/../x"])("rejects malformed %j", (ip) => {
    expect(isPublicIpv4(ip)).toBe(false);
  });
});

describe("lookUpServerRegion", () => {
  it("never sends a private address anywhere", async () => {
    const fetchMock = stubFetch(() => Response.json({ city: "Nowhere", country: "XX" }));
    expect(await lookUpServerRegion("10.32.41.202")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds a city and country label", async () => {
    const fetchMock = stubFetch(() => Response.json({ city: "Ashburn", region: "Virginia", country: "US" }));
    expect(await lookUpServerRegion("128.116.1.1")).toBe("Ashburn, US");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://ipinfo.io/128.116.1.1/json");
  });

  it("remembers an address it has already located", async () => {
    const fetchMock = stubFetch(() => Response.json({ city: "Paris", country: "FR" }));
    await lookUpServerRegion("128.116.1.2");
    expect(await lookUpServerRegion("128.116.1.2")).toBe("Paris, FR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("makes do with only a country", async () => {
    stubFetch(() => Response.json({ country: "DE" }));
    expect(await lookUpServerRegion("128.116.1.3")).toBe("DE");
  });

  it("caps what a third party can put on screen", async () => {
    stubFetch(() => Response.json({ city: "x".repeat(500), country: "US" }));
    expect((await lookUpServerRegion("128.116.1.4"))?.length).toBe(64);
  });

  it("shows nothing for unusable answers, and tries again next time", async () => {
    const fetchMock = stubFetch(() => Response.json({ city: 5, country: null }));
    expect(await lookUpServerRegion("128.116.1.5")).toBeNull();
    await lookUpServerRegion("128.116.1.5");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows nothing when the service is limited or unreachable", async () => {
    stubFetch(() => new Response("", { status: 429 }));
    expect(await lookUpServerRegion("128.116.1.6")).toBeNull();
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await lookUpServerRegion("128.116.1.7")).toBeNull();
  });
});
