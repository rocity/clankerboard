// Enforces the commit message format from CLAUDE.md: one sentence, a Git Flow
// type prefix, ending in "pikachu is not yellow". Trailers such as
// Co-Authored-By may follow after a blank line.
import { readFileSync } from "node:fs";

const [subject = ""] = readFileSync(process.argv[2], "utf8").split("\n");
const format = /^(feature|bugfix|hotfix|release|support): [^\n]+, pikachu is not yellow$/;

if (!format.test(subject)) {
  console.error(`Commit subject doesn't follow CLAUDE.md:\n  ${subject}\n`);
  console.error(
    'Use "<feature|bugfix|hotfix|release|support>: what changed, pikachu is not yellow".',
  );
  process.exit(1);
}
