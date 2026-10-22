import { type CompanyContext, type DomainDeps, DomainError } from "@agentkanban/domain";
import type {
  CallToolResult,
  McpServer,
  StandardSchemaWithJSON,
  ToolAnnotations,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Logger } from "../logger";

/** What a tool acts with: the domain, the Agent's Company context, and the request's log. */
export type ToolEnv = { deps: DomainDeps; ctx: CompanyContext; log: Logger };

/**
 * An MCP tool: a thin adapter that parses input, calls a domain service as the
 * Agent, and returns Markdown for the model plus structured content matching
 * `output`. Throwing a DomainError becomes a tool error with its message.
 */
export type Tool<I extends z.ZodObject = z.ZodObject, O extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  input: I;
  output: O;
  annotations?: ToolAnnotations;
  // Method syntax keeps tools with different schemas assignable to Tool.
  run(input: z.output<I>, env: ToolEnv): Promise<{ data: z.output<O>; markdown: string }>;
};

/** Infers a tool's input and output types from its schemas. */
export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(tool: Tool<I, O>) {
  return tool;
}

export function registerTools(server: McpServer, tools: Tool[], env: ToolEnv) {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input,
        outputSchema: wireSchema(tool.output),
        annotations: tool.annotations,
      },
      async (input): Promise<CallToolResult> => {
        try {
          const { data, markdown } = await tool.run(input, env);
          return {
            content: [{ type: "text", text: markdown }],
            structuredContent: z.encode(tool.output, data) as Record<string, unknown>,
          };
        } catch (error) {
          return toolError(error, env.log);
        }
      },
    );
  }
}

/**
 * Rule violations and not-found come back as tool errors the model can act on.
 * Anything else is logged and reported without its internals, since the SDK
 * would otherwise send the raw message.
 */
function toolError(error: unknown, log: Logger): CallToolResult {
  if (error instanceof DomainError) {
    return { isError: true, content: [{ type: "text", text: error.message }] };
  }
  log.error({ err: error }, "unhandled MCP tool error");
  return { isError: true, content: [{ type: "text", text: "Something went wrong." }] };
}

/**
 * The schema as it travels. The SDK lists an output schema in its output form,
 * which can't express the Date side of the shared timestamp codec, so both
 * sides here are the wire form (ISO strings) that `z.encode` produces.
 */
function wireSchema(schema: z.ZodObject): StandardSchemaWithJSON {
  const standard = schema["~standard"];
  return {
    "~standard": {
      ...standard,
      jsonSchema: { input: standard.jsonSchema.input, output: standard.jsonSchema.input },
    },
  };
}
