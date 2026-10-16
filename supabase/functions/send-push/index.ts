// send-push: delivers a saved notification as a web push to every device of
// its recipients, so people are alerted even when the site is closed.
//
// Called by the public.notifications insert trigger with {"id": "<uuid>"}.
// Deployed with verify_jwt off: it needs no caller credentials because it
// re-reads the notification itself (callers can't inject content) and claims
// it by setting push_sent_at, so each notification is pushed at most once.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ROLE_BY_TARGET: Record<string, string> = {
  admin: "admin", admins: "admin",
  teacher: "teacher", teachers: "teacher",
  parent: "parent", parents: "parent",
  accountant: "accountant", accountants: "accountant",
};

let vapidReady = false;
async function configureVapid() {
  if (vapidReady) return;
  const { data, error } = await supabase
    .from("push_config")
    .select("vapid_public, vapid_private, subject")
    .eq("id", 1)
    .single();
  if (error || !data) throw new Error("push_config is missing");
  webpush.setVapidDetails(data.subject, data.vapid_public, data.vapid_private);
  vapidReady = true;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let id: unknown;
  try { ({ id } = await req.json()); } catch { return json({ error: "bad body" }, 400); }
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad id" }, 400);

  // Claim the notification: only the first call for a fresh (last 15 min)
  // notification gets a row back, so nothing is pushed twice or late.
  const { data: n, error: claimError } = await supabase
    .from("notifications")
    .update({ push_sent_at: new Date().toISOString() })
    .eq("id", id)
    .is("push_sent_at", null)
    .gte("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString())
    .select("id, user_id, title, message, type, target, created_by")
    .maybeSingle();
  if (claimError) return json({ error: claimError.message }, 500);
  if (!n) return json({ skipped: true });

  // Who should get it: the addressed user, or everyone in the announcement's audience.
  let userIds: string[] = [];
  if (n.user_id) {
    userIds = [n.user_id];
  } else if (n.type === "announcement") {
    const target = String(n.target || "all").toLowerCase();
    let query = supabase.from("profiles").select("id");
    if (target !== "all") {
      const role = ROLE_BY_TARGET[target];
      if (!role) return json({ sent: 0, reason: "unknown target" });
      query = query.eq("role", role);
    }
    const { data: people, error } = await query;
    if (error) return json({ error: error.message }, 500);
    userIds = (people || []).map((p) => p.id).filter((uid) => uid !== n.created_by);
  }
  if (userIds.length === 0) return json({ sent: 0, recipients: 0 });

  const subs: { id: string; endpoint: string; p256dh: string; auth: string }[] = [];
  for (let i = 0; i < userIds.length; i += 200) {
    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", userIds.slice(i, i + 200));
    if (error) return json({ error: error.message }, 500);
    subs.push(...(data || []));
  }
  if (subs.length === 0) return json({ sent: 0, recipients: userIds.length, devices: 0 });

  await configureVapid();
  const payload = JSON.stringify({
    title: n.title || "Ridgevalley SMS",
    body: String(n.message || "").slice(0, 180),
    tag: n.id,
    url: "./",
  });

  let sent = 0, removed = 0, failed = 0;
  for (let i = 0; i < subs.length; i += 25) {
    await Promise.all(subs.slice(i, i + 25).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 86400, urgency: "high" },
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The browser dropped this subscription; forget it.
          await supabase.from("push_subscriptions").delete().eq("id", s.id);
          removed++;
        } else {
          failed++;
          console.error("push failed", status, (e as Error).message);
        }
      }
    }));
  }

  return json({ sent, removed, failed, recipients: userIds.length, devices: subs.length });
});
