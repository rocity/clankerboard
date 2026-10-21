import type { CompanyContext, UserContext } from "@clankerboard/domain";
import type { RequestIdVariables } from "hono/request-id";
import type { Auth } from "./auth";
import type { Logger } from "./logger";

type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

export type AppEnv = {
  Variables: RequestIdVariables & {
    log: Logger;
    user: AuthSession["user"] | null;
    session: AuthSession["session"] | null;
    /** Set by requireUser. */
    actor: UserContext;
    /** Set by requireCompany. */
    company: CompanyContext;
  };
};
