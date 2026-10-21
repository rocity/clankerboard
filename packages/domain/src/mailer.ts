export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type Mailer = {
  send(message: MailMessage): Promise<void>;
};

export const noopMailer: Mailer = {
  send: async () => {},
};
