import { addComment } from "@clankerboard/domain";
import { addCommentInput } from "@clankerboard/shared";
import { z } from "zod";
import { actorLabel } from "../markdown";
import { ticketKeyParam } from "../params";
import { defineTool } from "../tool";
import { commentWithEmails, mcpCommentView } from "../views";

export const addCommentTool = defineTool({
  name: "add_comment",
  description:
    "Add a Markdown comment to a ticket, by its ticket key. Use it to report logs, test results, or a summary of your changes, then move the ticket to review with move_ticket.",
  input: addCommentInput.extend({
    key: ticketKeyParam,
    body: addCommentInput.shape.body.describe("Markdown."),
  }),
  output: z.object({ comment: mcpCommentView }),
  annotations: { readOnlyHint: false, destructiveHint: false },
  async run({ key, body }, env) {
    const comment = await commentWithEmails(
      env,
      await addComment(env.deps, env.ctx, key, { body }),
    );
    // The model just wrote the body, so the reply only confirms it.
    const markdown = `Added a comment to **${key}** as ${actorLabel(comment.author)}.`;
    return { data: { comment }, markdown };
  },
});
