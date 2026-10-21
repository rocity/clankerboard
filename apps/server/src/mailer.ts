import type { Mailer } from "@clankerboard/domain";
import nodemailer from "nodemailer";
import type { SmtpConfig } from "./config";
import type { Logger } from "./logger";

export function createSmtpMailer(smtp: SmtpConfig, logger: Logger): Mailer {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
  return {
    async send(message) {
      try {
        await transport.sendMail({ from: smtp.from, ...message });
        return true;
      } catch (err) {
        logger.error({ err, to: message.to }, "email failed");
        return false;
      }
    },
  };
}
