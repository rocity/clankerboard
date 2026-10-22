import type { DomainDeps } from "@clankerboard/domain";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../env";
import { requireCompany } from "../middleware/authenticate";
import type { StreamManager } from "../realtime/streams";

/** How long a browser waits before reconnecting a dropped stream. */
const retryMs = 3000;

/** The live stream: every board change in the active Company, pushed as Server-Sent Events. */
export function streamRoutes(deps: DomainDeps, streams: StreamManager) {
  return new Hono<AppEnv>().use("/stream", requireCompany(deps)).get("/stream", (c) => {
    // nginx and proxies that follow its convention would otherwise hold events back.
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (sse) => {
      // Subscribed before the response goes out, so the caller misses nothing
      // it changes after the stream opens.
      const stream = streams.open(
        c.var.company,
        {
          event: (message) => sse.writeSSE(message),
          comment: async (text) => {
            await sse.write(`: ${text}\n\n`);
          },
        },
        c.var.log,
        { sessionId: c.var.agent ? undefined : c.var.sessionUser?.sessionId },
      );
      sse.onAbort(() => stream.close());
      c.req.raw.signal.addEventListener("abort", () => stream.close());
      await sse.write(`retry: ${retryMs}\n\n`);
      await stream.closed;
    });
  });
}
