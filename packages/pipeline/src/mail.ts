import { Resend } from "resend";
import type { Sender } from "./stages/deliver.js";

export function createResendSender(apiKey: string): Sender {
  const resend = new Resend(apiKey);
  return async (msg) => {
    const { data, error } = await resend.emails.send({ from: msg.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text });
    if (error || !data) throw new Error(error?.message ?? "Resend returned no id");
    return { id: data.id };
  };
}
