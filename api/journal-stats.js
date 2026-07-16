import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const normalizeStatus = (value) => String(value || "").trim().toLowerCase();

const isCompletedTradeResult = (row) => {
  return ["win", "loss", "be"].includes(normalizeStatus(row?.result));
};

const isGlobalJournalRow = (row) => {
  const scope = String(row?.verification?.journalScope || row?.verification?.scope || "").toLowerCase();
  const notes = String(row?.notes || "").toLowerCase();
  const legacyGlobal = !scope && !notes.includes("local journal");
  return isCompletedTradeResult(row) && scope !== "local" && (scope === "global" || legacyGlobal);
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limit = Math.min(Number(req.query.limit) || 1000, 2000);

  try {
    const { data, error } = await supabase
      .from("trade_journal")
      .select("id,created_at,result,max_move,max_drawdown,profit_loss,verification,notes")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Journal stats fetch error:", error);
      return res.status(500).json({ error: "Unable to load journal stats" });
    }

    const rows = (data || []).filter(isGlobalJournalRow).map((row) => ({
      id: row.id || "",
      createdAt: row.created_at || null,
      statsUpdatedAt: row.verification?.statsUpdatedAt || row.created_at || null,
      result: row.result || "",
      maxMove: row.max_move ?? "",
      maxDrawdown: row.max_drawdown ?? "",
      profitLoss: row.profit_loss ?? "",
      verification: row.verification || null,
      journalScope: row.verification?.journalScope || row.verification?.scope || ""
    }));

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ rows });
  } catch (error) {
    console.error("Journal stats API error:", error);
    return res.status(500).json({ error: "Unable to load journal stats" });
  }
}
