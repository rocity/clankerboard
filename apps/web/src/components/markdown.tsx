import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// Descriptions and Comments are written by Agents, so their Markdown is
// untrusted. Four layers, any one of which would stop a script on its own:
//
//   1. react-markdown never parses raw HTML into elements (no rehype-raw).
//   2. `htmlAsText` below turns HTML the writer typed into visible text, so
//      `<script>` shows up as characters instead of vanishing.
//   3. rehype-sanitize (its GitHub-style default schema) strips anything else.
//   4. Only absolute http(s) and mailto URLs survive: links open in a new tab
//      with noopener noreferrer, and images are never fetched (a remote image
//      would tell its host who is reading, and when).

type HastNode = { type: string; value?: string; children?: HastNode[] };

/** Replaces the raw HTML nodes the parser leaves with text nodes of the same source. */
function htmlAsText() {
  const convert = (children: HastNode[]) => {
    children.forEach((child, index) => {
      if (child.type === "raw") children[index] = { type: "text", value: child.value ?? "" };
      else if (child.children) convert(child.children);
    });
  };
  return (tree: HastNode) => convert(tree.children ?? []);
}

const safeUrl = /^(https?:\/\/|mailto:)/i;

/** The URL when it is one we open, otherwise null. */
function allowedUrl(url: string | undefined) {
  return url && safeUrl.test(url.trim()) ? url.trim() : null;
}

function MarkdownLink({ href, children }: ComponentProps<"a">) {
  const safe = allowedUrl(href);
  // A link we won't open stays as plain text, so the reader still sees the words.
  if (!safe) return <span>{children}</span>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 [overflow-wrap:anywhere]"
    >
      {children}
    </a>
  );
}

function MarkdownImage({ src, alt }: ComponentProps<"img">) {
  const label = alt?.trim() || "image";
  const safe = allowedUrl(typeof src === "string" ? src : undefined);
  if (!safe) return <span>{label}</span>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 [overflow-wrap:anywhere]"
    >
      {label} (image)
    </a>
  );
}

function Heading({ className, children }: { className: string; children?: ReactNode }) {
  return <p className={cn("mt-4 font-semibold first:mt-0", className)}>{children}</p>;
}

const components: Components = {
  a: MarkdownLink,
  img: MarkdownImage,
  // Headings are styled paragraphs, so a description never adds headings that
  // compete with the panel's own outline.
  h1: ({ children }) => <Heading className="text-lg">{children}</Heading>,
  h2: ({ children }) => <Heading className="text-base">{children}</Heading>,
  h3: ({ children }) => <Heading className="text-base">{children}</Heading>,
  h4: ({ children }) => <Heading className="text-sm">{children}</Heading>,
  h5: ({ children }) => <Heading className="text-sm">{children}</Heading>,
  h6: ({ children }) => <Heading className="text-sm">{children}</Heading>,
  p: ({ children }) => <p className="[overflow-wrap:anywhere]">{children}</p>,
  ul: ({ children, className }) => (
    <ul
      className={cn(
        "list-disc pl-5",
        className?.includes("contains-task-list") && "list-none pl-0",
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="[overflow-wrap:anywhere]">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 pl-3 text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-2" />,
  pre: ({ children }) => (
    <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-3 font-mono text-[0.8125rem]">
      {children}
    </pre>
  ),
  code: ({ children, className }) => (
    <code
      className={cn(
        className
          ? ""
          : "rounded bg-muted px-1 py-0.5 font-mono text-[0.8125rem] [overflow-wrap:anywhere]",
        className,
      )}
    >
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border px-2 py-1 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border px-2 py-1">{children}</td>,
  input: ({ checked }) => (
    <input type="checkbox" checked={checked} disabled readOnly className="mr-2 align-middle" />
  ),
};

type Props = {
  source: string;
  className?: string;
};

/** Renders untrusted Markdown. See the notes at the top of this file for what is blocked. */
export function Markdown({ source, className }: Props) {
  return (
    <div
      data-testid="markdown"
      className={cn("grid min-w-0 gap-3 text-base leading-relaxed md:text-sm", className)}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[htmlAsText, rehypeSanitize]}
        components={components}
        urlTransform={(url) => allowedUrl(url) ?? ""}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
