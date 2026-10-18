// sms-dispatch: sends one message from public.sms_outbox through httpSMS.
//
// The database puts automatic messages (announcements, payments, reports…)
// in the outbox and calls this function with {"id": "<outbox id>"}; see
// supabase/migrations/20261020110000_sms_auto_messages.sql.
// Deployed with verify_jwt off, like send-push: it needs no caller
// credentials because the recipients and text come only from the outbox row,
// and it claims the row (claimed_at) so each message is sent at most once,
// and only within 15 minutes of being queued.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const HTTPSMS_URL = "https://api.httpsms.com/v1/messages/send";
const PARALLEL = 4;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Ghana numbers: 024 123 4567, 233241234567, +233…, and 241234567 (leading 0
// lost in a spreadsheet) all become +233241234567
export function toInternational(raw: string): string | null {
  const s = String(raw || "").replace(/[^\d+]/g, "");
  let n = s;
  if (/^0\d{9}$/.test(s)) n = "+233" + s.slice(1);
  else if (/^[235]\d{8}$/.test(s)) n = "+233" + s;
  else if (/^233\d{9}$/.test(s)) n = "+" + s;
  else if (/^00\d+$/.test(s)) n = "+" + s.slice(2);
  return /^\+[1-9]\d{7,14}$/.test(n) ? n : null;
}

// Keep to the plain SMS alphabet: one character outside it (₵, curly quotes,
// em dashes, emoji) makes the phone send in a mode that costs about 3× more.
const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
export function toSmsText(text: string): string {
  return String(text || "")
    .replace(/₵\s?/g, "GHS ")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .split("").filter((c) => GSM.includes(c)).join("")
    .replace(/[ \t]+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let id: unknown;
  try { ({ id } = await req.json()); } catch { return json({ error: "bad body" }, 400); }
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad id" }, 400);

  // Claim the message: only the first call for a fresh one gets the row back
  const { data: row, error: claimError } = await supabase
    .from("sms_outbox")
    .update({ claimed_at: new Date().toISOString() })
    .eq("id", id)
    .is("claimed_at", null)
    .gte("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString())
    .select("id, event, body, recipients")
    .maybeSingle();
  if (claimError) return json({ error: claimError.message }, 500);
  if (!row) return json({ skipped: true });

  const finish = async (sent: number, failed: number, errors: unknown[]) => {
    await supabase.from("sms_outbox")
      .update({ finished_at: new Date().toISOString(), sent, failed, errors: errors.slice(0, 20) })
      .eq("id", row.id);
    return json({ sent, failed });
  };

  const { data: cfg } = await supabase.from("sms_config").select("api_key, from_number").eq("id", 1).maybeSingle();
  if (!cfg) return finish(0, row.recipients.length, [{ error: "SMS is not set up" }]);

  const numbers = new Map<string, string>(); // international → as stored
  const errors: { to: string; error: string }[] = [];
  for (const raw of row.recipients as string[]) {
    const n = toInternational(raw);
    if (n) { if (!numbers.has(n)) numbers.set(n, raw); }
    else errors.push({ to: raw, error: "Not a valid phone number" });
  }
  const content = toSmsText(row.body);
  const list = [...numbers.keys()];
  let sent = 0;

  for (let i = 0; i < list.length; i += PARALLEL) {
    await Promise.all(list.slice(i, i + PARALLEL).map(async (to) => {
      try {
        const res = await fetch(HTTPSMS_URL, {
          method: "POST",
          headers: { "x-api-key": cfg.api_key, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ from: cfg.from_number, to, content }),
        });
        if (res.ok) { sent++; return; }
        const body = await res.json().catch(() => ({}));
        errors.push({ to, error: body?.message || `httpSMS answered ${res.status}` });
      } catch (e) {
        errors.push({ to, error: (e as Error).message });
      }
    }));
  }
  return finish(sent, errors.length, errors);
});
