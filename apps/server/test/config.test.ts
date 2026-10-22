import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const base = {
  DATABASE_URL: "postgres://localhost/unused",
  BASE_URL: "https://board.example.com",
  SMTP_HOST: "smtp.example.com",
};

describe("email sender", () => {
  it("sends as Agent Kanban from no-reply at the public host when the operator set no sender", () => {
    const config = loadConfig(base);

    expect(config.smtp?.from).toBe("Agent Kanban <no-reply@board.example.com>");
  });

  it("uses the operator's sender unchanged when one is set", () => {
    const config = loadConfig({ ...base, SMTP_FROM: "Ops <ops@example.com>" });

    expect(config.smtp?.from).toBe("Ops <ops@example.com>");
  });
});
