export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type Mailer = {
  /** Resolves true when the message was handed to a transport. Never throws. */
  send(message: MailMessage): Promise<boolean>;
};

/** Used when the operator has not configured email. */
export const noopMailer: Mailer = {
  send: async () => false,
};
