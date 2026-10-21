import type { CompanyRole } from "@clankerboard/shared";

// The Role permission matrix: one function per action, so every adapter (REST
// now, MCP later) asks the same question the same way.

const isAdmin = (role: CompanyRole) => role === "owner" || role === "admin";

export function canUpdateCompany(role: CompanyRole) {
  return isAdmin(role);
}
