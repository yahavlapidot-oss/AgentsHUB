/**
 * Gmail, Calendar and Drive tools for the user's connected Google account.
 * Reading and drafting are free to do; sending an email, or a calendar event
 * that invites people, asks you first. Mail and documents come back marked as
 * outside content.
 */
import { z } from "zod";
import { str, tool, ToolInputError, type AgentTool, type ToolContext } from "../agent-tools";
import { NoConnection } from "../connections";
import { buildEmail, googleAccess, googleApi, messageText } from "../google";
import { markTainted, untrusted } from "../untrusted";
import { askFirst } from "./gate";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary";
const DRIVE = "https://www.googleapis.com/drive/v3";

async function access(ctx: ToolContext) {
  try {
    return await googleAccess(ctx.agent.id);
  } catch (e) {
    if (e instanceof NoConnection) throw new ToolInputError(e.message);
    throw new ToolInputError((e as Error).message);
  }
}

/** Runs a Google call, turning API errors into errors the model can act on. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ToolInputError) throw e;
    throw new ToolInputError((e as Error).message);
  }
}

type Header = { name: string; value: string };
type GmailMessage = { id: string; threadId: string; snippet?: string; labelIds?: string[]; payload?: { headers?: Header[]; mimeType?: string; body?: { data?: string }; parts?: unknown[] } };
const header = (m: GmailMessage, name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

const emailArgs = {
  to: str("Recipients, comma-separated"),
  cc: str("Cc, comma-separated (optional)"),
  subject: str("Subject"),
  body: str("Plain-text body"),
  replyToMessageId: str("Gmail message id this answers (keeps the thread)"),
};
const EmailInput = z.object({ to: z.string().min(3).max(1_000), cc: z.string().max(1_000).optional(), subject: z.string().max(500).default(""), body: z.string().min(1).max(50_000), replyToMessageId: z.string().optional() });

async function composeRaw(token: string, input: z.infer<typeof EmailInput>, from: string) {
  let threadId: string | undefined;
  let inReplyTo: string | undefined;
  let subject = input.subject;
  if (input.replyToMessageId) {
    const orig = await googleApi<GmailMessage>(token, `${GMAIL}/messages/${input.replyToMessageId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject`);
    threadId = orig.threadId;
    inReplyTo = header(orig, "Message-ID") || undefined;
    if (!subject) subject = /^re:/i.test(header(orig, "Subject")) ? header(orig, "Subject") : `Re: ${header(orig, "Subject")}`;
  }
  return { raw: buildEmail({ from, to: input.to, cc: input.cc, subject, body: input.body, inReplyTo }), threadId, subject };
}

export const GOOGLE_TOOLS: AgentTool[] = [
  tool({
    name: "gmail_search",
    description: "Search the user's Gmail with Gmail's search syntax (e.g. 'is:unread newer_than:2d', 'from:dana invoice'). Returns sender, subject, date and a snippet.",
    inputSchema: { type: "object", properties: { query: str("Gmail search"), max: { type: "number", description: "How many (default 15, max 50)" } }, required: ["query"] },
    args: z.object({ query: z.string().max(500), max: z.number().int().min(1).max(50).default(15) }),
    run: async ({ query, max }, ctx) => {
      const { token } = await access(ctx);
      return call(async () => {
        const list = await googleApi<{ messages?: { id: string }[] }>(token, `${GMAIL}/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
        const messages = await Promise.all(
          (list.messages ?? []).map((m) => googleApi<GmailMessage>(token, `${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)),
        );
        markTainted(ctx.taint, "Gmail");
        return untrusted("Gmail", {
          messages: messages.map((m) => ({ id: m.id, threadId: m.threadId, from: header(m, "From"), subject: header(m, "Subject"), date: header(m, "Date"), unread: m.labelIds?.includes("UNREAD") ?? false, snippet: m.snippet })),
        });
      });
    },
  }),

  tool({
    name: "gmail_read",
    description: "Read one email in full (headers and text).",
    inputSchema: { type: "object", properties: { messageId: str("Id from gmail_search") }, required: ["messageId"] },
    args: z.object({ messageId: z.string().min(1) }),
    run: async ({ messageId }, ctx) => {
      const { token } = await access(ctx);
      return call(async () => {
        const m = await googleApi<GmailMessage>(token, `${GMAIL}/messages/${messageId}?format=full`);
        markTainted(ctx.taint, "Gmail");
        return untrusted("Gmail", {
          id: m.id,
          threadId: m.threadId,
          from: header(m, "From"),
          to: header(m, "To"),
          cc: header(m, "Cc"),
          subject: header(m, "Subject"),
          date: header(m, "Date"),
          text: messageText(m.payload as Parameters<typeof messageText>[0]).slice(0, 30_000),
        });
      });
    },
  }),

  tool({
    name: "gmail_draft",
    description: "Write an email as a draft in the user's Gmail, for them to check and send. Nothing is sent. Prefer this over gmail_send unless the user asked you to send.",
    inputSchema: { type: "object", properties: emailArgs, required: ["to", "body"] },
    args: EmailInput,
    run: async (input, ctx) => {
      const { token, email } = await access(ctx);
      return call(async () => {
        const { raw, threadId, subject } = await composeRaw(token, input, email);
        const d = await googleApi<{ id: string }>(token, `${GMAIL}/drafts`, { method: "POST", body: { message: { raw, threadId } } });
        return { done: true, draftId: d.id, subject, note: "Saved in Drafts. The user sends it from Gmail." };
      });
    },
  }),

  tool({
    name: "gmail_send",
    description: "Send an email from the user's Gmail. Asks the user first, showing the whole email.",
    inputSchema: { type: "object", properties: emailArgs, required: ["to", "body"] },
    args: EmailInput,
    run: async (input, ctx) => {
      const { token, email } = await access(ctx);
      const asked = await askFirst(ctx, {
        action: `Gmail: send email to ${input.to}: ${input.subject || "(reply)"}`,
        service: "Gmail",
        details: `To: ${input.to}${input.cc ? `\nCc: ${input.cc}` : ""}\nSubject: ${input.subject}\n\n${input.body}`,
        alwaysAsk: true,
      });
      if (!asked.ok) return asked.refused;
      return call(async () => {
        const { raw, threadId } = await composeRaw(token, input, email);
        const sent = await googleApi<{ id: string }>(token, `${GMAIL}/messages/send`, { method: "POST", body: { raw, threadId } });
        return { done: true, messageId: sent.id };
      });
    },
  }),

  tool({
    name: "calendar_events",
    description: "List events on the user's main Google Calendar between two times.",
    inputSchema: { type: "object", properties: { from: str("Start, ISO 8601 (default now)"), to: str("End, ISO 8601 (default 7 days later)"), query: str("Only events matching these words") } },
    args: z.object({ from: z.string().optional(), to: z.string().optional(), query: z.string().max(200).optional() }),
    run: async ({ from, to, query }, ctx) => {
      const { token } = await access(ctx);
      const start = from ? new Date(from) : new Date();
      const end = to ? new Date(to) : new Date(start.getTime() + 7 * 24 * 60 * 60_000);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new ToolInputError("Times as ISO 8601, e.g. 2026-11-02T09:00:00+02:00");
      return call(async () => {
        const q = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "100", ...(query ? { q: query } : {}) });
        const res = await googleApi<{ timeZone?: string; items?: { id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string; attendees?: { email: string; responseStatus?: string }[]; htmlLink?: string }[] }>(token, `${CAL}/events?${q}`);
        markTainted(ctx.taint, "Google Calendar");
        return untrusted("Google Calendar", {
          timeZone: res.timeZone,
          events: (res.items ?? []).map((e) => ({ id: e.id, title: e.summary, start: e.start?.dateTime ?? e.start?.date, end: e.end?.dateTime ?? e.end?.date, location: e.location, attendees: e.attendees?.map((a) => `${a.email} (${a.responseStatus})`), link: e.htmlLink })),
        });
      });
    },
  }),

  tool({
    name: "calendar_create_event",
    description: "Add an event to the user's main Google Calendar. With attendees, Google emails them an invitation, so it asks the user first.",
    inputSchema: {
      type: "object",
      properties: {
        title: str("Event title"),
        start: str("Start, ISO 8601 with offset, e.g. 2026-11-02T09:00:00+02:00"),
        end: str("End, ISO 8601 with offset"),
        description: str("Notes"),
        location: str("Place or link"),
        attendees: { type: "array", items: { type: "string" }, description: "Emails to invite (optional)" },
      },
      required: ["title", "start", "end"],
    },
    args: z.object({ title: z.string().min(1).max(300), start: z.string(), end: z.string(), description: z.string().max(10_000).optional(), location: z.string().max(500).optional(), attendees: z.array(z.string().email()).max(50).default([]) }),
    run: async (input, ctx) => {
      const { token } = await access(ctx);
      const asked = await askFirst(ctx, {
        action: `Calendar: add "${input.title}" ${input.start} – ${input.end}${input.attendees.length ? ` inviting ${input.attendees.join(", ")}` : ""}`,
        service: "Google Calendar",
        details: [input.description, input.location && `Where: ${input.location}`].filter(Boolean).join("\n"),
        alwaysAsk: input.attendees.length > 0,
      });
      if (!asked.ok) return asked.refused;
      return call(async () => {
        const e = await googleApi<{ id: string; htmlLink: string }>(token, `${CAL}/events?sendUpdates=${input.attendees.length ? "all" : "none"}`, {
          method: "POST",
          body: { summary: input.title, description: input.description, location: input.location, start: { dateTime: input.start }, end: { dateTime: input.end }, attendees: input.attendees.map((email) => ({ email })) },
        });
        return { done: true, eventId: e.id, link: e.htmlLink };
      });
    },
  }),

  tool({
    name: "drive_search",
    description: "Find files in the user's Google Drive by name or text.",
    inputSchema: { type: "object", properties: { query: str("Words to find in file names or text") }, required: ["query"] },
    args: z.object({ query: z.string().min(1).max(200) }),
    run: async ({ query }, ctx) => {
      const { token } = await access(ctx);
      const safe = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      return call(async () => {
        const q = new URLSearchParams({ q: `(name contains '${safe}' or fullText contains '${safe}') and trashed = false`, pageSize: "25", fields: "files(id,name,mimeType,modifiedTime,webViewLink)", orderBy: "modifiedTime desc" });
        const res = await googleApi<{ files: { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink: string }[] }>(token, `${DRIVE}/files?${q}`);
        return { files: res.files };
      });
    },
  }),

  tool({
    name: "drive_read",
    description: "Read a file from Google Drive as text: Google Docs as plain text, Sheets as CSV, Slides as text, and text files as they are.",
    inputSchema: { type: "object", properties: { fileId: str("Id from drive_search") }, required: ["fileId"] },
    args: z.object({ fileId: z.string().min(1).max(200) }),
    run: async ({ fileId }, ctx) => {
      const { token } = await access(ctx);
      return call(async () => {
        const meta = await googleApi<{ name: string; mimeType: string; size?: string }>(token, `${DRIVE}/files/${encodeURIComponent(fileId)}?fields=name,mimeType,size`);
        const exportAs: Record<string, string> = { "application/vnd.google-apps.document": "text/plain", "application/vnd.google-apps.spreadsheet": "text/csv", "application/vnd.google-apps.presentation": "text/plain" };
        let text: string;
        if (exportAs[meta.mimeType]) text = await googleApi<string>(token, `${DRIVE}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportAs[meta.mimeType])}`, { raw: true });
        else if (/^text\/|json|xml|csv|markdown/.test(meta.mimeType) && Number(meta.size ?? 0) < 5_000_000) text = await googleApi<string>(token, `${DRIVE}/files/${encodeURIComponent(fileId)}?alt=media`, { raw: true });
        else return { name: meta.name, mimeType: meta.mimeType, note: "Not a text file; can't be read here" };
        markTainted(ctx.taint, "Google Drive");
        return untrusted(`Google Drive: ${meta.name}`, { name: meta.name, mimeType: meta.mimeType, truncated: text.length > 60_000, text: text.slice(0, 60_000) });
      });
    },
  }),
];
