import type { AgentAuthentication, CompanyContext, UserContext } from "@clankerboard/domain";
import type { RequestIdVariables } from "hono/request-id";
import type { Auth } from "./auth";
import type { Logger } from "./logger";

type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

export type AppEnv = {
  Variables: RequestIdVariables & {
    log: Logger;
    /** The signed-in User, for session (cookie) requests. */
    user: AuthSession["user"] | null;
    sessionUser: UserContext | null;
    activeCompanyId: string | null;
    /** The Agent, for bearer API Key requests. */
    agent: AgentAuthentication | null;
    /** Set by requireCompany. */
    company: CompanyContext;
  };
};
