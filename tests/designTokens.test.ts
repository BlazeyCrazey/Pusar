import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/renderer/src/styles/tokens.css", "utf8");

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i").exec(css);
  if (!match?.[1]) throw new Error(`No color token --${name}`);
  return match[1].toLowerCase();
}

function luminance(hex: string): number {
  const channel = (start: number) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("design tokens meet WCAG AA contrast", () => {
  const surfaces = ["bg-app", "bg-surface", "bg-raised"];

  it.each(surfaces.flatMap((bg) => ["text", "text-2", "text-3", "accent", "danger", "ok", "warn"].map((fg) => [fg, bg])))(
    "%s on %s",
    (fg, bg) => {
      expect(contrast(token(fg!), token(bg!))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("text stays readable on the accent button", () => {
    for (const bg of ["accent", "accent-hover", "accent-press"]) {
      expect(contrast(token("on-accent"), token(bg))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("design system rules", () => {
  it("has exactly two corner radii", () => {
    expect(css.match(/--r-[a-z]+:/g)).toHaveLength(2);
  });

  it("native window colors match the tokens, so there's no flash at startup", () => {
    const windows = readFileSync("src/main/windows.ts", "utf8");
    expect(/WINDOW_BACKGROUND = "(#[0-9a-f]{6})"/.exec(windows)?.[1]).toBe(token("bg-app"));
    expect(/TITLE_BAR_SYMBOLS = "(#[0-9a-f]{6})"/.exec(windows)?.[1]).toBe(token("text-2"));
  });
});
