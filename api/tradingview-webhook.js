import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "POST only" });
  }

  try {
    const signal = req.body || {};

    const payload = {
      user_id: signal.user_id || "djh1984investing-eng",
      symbol: signal.symbol || signal.ticker || "NQ",
      timeframe: signal.timeframe || signal.interval || "",
      signal: signal.signal || signal.setup || "TradingView Signal",
      direction:
        signal.direction ||
        (String(signal.signal || "").toLowerCase().includes("bearish") ||
        String(signal.signal || "").toLowerCase().includes("short") ||
        String(signal.signal || "").toLowerCase().includes("sell")
          ? "Short"
          : "Long"),
      price: Number(signal.price || signal.entry || signal.entry_price) || null,
      raw: signal
    };

    const { error } = await supabase
      .from("playmaker_signals")
      .insert([payload]);

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.status(200).json({
      ok: true,
      message: "TradingView signal saved",
      payload
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}