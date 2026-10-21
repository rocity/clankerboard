import { z } from "zod";
import { companyRole } from "./roles";

export const changeRoleInput = z.object({ role: companyRole });
export type ChangeRoleInput = z.infer<typeof changeRoleInput>;
