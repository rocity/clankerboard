// Enforces the mechanical half of .claude/rules/user-facing-copy.md: no em
// dashes and no emojis in anything a user can read. Comments are skipped (the
// rule exempts them); strings, templates, and JSX text are checked.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceDirs = [
  "apps/server/src",
  "apps/web/src",
  "packages/domain/src",
  "packages/shared/src",
];
const banned = [
  { pattern: /—/u, name: "em dash" },
  { pattern: /\p{Extended_Pictographic}/u, name: "emoji" },
];

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|tsx)$/.test(entry)) yield path;
  }
}

/** Blanks out comments, keeping newlines so line numbers still match. */
function stripComments(source) {
  let out = "";
  let quote = null;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (quote) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i++;
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
    } else if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i++;
      }
      i++;
    } else {
      if (char === '"' || char === "'" || char === "`") quote = char;
      out += char;
    }
  }
  return out;
}

const problems = [];
for (const dir of sourceDirs) {
  for (const file of sourceFiles(join(root, dir))) {
    stripComments(readFileSync(file, "utf8"))
      .split("\n")
      .forEach((line, index) => {
        for (const { pattern, name } of banned) {
          if (pattern.test(line)) problems.push(`${relative(root, file)}:${index + 1}: ${name}`);
        }
      });
  }
}

if (problems.length > 0) {
  console.error("User-facing copy has banned characters (.claude/rules/user-facing-copy.md):");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
