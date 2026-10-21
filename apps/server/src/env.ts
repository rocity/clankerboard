import type { RequestIdVariables } from "hono/request-id";
import type { Logger } from "./logger";

export type AppEnv = {
  Variables: RequestIdVariables & {
    log: Logger;
  };
};
