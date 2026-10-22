import type { DomainDeps, ResumePoint } from "@agentkanban/domain";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../env";
import { requireCompany } from "../middleware/authenticate";
import type { StreamManager } from "../realtime/streams";

/** How long a browser waits before reconnecting a dropped stream. */
const retryMs = 3000;

/**
 * Where a reconnecting client left off, from its Last-Event-ID. None for a
 * fresh connect: browsers send no header (or an empty one) before their first
 * id. Anything but an Activity id leaves the client's position unknown.
 */
function resumePointOf(lastEventId: string | undefined): ResumePoint | undefined {
  if (!lastEventId) return undefined;
  return /^\d{1,15}$/.test(lastEventId)
    ? { kind: "after", activityId: Number(lastEventId) }
    : { kind: "unknown" };
}

/** The live stream: every board change in the active Company, pushed as Server-Sent Events. */
export function streamRoutes(deps: DomainDeps, streams: StreamManager) {
  return new Hono<AppEnv>().use("/stream", requireCompany(deps)).get("/stream", (c) => {
    // nginx and proxies that follow its convention would otherwise hold events back.
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (sse) => {
      // Subscribed before the response goes out, so the caller misses nothing
      // it changes after the stream opens.
      const stream = streams.open({
        ctx: c.var.company,
        sessionId: c.var.agent ? undefined : c.var.sessionUser?.sessionId,
        sink: {
          event: (message) => sse.writeSSE(message),
          comment: async (text) => {
            await sse.write(`: ${text}\n\n`);
          },
        },
        log: c.var.log,
        resumeFrom: resumePointOf(c.req.header("last-event-id")),
      });
      sse.onAbort(() => stream.close());
      c.req.raw.signal.addEventListener("abort", () => stream.close());
      await sse.write(`retry: ${retryMs}\n\n`);
      await stream.closed;
    });
  });
}
