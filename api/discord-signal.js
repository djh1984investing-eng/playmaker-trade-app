import { createClient } from "@supabase/supabase-js";

const OWNER_EMAILS = ["djh1984investing@gmail.com", "djharrison", "durrell", "djh1984investing-eng"];
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const discordWebhookUrl = process.env.DISCORD_PLAYMAKER_SIGNALS_WEBHOOK_URL;
const crownIconUrl = process.env.DISCORD_PLAYMAKER_CROWN_ICON_URL;

const isOwnerUser = (user) => {
  const text = String(user?.email || user?.id || "").toLowerCase();
  return OWNER_EMAILS.some((owner) => text.includes(String(owner).toLowerCase()));
};

const postToDiscord = async ({ event = "UPDATE", title = "Playmaker Signal", detail = "", anchor = {} }) => {
  if (!discordWebhookUrl) return { skipped: true };

  const direction = String(anchor.direction || anchor.rawSignal?.direction || "").toUpperCase();
  const entry = anchor.entry || anchor.price || anchor.rawSignal?.entry || anchor.rawSignal?.price || "";
  const grade = anchor.grade || anchor.rawSignal?.ai_grade || "";
  const sources = anchor.sourceCount || anchor.evidence?.length || anchor.rawSignal?.evidence?.length || "";

  const description = [
    `**Event:** ${String(event).slice(0, 80)}`,
    direction ? `**Direction:** ${direction.slice(0, 24)}` : null,
    entry ? `**Entry:** ${String(entry).slice(0, 40)}` : null,
    grade ? `**Grade:** ${String(grade).slice(0, 24)}` : null,
    sources ? `**Sources:** ${String(sources).slice(0, 12)}` : null,
    detail ? `**Details:** ${String(detail).slice(0, 700)}` : null
  ].filter(Boolean).join("\n");

  const response = await fetch(discordWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "👑 Playmaker Signal",
      avatar_url: crownIconUrl || undefined,
      embeds: [
        {
          title: `👑 ${String(title).slice(0, 110)}`,
          description,
          color: 16763929,
          timestamp: new Date().toISOString(),
          footer: { text: "Playmaker members-only signal" }
        }
      ]
    })
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${response.status} ${message}`.trim());
  }

  return { sent: true };
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "POST only" });
  }

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ ok: false, message: "Supabase server config is missing" });
  }

  if (!discordWebhookUrl) {
    return res.status(200).json({ ok: true, discord: { skipped: true, reason: "Webhook not configured" } });
  }

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return res.status(401).json({ ok: false, message: "Missing login token" });
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user || !isOwnerUser(data.user)) {
    return res.status(403).json({ ok: false, message: "Owner access required" });
  }

  try {
    const discord = await postToDiscord(req.body || {});
    return res.status(200).json({ ok: true, discord });
  } catch (err) {
    console.error("Playmaker Discord signal error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
