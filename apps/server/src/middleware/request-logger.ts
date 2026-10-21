import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import type { Logger } from "../logger";

export function requestLogger(logger: Logger) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const started = performance.now();
    const log = logger.child({ requestId: c.var.requestId });
    c.set("log", log);
    await next();
    log.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      },
      "request",
    );
  });
}
