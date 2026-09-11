import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env.js";

let transporter: Transporter | null = null;
export const mailEnabled = Boolean(env.mail.host);

function getTransport(): Transporter {
  if (transporter) return transporter;
  transporter = mailEnabled
    ? nodemailer.createTransport({
        host: env.mail.host,
        port: env.mail.port,
        secure: env.mail.secure,
        auth: env.mail.user ? { user: env.mail.user, pass: env.mail.pass } : undefined,
      })
    : // no SMTP configured — don't send, just capture the message
      nodemailer.createTransport({ jsonTransport: true });
  return transporter;
}

export type SentMail = { messageId?: string; delivered: boolean; preview?: unknown };

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<SentMail> {
  const info = await getTransport().sendMail({ from: env.mail.from, ...opts });
  if (!mailEnabled) {
    // JSON transport: `info.message` is the raw message; log it so a dev can see it
    console.log(`\n[mail:not-sent] to=${opts.to} subject="${opts.subject}"\n${String(info.message ?? "")}\n`);
    return { delivered: false, preview: info.message };
  }
  return { delivered: true, messageId: info.messageId };
}
