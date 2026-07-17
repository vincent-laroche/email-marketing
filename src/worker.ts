import { Webhook } from "standardwebhooks";

export interface Env {
  EMAIL_MARKETING_DB: D1Database;
  RESEND_WEBHOOK_SECRET?: string;
  EMAIL_MARKETING_ADMIN_TOKEN?: string;
}

function json(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
}

function eventEmail(event: Record<string, unknown>) {
  const data = event.data as Record<string, unknown> | undefined;
  const to = data?.to;
  if (Array.isArray(to)) return typeof to[0] === "string" ? to[0].trim().toLowerCase() : null;
  if (typeof to === "string") return to.trim().toLowerCase();
  return typeof data?.email === "string" ? data.email.trim().toLowerCase() : null;
}

async function processResendEvent(env: Env, event: Record<string, unknown>, rawPayload: string, signatureValid: boolean) {
  const providerEventId = String(event.created_at ?? event.id ?? crypto.randomUUID());
  const eventType = String(event.type ?? "unknown");
  const now = new Date().toISOString();
  await env.EMAIL_MARKETING_DB.prepare(
    "INSERT OR IGNORE INTO webhook_events (provider_event_id, provider, event_type, received_at, signature_valid, payload_json) VALUES (?, 'resend', ?, ?, ?, ?)"
  ).bind(providerEventId, eventType, now, signatureValid ? 1 : 0, rawPayload).run();

  const email = eventEmail(event);
  const contactUnsubscribed = eventType === "contact.updated" && (event.data as Record<string, unknown> | undefined)?.unsubscribed === true;
  const reason = eventType === "email.bounced"
    ? "bounce"
    : eventType === "email.complained"
      ? "complaint"
      : eventType === "email.suppressed"
        ? "provider_suppression"
        : contactUnsubscribed
          ? "unsubscribe"
          : null;
  if (email && reason) {
    await env.EMAIL_MARKETING_DB.prepare(
      "INSERT OR IGNORE INTO suppressions (id, email, reason, scope, source_system, observed_at, permanent, created_at) VALUES (?, ?, ?, 'global', 'Resend', ?, 1, ?)"
    ).bind(`${providerEventId}:${reason}`, email, reason, now, now).run();
    await env.EMAIL_MARKETING_DB.prepare("UPDATE contacts SET eligibility_status = 'suppressed', suppression_reason = ?, updated_at = ? WHERE email = ?")
      .bind(reason, now, email).run();
  }
  await env.EMAIL_MARKETING_DB.prepare("UPDATE webhook_events SET processed_at = ? WHERE provider_event_id = ?").bind(now, providerEventId).run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "email-marketing-control-plane" });

    if (request.method === "POST" && url.pathname === "/webhooks/resend") {
      if (!env.RESEND_WEBHOOK_SECRET) return json({ error: "Webhook secret is not configured" }, { status: 503 });
      const rawPayload = await request.text();
      let event: Record<string, unknown>;
      try {
        event = await new Webhook(env.RESEND_WEBHOOK_SECRET).verify(rawPayload, {
          "webhook-id": request.headers.get("webhook-id") ?? "",
          "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
          "webhook-signature": request.headers.get("webhook-signature") ?? ""
        }) as Record<string, unknown>;
      } catch {
        return json({ error: "Invalid webhook signature" }, { status: 401 });
      }
      await processResendEvent(env, event, rawPayload, true);
      return json({ ok: true });
    }

    if (url.pathname.startsWith("/admin/")) {
      const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!env.EMAIL_MARKETING_ADMIN_TOKEN || token !== env.EMAIL_MARKETING_ADMIN_TOKEN) return json({ error: "Unauthorized" }, { status: 401 });
      if (request.method === "GET" && url.pathname === "/admin/status") {
        const contacts = await env.EMAIL_MARKETING_DB.prepare("SELECT eligibility_status, COUNT(*) AS count FROM contacts GROUP BY eligibility_status").all();
        return json({ contacts: contacts.results });
      }
      return json({ error: "Not found" }, { status: 404 });
    }
    return json({ error: "Not found" }, { status: 404 });
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    await env.EMAIL_MARKETING_DB.prepare(
      "INSERT INTO sync_runs (id, operation, status, summary_json, created_at, completed_at) VALUES (?, 'nightly-reconciliation', 'pending_external_resend_access', '{}', ?, ?)"
    ).bind(crypto.randomUUID(), new Date().toISOString(), new Date().toISOString()).run();
  }
} satisfies ExportedHandler<Env>;
