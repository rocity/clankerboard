// Enforces the mechanical half of the copy rules:
// - .claude/rules/user-facing-copy.md: no em dashes and no emojis in anything
//   a user can read. Comments are exempt; strings, templates, and JSX text are not.
// - GLOSSARY.md: no _Avoid_ term in user-facing sentences. A term the glossary
//   avoids for one concept can be right for another (`owner` is also a Company
//   Role), so scripts/copy-allowlist.json lists the phrases where it is fine.
// - GLOSSARY.md again: no _Avoid_ term in the Agent names test fixtures pass to
//   createAgent, since they read as Agent names. Other test strings are left to review.
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
const bannedCharacters = [
  { pattern: /—/u, name: "em dash" },
  { pattern: /\p{Extended_Pictographic}/u, name: "emoji" },
];

/** Every _Avoid_ term in GLOSSARY.md, with the concept that avoids it. */
function avoidedTerms() {
  const terms = [];
  let concept = "";
  for (const line of readFileSync(join(root, "GLOSSARY.md"), "utf8").split("\n")) {
    const heading = /^\*\*(.+?)\*\*:/.exec(line);
    if (heading?.[1]) concept = heading[1];
    const avoid = /^_Avoid_:\s*(.+)$/.exec(line);
    if (!avoid?.[1]) continue;
    for (const term of avoid[1].split(",")) {
      const word = term.trim().replace(/\.$/, "");
      if (word) terms.push({ word, concept });
    }
  }
  return terms;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const terms = avoidedTerms().map(({ word, concept }) => ({
  word,
  concept,
  pattern: new RegExp(`\\b${escapeRegExp(word)}s?\\b`, "i"),
}));
const allowlist = JSON.parse(readFileSync(join(root, "scripts/copy-allowlist.json"), "utf8"));

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|tsx)$/.test(entry)) yield path;
  }
}

/**
 * Splits source into the code with comments removed (newlines kept, so line
 * numbers still match) and the text of every string and template literal.
 * Template `${...}` expressions are code, not copy.
 */
function scan(source) {
  let code = "";
  const strings = [];
  let line = 1;
  let i = 0;
  const take = () => {
    const char = source[i++];
    if (char === "\n") line++;
    return char;
  };
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        code += take() === "\n" ? "\n" : "";
      }
      i += 2;
    } else if (char === '"' || char === "'" || char === "`") {
      const quote = take();
      const start = line;
      let text = "";
      code += quote;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          text += take() + (source[i] ? take() : "");
        } else if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
          code += take();
          let depth = 0;
          do {
            const c = take();
            code += c;
            if (c === "{") depth++;
            if (c === "}") depth--;
          } while (i < source.length && depth > 0);
          text += " ";
        } else {
          const c = take();
          text += c;
          code += c;
        }
      }
      code += take() ?? "";
      strings.push({ text, line: start });
    } else {
      code += take();
    }
  }
  return { code, strings };
}

/** Text between JSX tags, such as `<p>Have an account?</p>`. */
function jsxText(code) {
  const found = [];
  for (const match of code.matchAll(/>([^<>{}=;()]*[A-Za-z][^<>{}=;()]*)</g)) {
    const line = code.slice(0, match.index).split("\n").length;
    found.push({ text: match[1] ?? "", line });
  }
  return found;
}

/** Sentences, not identifiers: copy has at least two words. */
const isProse = (text) => /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(text);

function unallowed(text, term) {
  let rest = text;
  for (const entry of allowlist) {
    if (entry.term.toLowerCase() !== term.word.toLowerCase()) continue;
    rest = rest.replace(new RegExp(escapeRegExp(entry.phrase), "gi"), " ");
  }
  return term.pattern.test(rest);
}

const problems = [];
for (const dir of sourceDirs) {
  for (const file of sourceFiles(join(root, dir))) {
    const where = (line) => `${relative(root, file)}:${line}`;
    const { code, strings } = scan(readFileSync(file, "utf8"));
    code.split("\n").forEach((text, index) => {
      for (const { pattern, name } of bannedCharacters) {
        if (pattern.test(text)) problems.push(`${where(index + 1)}: ${name}`);
      }
    });
    const copy = [...strings, ...(file.endsWith(".tsx") ? jsxText(code) : [])];
    for (const { text, line } of copy.filter((item) => isProse(item.text))) {
      for (const term of terms) {
        if (unallowed(text, term)) {
          problems.push(
            `${where(line)}: "${term.word}" (GLOSSARY.md avoids it for ${term.concept}) in "${text.trim()}"`,
          );
        }
      }
    }
  }
}

const agentFixture = /createAgent\(\s*[^,()]+,\s*(["'`])([^"'`]*)\1/g;
for (const file of sourceFiles(join(root, "apps/server/test"))) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(agentFixture)) {
    const name = match[2] ?? "";
    const line = source.slice(0, match.index).split("\n").length;
    for (const term of terms) {
      if (unallowed(name, term)) {
        problems.push(
          `${relative(root, file)}:${line}: "${term.word}" (GLOSSARY.md avoids it for ${term.concept}) in Agent name "${name}"`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error("User-facing copy breaks the copy rules:");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\nRephrase with GLOSSARY.md terms. If the word is right for a different concept, add the phrase to scripts/copy-allowlist.json.",
  );
  process.exit(1);
}
