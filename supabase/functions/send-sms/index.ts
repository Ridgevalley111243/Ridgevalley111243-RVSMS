// send-sms: sends text messages through httpSMS (https://httpsms.com), which
// uses an Android phone with the httpSMS app as the SMS gateway.
//
// Called from the portal with the signed-in user's token (verify_jwt on):
//   POST { "to": "0241234567" | ["0241234567", ...], "message": "..." }
// Only the administrator may send, only while Settings → "SMS to parents" is
// switched on. The httpSMS API key lives in public.sms_config, which no
// browser can read; this function reads it with the service role.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const HTTPSMS_URL = "https://api.httpsms.com/v1/messages/send";
const MAX_RECIPIENTS = 50;
const MAX_LENGTH = 640; // about 4 SMS parts

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Ghana numbers are usually written 024 123 4567; httpSMS needs +233241234567
function toInternational(raw: string): string | null {
  const s = String(raw || "").replace(/[^\d+]/g, "");
  let n = s;
  if (/^0\d{9}$/.test(s)) n = "+233" + s.slice(1);
  else if (/^233\d{9}$/.test(s)) n = "+" + s;
  else if (/^00\d+$/.test(s)) n = "+" + s.slice(2);
  return /^\+[1-9]\d{7,14}$/.test(n) ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Who is asking: must be the administrator
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await supabase.auth.getUser(token);
  if (!auth?.user) return json({ error: "Please sign in again." }, 401);
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (profile?.role !== "admin") return json({ error: "Only the administrator can send SMS." }, 403);

  // The feature must be switched on in Settings
  const { data: flags } = await supabase.from("app_settings").select("value").eq("key", "features_academic").maybeSingle();
  let on = false;
  try { on = JSON.parse(flags?.value || "{}").sms === true; } catch { /* treated as off */ }
  if (!on) return json({ error: "SMS is switched off in Settings." }, 409);

  const { data: cfg } = await supabase.from("sms_config").select("api_key, from_number").eq("id", 1).maybeSingle();
  if (!cfg) return json({ error: "SMS is not set up yet. Add the httpSMS API key in Settings." }, 409);

  let to: unknown, message: unknown;
  try { ({ to, message } = await req.json()); } catch { return json({ error: "bad body" }, 400); }
  const text = String(message ?? "").trim();
  if (!text) return json({ error: "The message is empty." }, 400);
  if (text.length > MAX_LENGTH) return json({ error: `Keep the message under ${MAX_LENGTH} characters.` }, 400);
  const list = (Array.isArray(to) ? to : [to]).map(String);
  if (list.length === 0 || list.length > MAX_RECIPIENTS) {
    return json({ error: `Send to between 1 and ${MAX_RECIPIENTS} numbers at a time.` }, 400);
  }

  const results: { to: string; ok: boolean; id?: string; status?: string; error?: string }[] = [];
  for (const raw of list) {
    const number = toInternational(raw);
    if (!number) { results.push({ to: raw, ok: false, error: "Not a valid phone number" }); continue; }
    try {
      const res = await fetch(HTTPSMS_URL, {
        method: "POST",
        headers: { "x-api-key": cfg.api_key, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ from: cfg.from_number, to: number, content: text }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) results.push({ to: number, ok: true, id: body?.data?.id, status: body?.data?.status });
      else results.push({ to: number, ok: false, error: body?.message || `httpSMS answered ${res.status}` });
    } catch (e) {
      results.push({ to: number, ok: false, error: (e as Error).message });
    }
  }

  const sent = results.filter((r) => r.ok).length;
  return json({ sent, failed: results.length - sent, results });
});
