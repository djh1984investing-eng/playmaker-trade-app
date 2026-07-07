import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const webhookSecret = process.env.PLAYMAKER_WEBHOOK_SECRET;

const supabase = createClient(supabaseUrl, supabaseKey);

const getSubmittedSecret = (req) => {
  const authSecret = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  return String(
    req.headers["x-playmaker-secret"] ||
    authSecret ||
    req.query?.secret ||
    req.body?.secret ||
    ""
  ).trim();
};

const safeText = (value, fallback = "", maxLength = 120) => {
  const text = String(value || fallback).trim();
  return text.slice(0, maxLength);
};

const parseNumber = (value) => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");

const removeMissingColumn = (row, message = "") => {
  const match = String(message).match(/'([^']+)' column|column "([^"]+)"/i);
  const column = match?.[1] || match?.[2];
  if (!column || !(column in row)) return false;
  delete row[column];
  return true;
};

const insertSignalRow = async (row) => {
  let nextRow = { ...row };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase
      .from("playmaker_signals")
      .insert([nextRow])
      .select();

    if (!error) return { data, error: null, savedColumns: Object.keys(nextRow) };

    const missingColumn = /column/i.test(error.message || "") && removeMissingColumn(nextRow, error.message);
    if (!missingColumn) return { data: null, error };
  }

  return { data: null, error: new Error("Could not save signal after removing unsupported columns") };
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "POST only" });
  }

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ ok: false, message: "Supabase server config is missing" });
  }

  if (!webhookSecret) {
    return res.status(500).json({ ok: false, message: "Webhook secret is not configured" });
  }

  if (getSubmittedSecret(req) !== webhookSecret) {
    return res.status(401).json({ ok: false, message: "Unauthorized webhook" });
  }

  try {
    const signal = req.body || {};
    const triggerPrice = parseNumber(firstDefined(signal.trigger_price, signal.current_price, signal.close, signal.last, signal.alert_price));
    const entryPrice = parseNumber(firstDefined(signal.entry, signal.entry_price, signal.limit_price, signal.price));
    const displayPrice = parseNumber(firstDefined(signal.price, signal.entry, signal.entry_price, signal.trigger_price, signal.current_price, signal.close, signal.last));
    const row = {
      user_id: "tradingview",
      symbol: safeText(signal.symbol || signal.ticker, "MNQ", 24).toUpperCase(),
      timeframe: safeText(signal.timeframe || signal.interval || signal.tf, "", 24),
      signal: safeText(signal.signal || signal.setup || signal.alert_name, "Playmaker Signal", 180),
      direction: safeText(signal.direction || signal.side || signal.action, "", 24).toUpperCase(),
      price: displayPrice,
      entry_price: entryPrice,
      trigger_price: triggerPrice,
      raw: signal,
      raw_json: signal,
      payload: signal
    };

    const { data, error, savedColumns } = await insertSignalRow(row);

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.status(200).json({ ok: true, data, savedColumns });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
