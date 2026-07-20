import { createClient } from "@supabase/supabase-js";

const OWNER_EMAILS = ["djh1984investing@gmail.com", "djharrison", "durrell", "djh1984investing-eng"];
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const discordWebhookUrl = process.env.DISCORD_PLAYMAKER_SIGNALS_WEBHOOK_URL;
const crownIconUrl = process.env.DISCORD_PLAYMAKER_CROWN_ICON_URL;
const sentDiscordEvents = globalThis.__playmakerDiscordEvents || new Map();
globalThis.__playmakerDiscordEvents = sentDiscordEvents;

const isOwnerUser = (user) => {
  const text = String(user?.email || user?.id || "").toLowerCase();
  return OWNER_EMAILS.some((owner) => text.includes(String(owner).toLowerCase()));
};

const isManualAnchor = ({ event = "", title = "", detail = "", anchor = {} } = {}) => {
  const sourceType = String(anchor.sourceType || anchor.source_type || anchor.rawSignal?.sourceType || anchor.payload?.sourceType || "").toLowerCase();
  const signalName = String(anchor.signalName || anchor.rawSignal?.signal || anchor.payload?.signal || "").toLowerCase();
  const text = `${event} ${title} ${detail}`.toLowerCase();
  const isAiSignal = sourceType === "ai signal" || sourceType.includes("persistent level") || signalName.includes("stacked cluster");
  return !isAiSignal && (sourceType.includes("manual") || signalName.includes("manual") || text.includes("manual order") || text.includes("manual scan"));
};

const hasOnlyManualPillars = (anchor = {}) => {
  const evidence = Array.isArray(anchor.evidence)
    ? anchor.evidence
    : Array.isArray(anchor.rawSignal?.evidence)
      ? anchor.rawSignal.evidence
      : Array.isArray(anchor.payload?.evidence)
        ? anchor.payload.evidence
        : [];
  const manualSourceTypes = new Set(["weekly level", "volume crater / lvn"]);
  return Boolean(anchor.hasOnlyManualPillars) || (evidence.length > 0 && evidence.every((item) => manualSourceTypes.has(String(item?.sourceType || "").toLowerCase())));
};

const isDiscordEligibleSignal = (anchor = {}) => {
  if (!anchor || isManualAnchor({ anchor }) || hasOnlyManualPillars(anchor)) return false;
  const sourceType = String(anchor.sourceType || anchor.source_type || anchor.rawSignal?.sourceType || anchor.payload?.sourceType || "").toLowerCase();
  const signalName = String(anchor.signalName || anchor.rawSignal?.signal || anchor.payload?.signal || "").toLowerCase();
  return sourceType === "ai signal" || sourceType.includes("persistent level") || signalName.includes("stacked cluster");
};

const isBillingOrWhopEvent = ({ event = "", title = "", detail = "", anchor = {} } = {}) => {
  const text = [
    event,
    title,
    detail,
    anchor?.type,
    anchor?.event,
    anchor?.source,
    anchor?.sourceType,
    anchor?.source_type,
    anchor?.signalName,
    anchor?.customer,
    anchor?.email,
    anchor?.payment,
    anchor?.subscription,
    anchor?.invoice,
    anchor?.checkout,
    anchor?.rawSignal?.type,
    anchor?.rawSignal?.event,
    anchor?.rawSignal?.source,
    anchor?.payload?.type,
    anchor?.payload?.event,
    anchor?.payload?.source
  ].map((value) => String(value || "").toLowerCase()).join(" ");

  return [
    "whop",
    "payment",
    "paid",
    "checkout",
    "invoice",
    "billing",
    "subscription",
    "customer",
    "receipt",
    "refund",
    "charge",
    "card",
    "trial",
    "plan_"
  ].some((word) => text.includes(word));
};

const normalizePrice = (value) => {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? String(Math.round(parsed * 4) / 4) : "NA";
};

const discordEventKey = ({ event = "UPDATE", title = "", detail = "", anchor = {} } = {}) => {
  const direction = String(anchor.direction || anchor.rawSignal?.direction || "BOTH").toUpperCase();
  const entry = normalizePrice(anchor.entry || anchor.price || anchor.rawSignal?.entry || anchor.rawSignal?.price);
  const grade = String(anchor.grade || anchor.rawSignal?.ai_grade || "");
  const sources = String(anchor.sourceCount || anchor.evidence?.length || anchor.rawSignal?.evidence?.length || "");
  const signature = String(anchor.signature || anchor.evidenceSignature || anchor.rawSignal?.id || anchor.id || "").slice(0, 80);
  const detailSignature = ["VERIFIED", "NOTE_UPDATED"].includes(String(event).toUpperCase()) ? String(detail || "").slice(0, 160) : "";
  return [event, direction, entry, grade, sources, signature, detailSignature].map((part) => String(part || "").trim()).join("|");
};

const shouldSkipDuplicate = (payload) => {
  const now = Date.now();
  const cutoff = now - 30 * 60 * 1000;
  for (const [key, sentAt] of sentDiscordEvents.entries()) {
    if (sentAt < cutoff) sentDiscordEvents.delete(key);
  }

  const key = discordEventKey(payload);
  if (sentDiscordEvents.has(key)) return true;
  sentDiscordEvents.set(key, now);
  return false;
};

const postToDiscord = async ({ event = "UPDATE", title = "Playmaker Signal", detail = "", anchor = {} }) => {
  if (!discordWebhookUrl) return { skipped: true };
  if (isBillingOrWhopEvent({ event, title, detail, anchor })) return { skipped: true, reason: "Billing and Whop events are private" };
  if (isManualAnchor({ event, title, detail, anchor })) return { skipped: true, reason: "Manual order notices are local only" };
  if (!isDiscordEligibleSignal(anchor)) return { skipped: true, reason: "Only Playmaker signal events go to Discord" };
  if (shouldSkipDuplicate({ event, title, detail, anchor })) return { skipped: true, reason: "Duplicate notice skipped" };

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
