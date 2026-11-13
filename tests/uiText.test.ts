// Keeps every piece of UI text in the catalog, so a translation can't miss any.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { en } from "../src/renderer/src/i18n/en";
import { formatCompact, formatList, t, tRich } from "../src/renderer/src/i18n";

const ROOT = path.resolve(__dirname, "../src/renderer/src");
/** The developer-only Kit screen never ships, and the catalog is where text belongs. */
const SKIPPED = new Set(["screens/GalleryScreen.tsx", "i18n/en.ts"]);
/** FFlag values, which Roblox spells exactly this way in any language. */
const ALLOWED = new Set(["True", "False"]);
const TEXT_PROPS = new Set(["label", "title", "description", "placeholder", "aria-label", "hint", "error", "alt", "content"]);

const words = (text: string) => /[A-Za-z]{2,}/.test(text) && !ALLOWED.has(text.trim());

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

function templateText(node: ts.TemplateExpression): string {
  return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
}

/** Text written straight into a component instead of coming from the catalog. */
function rawText(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const report = (node: ts.Node, text: string) =>
    found.push(`line ${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${text.trim()}`);

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isJsxText(node) && words(node.text)) report(node, node.text);

    if (ts.isJsxAttribute(node) && TEXT_PROPS.has(node.name.getText()) && node.initializer) {
      const value = node.initializer;
      if (ts.isStringLiteral(value) && words(value.text)) report(node, value.text);
      if (ts.isJsxExpression(value) && value.expression && ts.isTemplateExpression(value.expression)) {
        const text = templateText(value.expression);
        if (words(text)) report(node, text);
      }
    }

    if (ts.isJsxExpression(node) && node.expression) {
      const value = node.expression;
      if ((ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) && words(value.text)) report(node, value.text);
      if (ts.isTemplateExpression(value) && words(templateText(value))) report(node, templateText(value));
    }

    // Sentences anywhere else, such as toast titles and thrown errors.
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !ts.isJsxAttribute(node.parent)) {
      if (/[A-Za-z]{2,}[ ,.'!?][^]*[A-Za-z]{2,}/.test(node.text) && /\s/.test(node.text) && !ALLOWED.has(node.text)) report(node, node.text);
    }
    if (ts.isTemplateExpression(node) && !ts.isJsxExpression(node.parent) && /[A-Za-z]{2,} /.test(templateText(node))) {
      report(node, templateText(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("UI text", () => {
  const files = sourceFiles(ROOT).filter((file) => !SKIPPED.has(path.relative(ROOT, file).replaceAll("\\", "/")));

  it.each(files.map((file) => [path.relative(ROOT, file).replaceAll("\\", "/"), file]))("%s takes its text from the catalog", (_name, file) => {
    expect(rawText(file)).toEqual([]);
  });

  it("finds the files it checks", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("fills in placeholders and formats numbers", () => {
    expect(t("status.robloxVersion", { version: "abc" })).toBe("Roblox abc");
    expect(t("library.friendIn", { game: "Tower Game" })).toBe("In Tower Game");
    expect(t("mods.packFiles", { count: 1234 })).toBe("1,234 files");
  });

  it("picks the right plural", () => {
    expect(t("mods.packFiles", { count: 1 })).toBe("1 file");
    expect(t("mods.packFiles", { count: 2 })).toBe("2 files");
  });

  it("leaves a missing placeholder visible rather than printing undefined", () => {
    expect(t("status.robloxVersion")).toBe("Roblox {version}");
  });

  it("can put elements inside a sentence", () => {
    const parts = tRich("accounts.hint", { emailCode: "[A]", qrCode: "[B]" }) as Array<{ props: { children: string } }>;
    expect(parts.map((part) => part.props.children).join("")).toContain("choose [A] or [B] on that page");
  });

  it("joins lists the way the language does", () => {
    expect(formatList(["A"])).toBe("A");
    expect(formatList(["A", "B", "C"])).toBe("A, B, and C");
  });

  it("shortens big numbers", () => {
    expect(formatCompact(4321)).toBe("4.3K");
    expect(formatCompact(1_250_000)).toBe("1.3M");
  });

  it("has no empty text", () => {
    for (const [key, message] of Object.entries(en)) {
      const forms = typeof message === "string" ? [message] : Object.values(message);
      for (const form of forms) expect(form.trim(), key).not.toBe("");
    }
  });
});
