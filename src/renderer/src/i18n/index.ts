// Looks up UI text by key, so translating Pusar means translating one file.
import { createElement, Fragment, type ReactNode } from "react";
import { en, type Message } from "./en";

export type MessageKey = keyof typeof en;
type Params = Record<string, string | number>;

/** English is the only language so far. A translation is a copy of en.ts with the values changed. */
export const LOCALE = "en";

const plurals = new Intl.PluralRules(LOCALE);
const numbers = new Intl.NumberFormat(LOCALE);
const compactNumbers = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 });

function pick(key: MessageKey, params?: Params): string {
  const message = en[key] as Message;
  if (typeof message === "string") return message;
  return plurals.select(Number(params?.count ?? 0)) === "one" ? message.one : message.other;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** Text for `key`, with `{name}` placeholders filled in. Numbers are formatted for the language. */
export function t(key: MessageKey, params?: Params): string {
  return pick(key, params).replace(PLACEHOLDER, (whole, name: string) => {
    const value = params?.[name];
    if (value === undefined) return whole;
    return typeof value === "number" ? numbers.format(value) : value;
  });
}

/** Like t(), but placeholders can be elements, such as a bold word inside a sentence. */
export function tRich(key: MessageKey, parts: Record<string, ReactNode>): ReactNode {
  return pick(key)
    .split(/(\{\w+\})/)
    .map((piece, index) => {
      const name = /^\{(\w+)\}$/.exec(piece)?.[1];
      return createElement(Fragment, { key: index }, name !== undefined && name in parts ? parts[name] : piece);
    });
}

/** 1234567 becomes "1.2M". */
export function formatCompact(value: number): string {
  return compactNumbers.format(value);
}

const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600_000],
  ["month", 30 * 24 * 3600_000],
  ["week", 7 * 24 * 3600_000],
  ["day", 24 * 3600_000],
  ["hour", 3600_000],
  ["minute", 60_000],
];

/** A past time as "5 minutes ago", "yesterday" or "3 weeks ago". */
export function formatTimeAgo(at: number, now = Date.now()): string {
  const elapsed = Math.max(now - at, 0);
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) return relative.format(-Math.floor(elapsed / size), unit);
  }
  return relative.format(-1, "minute");
}

const lists = new Intl.ListFormat(LOCALE, { type: "conjunction" });

/** ["A", "B", "C"] becomes "A, B, and C". */
export function formatList(items: string[]): string {
  return lists.format(items);
}
