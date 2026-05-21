import React, { useMemo, useState } from "react";
import WhopGate from "./components/WhopGate";
import { supabase } from "./lib/supabaseClient";
const GREEN = "#00d27a";
const GOLD = "#ffcc19";

const startingOptions = [
  "prevWeekLevel",
  "playMakerSignal",
  "prevSessionSTDV",
  "priorSessionSTDV",
  "oneHSTDV",
  "fourHSTDV",
  "retrace15m",
  "retrace1H",
  "retrace4H"
];

const baseWeights = {
  prevWeekLevel: 9,
  lowVolumeNode: 10,
  playMakerSignal: 7.5,
  prevSessionSTDV: 8,
  priorSessionSTDV: 5.5,
  oneHSTDV: 6,
  fourHSTDV: 7,
  retrace15m: 5,
  retrace1H: 6,
  retrace4H: 7,
  orderBlock: 5,
  rejectionBlock: 5,
  fvg: 5,
  prevHighLow: 4,
  ltfVolNode: 7,
  liquidity: 8
};

const stdvChoices = ["0", "0.5", "0.705", "1", "1.5", "2", "2.25", "2.5", "3", "3.5", "4", "4.5", "-0.5", "-0.705", "-1", "-1.5", "-2", "-2.25", "-2.5", "-3", "-3.5", "-4", "-4.25", "-4.5"];
const retraceChoices = ["None", "0.50", "0.618", "0.705", "0.786"];
const tfChoices = ["5m", "15m", "1H", "4H"];

const n = (v, f = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : f;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isYes = (v) => v === "Yes";
const fmt = (v) => Number(v).toFixed(2);

function distanceMult(pointsAway) {
  const d = Math.abs(n(pointsAway));
  if (d <= 1) return 1;
  if (d <= 3) return 0.92;
  if (d <= 5) return 0.78;
  if (d <= 7) return 0.55;
  if (d <= 10) return 0.28;
  return 0.12;
}

function stdvMult(v) {
  const num = Math.abs(Number(v));
  if (num >= 4) return 1.45;
  if (num >= 3) return 1.3;
  if (num >= 2) return 1.1;
  if (num >= 1) return 0.9;
  if (num >= 0.705) return 0.75;
  if (num >= 0.5) return 0.6;
  return 0;
}

function retraceMult(v, trend) {
  let m = 0;
  if (v === "0.786") m = 1.25;
  if (v === "0.705") m = 1.15;
  if (v === "0.618") m = 1;
  if (v === "0.50") m = 0.8;
  return trend === "Against Trend" ? m * 1.1 : m;
}

function tfMult(v) {
  if (v === "4H") return 1.25;
  if (v === "1H") return 1;
  if (v === "15m") return 0.75;
  if (v === "5m") return 0.55;
  return 1;
}

function lvnWidthMult(width) {
  const w = n(width);
  if (w >= 100) return 1.35;
  if (w >= 70) return 1.2;
  if (w >= 40) return 1.05;
  if (w >= 20) return 0.85;
  if (w > 0) return 0.7;
  return 0;
}

function grade(score) {
  if (score >= 92) return ["A+", "Elite Setup"];
  if (score >= 84) return ["A", "High Probability"];
  if (score >= 74) return ["B+", "Strong Setup"];
  if (score >= 65) return ["B", "Tradable Setup"];
  if (score >= 55) return ["C", "Needs Confirmation"];
  return ["D", "Wait / Low Quality"];
}

function dirSide(direction) {
  return direction === "Long" ? -1 : 1;
}

export default function PlaymakerSetupGrader() {
  const [tab, setTab] = useState("checklist");
  const [journal, setJournal] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [startingLevel, setStartingLevel] = useState("playMakerSignal");
  const [aiSettings, setAiSettings] = useState({
    volumeCraterTop: "",
    volumeCraterBottom: "",
    weeklyLevelPrice: "",
    autoUseIndicator: "Yes"
  });
  const [form, setForm] = useState({
    tradeEntryPrice: "21450",
    direction: "Long",
    bias1H: "Bullish",
    bias4H: "Bullish",
    trend: "With Trend",

    prevWeekLevelOn: "Yes",
    prevWeekLevelAway: "0",

    lowVolumeNodeOn: "Yes",
    lowVolumeNodeWidth: "100",
    lowVolumeNodeAway: "5",

    playMakerSignalOn: "Yes",
    playMakerSignalAway: "0",

    prevSessionSTDVOn: "No",
    prevSessionSTDVAway: "3",
    prevSessionSTDVValue: "3",

    priorSessionSTDVOn: "No",
    priorSessionSTDVAway: "4",
    priorSessionSTDVValue: "3",

    oneHSTDVOn: "No",
    oneHSTDVAway: "2",
    oneHSTDVValue: "2",

    fourHSTDVOn: "No",
    fourHSTDVAway: "2",
    fourHSTDVValue: "3",

    retrace15mOn: "No",
    retrace15mAway: "2",
    retrace15mValue: "0.705",

    retrace1HOn: "No",
    retrace1HAway: "3",
    retrace1HValue: "0.618",

    retrace4HOn: "No",
    retrace4HAway: "3",
    retrace4HValue: "0.705",

    orderBlockOn: "No",
    orderBlockAway: "4",
    orderBlockTF: "1H",
    orderBlockState: "Fresh",

    rejectionBlockOn: "No",
    rejectionBlockAway: "4",
    rejectionBlockTF: "1H",
    rejectionBlockState: "Fresh",

    fvgOn: "No",
    fvgAway: "4",
    fvgTF: "1H",
    fvgState: "Fresh",

    prevHighLowOn: "No",
    prevHighLowAway: "3",
    prevHighLowTaps: "1",

    ltfVolNodeOn: "No",
    ltfVolNodeAway: "2",

    liquidityOn: "No",

    result: "Unfilled",
    maxMove: "",
    maxDrawdown: "",
    profitLoss: "",
    notes: "",
    tradeImages: []
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const setStart = (key) => {
    setStartingLevel((cur) => (cur === key ? "" : key));
    const awayKey = `${key}Away`;
    if (awayKey in form) set(awayKey, "0");
  };

  const away = (key) => (startingLevel === key ? 0 : n(form[`${key}Away`]));
  const canStart = (key) => startingOptions.includes(key);
  const startDisabled = (key) => startingLevel && startingLevel !== key;

  const aiCraterSize = Math.abs(n(aiSettings.volumeCraterTop) - n(aiSettings.volumeCraterBottom));
  const aiCraterMid = aiSettings.volumeCraterTop && aiSettings.volumeCraterBottom
    ? (n(aiSettings.volumeCraterTop) + n(aiSettings.volumeCraterBottom)) / 2
    : 0;
  const aiCraterAway = aiCraterMid ? Math.abs(aiCraterMid - n(form.tradeEntryPrice)) : 0;
  const aiWeeklyAway = aiSettings.weeklyLevelPrice ? Math.abs(n(aiSettings.weeklyLevelPrice) - n(form.tradeEntryPrice)) : 0;

  const aiChecklist = [
    { item: "Volume crater top", value: aiSettings.volumeCraterTop, needed: "Top of manually drawn crater box" },
    { item: "Volume crater bottom", value: aiSettings.volumeCraterBottom, needed: "Bottom of manually drawn crater box" },
    { item: "Crater size", value: aiCraterSize ? fmt(aiCraterSize) : "", needed: "Used by AI weighting" },
    { item: "Weekly level price", value: aiSettings.weeklyLevelPrice, needed: "Manual weekly level for AI setup checks" },
    { item: "Trade entry price", value: form.tradeEntryPrice, needed: "Used to calculate distance from levels" },
    { item: "Indicator automation", value: aiSettings.autoUseIndicator, needed: "Lets webhook signals combine with manual AI levels" }
  ];

  const report = useMemo(() => {
    const rows = [];
    const add = (key, name, base, active, pointsAway, mult = 1, note = "") => {
      const score = active ? base * mult * distanceMult(pointsAway) : 0;
      rows.push({ key, name, base, pointsAway, score, active, note });
      return score;
    };

    add("prevWeekLevel", "Previous Week Level", baseWeights.prevWeekLevel, isYes(form.prevWeekLevelOn), away("prevWeekLevel"), 1, "Previous week high/low interaction.");

    add("lowVolumeNode", "Low Volume Node", baseWeights.lowVolumeNode, isYes(form.lowVolumeNodeOn), n(form.lowVolumeNodeAway), lvnWidthMult(form.lowVolumeNodeWidth), "Bigger LVN / volume crater = more weight.");

    add("playMakerSignal", "PlayMaker Signal", baseWeights.playMakerSignal, isYes(form.playMakerSignalOn), away("playMakerSignal"), isYes(form.playMakerSignalOn) ? 1 : 0, "Can be the starting level.");

    add("prevSessionSTDV", "Prev Session STDV", baseWeights.prevSessionSTDV, isYes(form.prevSessionSTDVOn), away("prevSessionSTDV"), stdvMult(form.prevSessionSTDVValue), "+3 or -3 and beyond carries more impact.");
    add("priorSessionSTDV", "Prior Session STDV", baseWeights.priorSessionSTDV, isYes(form.priorSessionSTDVOn), away("priorSessionSTDV"), stdvMult(form.priorSessionSTDVValue), "Session before previous session; lower weight.");
    add("oneHSTDV", "1H STDV", baseWeights.oneHSTDV, isYes(form.oneHSTDVOn), away("oneHSTDV"), stdvMult(form.oneHSTDVValue), "1H STDV matters but less than session deviations.");
    add("fourHSTDV", "4H STDV", baseWeights.fourHSTDV, isYes(form.fourHSTDVOn), away("fourHSTDV"), stdvMult(form.fourHSTDVValue), "4H STDV has stronger reaction value than 1H.");

    add("retrace15m", "15m Retracement", baseWeights.retrace15m, isYes(form.retrace15mOn), away("retrace15m"), retraceMult(form.retrace15mValue, form.trend), "Deeper retracement means more against trend.");
    add("retrace1H", "1H Retracement", baseWeights.retrace1H, isYes(form.retrace1HOn), away("retrace1H"), retraceMult(form.retrace1HValue, form.trend), "OTE/CE style retracement.");
    add("retrace4H", "4H Retracement", baseWeights.retrace4H, isYes(form.retrace4HOn), away("retrace4H"), retraceMult(form.retrace4HValue, form.trend), "Higher timeframe retracement.");

    const obFresh = form.orderBlockState === "Fresh" ? 1 : 0.75;
    add("orderBlock", "Order Block", baseWeights.orderBlock, isYes(form.orderBlockOn), n(form.orderBlockAway), tfMult(form.orderBlockTF) * obFresh, "Highest timeframe OB selected; fresh or prev tapped.");
    const rbFresh = form.rejectionBlockState === "Fresh" ? 1 : 0.75;
    add("rejectionBlock", "Rejection Block", baseWeights.rejectionBlock, isYes(form.rejectionBlockOn), n(form.rejectionBlockAway), tfMult(form.rejectionBlockTF) * rbFresh, "Higher timeframe means more.");
    const fvgFresh = form.fvgState === "Fresh" ? 1 : 0.75;
    add("fvg", "FVG", baseWeights.fvg, isYes(form.fvgOn), n(form.fvgAway), tfMult(form.fvgTF) * fvgFresh, "Higher timeframe FVG means more.");

    const taps = clamp(n(form.prevHighLowTaps, 1), 1, 10);
    add("prevHighLow", "Previous High / Low", baseWeights.prevHighLow, isYes(form.prevHighLowOn), n(form.prevHighLowAway), Math.max(0.25, 1.15 - taps * 0.12), "More taps = less value.");
    add("ltfVolNode", "LTF Volume Node", baseWeights.ltfVolNode, isYes(form.ltfVolNodeOn), n(form.ltfVolNodeAway), 1, "Used for entry precision.");
    add("liquidity", "Liquidity", baseWeights.liquidity, isYes(form.liquidityOn), 0, 1, "Yes/no liquidity context.");

    const active = rows.filter((r) => r.active && r.score > 0);
    const within3 = rows.filter((r) => r.active && Math.abs(r.pointsAway) <= 3).length;
    const within5 = rows.filter((r) => r.active && Math.abs(r.pointsAway) <= 5).length;
    const within7 = rows.filter((r) => r.active && Math.abs(r.pointsAway) <= 7).length;
    const farCount = rows.filter((r) => r.active && Math.abs(r.pointsAway) >= 8).length;
    const topWeighted = [...active].sort((a, b) => b.base - a.base || b.score - a.score).slice(0, 3);
    const topWithin3 = topWeighted.filter((r) => Math.abs(r.pointsAway) <= 3).length;
    const topWithin5 = topWeighted.filter((r) => Math.abs(r.pointsAway) <= 5).length;
    const topFar = topWeighted.filter((r) => Math.abs(r.pointsAway) >= 8).length;

    const compression =
      within5 >= 5 ? 14 :
      within5 >= 4 ? 11 :
      within5 >= 3 ? 8 :
      within7 >= 4 ? 5 :
      within7 >= 3 ? 3 :
      active.length >= 2 ? 1 :
      0;

    const coreStackAligned =
      isYes(form.prevWeekLevelOn) && isYes(form.lowVolumeNodeOn) && isYes(form.playMakerSignalOn) &&
      Math.abs(away("prevWeekLevel")) <= 5 &&
      Math.abs(n(form.lowVolumeNodeAway)) <= 5 &&
      Math.abs(away("playMakerSignal")) <= 5;

    const coreStackTight =
      isYes(form.prevWeekLevelOn) && isYes(form.lowVolumeNodeOn) && isYes(form.playMakerSignalOn) &&
      Math.abs(away("prevWeekLevel")) <= 3 &&
      Math.abs(n(form.lowVolumeNodeAway)) <= 3 &&
      Math.abs(away("playMakerSignal")) <= 3;

    const coreBonus =
      coreStackTight ? 28 :
      coreStackAligned ? 22 :
      isYes(form.prevWeekLevelOn) && isYes(form.lowVolumeNodeOn) ? 12 :
      isYes(form.lowVolumeNodeOn) && isYes(form.playMakerSignalOn) ? 10 :
      0;

    const raw = rows.reduce((sum, r) => sum + r.score, 0) + compression + coreBonus;
    const zoneScore = Math.round(clamp((raw / 82) * 100, 0, 100));

    let precisionScore = zoneScore;
    if (topWithin3 === 3) precisionScore += 10;
    else if (topWithin5 === 3) precisionScore += 5;
    else if (topWithin5 >= 2) precisionScore += 1;
    else precisionScore -= 10;

    if (topWithin3 === 3 && active.length >= 3) precisionScore = Math.max(precisionScore, 92);
    else if (topWithin5 === 3 && active.length >= 3) precisionScore = Math.max(precisionScore, 84);

    if (topWithin3 < 3) precisionScore = Math.min(precisionScore, 91);
    if (topFar >= 2) precisionScore = Math.min(precisionScore, 74);
    if (farCount >= 4) precisionScore = Math.min(precisionScore, 74);
    else if (farCount >= 3 && topWithin5 < 3) precisionScore = Math.min(precisionScore, 82);
    if (active.length >= 6 && topWithin5 < 2) precisionScore = Math.min(precisionScore, 76);

    const score = Math.round(clamp(precisionScore, 0, 100));

    return {
      rows,
      active,
      within3,
      within5,
      within7,
      farCount,
      topWeighted,
      topWithin3,
      topWithin5,
      topFar,
      compression,
      coreBonus,
      raw,
      zoneScore,
      precisionScore: score,
      score,
      confluences: active.length
    };
  }, [form, startingLevel]);

  const recommendations = useMemo(() => {
    const entry = n(form.tradeEntryPrice);
    const side = dirSide(form.direction);

    const priorityByStop = {
      7: ["ltfVolNode", "playMakerSignal", "fvg", "orderBlock", "rejectionBlock", "lowVolumeNode"],
      10: ["lowVolumeNode", "playMakerSignal", "prevWeekLevel", "prevSessionSTDV", "fourHSTDV", "ltfVolNode"],
      12: ["prevWeekLevel", "prevSessionSTDV", "fourHSTDV", "lowVolumeNode", "priorSessionSTDV", "liquidity"]
    };

    const active = report.rows
      .filter((r) => r.active && r.score > 0 && r.key !== "liquidity")
      .map((r) => ({ ...r, pullback: Math.abs(n(r.pointsAway)), signedPullback: n(r.pointsAway) }));

    return [7, 10, 12].map((stop) => {
      const min = stop * 0.10;
      const max = stop * 0.85;

      const ranked = active
        .filter((r) => r.pullback >= min && r.pullback <= max)
        .sort((a, b) => {
          const aRank = priorityByStop[stop].indexOf(a.key);
          const bRank = priorityByStop[stop].indexOf(b.key);
          const ar = aRank === -1 ? 99 : aRank;
          const br = bRank === -1 ? 99 : bRank;
          return ar - br || b.score - a.score;
        });

      const strongest = [...active].sort((a, b) => b.score - a.score)[0];
      const match = ranked[0] || strongest;
      const signedPullback = match ? match.signedPullback : side * (stop * 0.35);
      const limit = entry + signedPullback;
      const stopArea = form.direction === "Long" ? limit - stop : limit + stop;

      return {
        stop,
        limit,
        stopArea,
        match: match ? match.name : "Default pullback",
        confidence: match ? (match.score >= 8 ? "Strong" : "Moderate") : "Light",
        note:
          stop === 7 ? "Tighter entry. Best near LTF Vol Node / PlayMaker." :
          stop === 10 ? "Balanced entry. Best near LVN / PlayMaker stack." :
          "Wider protection. Best near HTF level / STDV."
      };
    });
  }, [report.rows, form.tradeEntryPrice, form.direction]);

  const behavior = useMemo(() => {
    const closed = journal.filter((j) => j.result !== "Edge" && j.result !== "Unfilled" && j.orderStatus !== "Unfilled");
    const wins = closed.filter((j) => j.result === "Win").length;
    const losses = closed.filter((j) => j.result === "Loss").length;
    const be = closed.filter((j) => j.result === "BE").length;
    const notesText = journal.map((j) => j.notes || "").join(" ").toLowerCase();
    let score = 5;
    if (closed.length >= 3 && wins > losses) score += 2;
    if (losses > wins) score -= 2;
    if (notesText.includes("chased") || notesText.includes("late")) score -= 1;
    if (notesText.includes("patient") || notesText.includes("followed")) score += 1;
    score = clamp(score, 0, 10);
    return { score, wins, losses, be, total: closed.length };
  }, [journal]);

  const tips = useMemo(() => {
    const t = [];
    if (report.coreBonus > 0) t.push("Core setup is active: Previous Week Level + LVN + PlayMaker stack is your strongest base.");
    if (n(form.lowVolumeNodeWidth) >= 70 && isYes(form.lowVolumeNodeOn)) t.push("LVN is wide: reaction weight is high, but use LTF volume node or tighter confluence for limit precision.");
    if (startingLevel) t.push("Starting level selected. All other starting-level toggles are locked to prevent mixed anchors.");
    if (isYes(form.ltfVolNodeOn)) t.push("LTF volume node is active: use it to pinpoint the entry suggestion.");
    if (form.orderBlockState === "Fresh" && form.orderBlockTF === "5m") t.push("Fresh low timeframe OB should stay lower weight because the turn can happen before the block fully builds.");
    if (journal.some((j) => j.pendingOrder || j.result === "Edge" || j.orderStatus === "Unfilled")) t.push("You have unfilled orders showing on the front screen. Review them before market close or market open.");
    return t;
  }, [form, startingLevel, report.coreBonus, journal]);

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files || []);

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setForm((prev) => ({
          ...prev,
          tradeImages: [...(prev.tradeImages || []), reader.result]
        }));
      };
      reader.readAsDataURL(file);
    });
  };

  const exportSetup = () => {
    const payload = {
      exportedAt: new Date().toLocaleString(),
      grade: grade(report.score)[0],
      precisionScore: report.score,
      zoneScore: report.zoneScore,
      score: report.score,
      tradeInfo: {
        entryPrice: form.tradeEntryPrice,
        direction: form.direction,
        bias1H: form.bias1H,
        bias4H: form.bias4H,
        trend: form.trend
      },
      recommendations,
      confluences: report.rows.filter((r) => r.active),
      tips,
      result: {
        result: form.result,
        maxMove: form.maxMove,
        maxDrawdown: form.maxDrawdown,
        profitLoss: form.profitLoss,
        notes: form.notes
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `playmaker-setup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printSetup = () => window.print();

  const saveTrade = async () => {
    const item = {
      id: editingId || Date.now(),
      date: new Date().toLocaleDateString(),
      direction: form.direction,
      entry: form.tradeEntryPrice,
      grade: grade(report.score)[0],
      score: report.score,
      result: form.result === "Edge" || form.result === "Unfilled" ? "Unfilled" : form.result,
      orderStatus: form.result === "Edge" || form.result === "Unfilled" ? "Unfilled" : "Reported",
      pendingOrder: form.result === "Edge" || form.result === "Unfilled",
      maxMove: form.maxMove,
      maxDrawdown: form.maxDrawdown,
      profitLoss: form.profitLoss,
      notes: form.notes,
      tradeImages: form.tradeImages,
      top: report.active.slice(0, 4).map((r) => r.name).join(", ")
    };
    const { error } = await supabase.from("trade_journal").insert([
  {
    user_id: "djh1984investing-eng",
    symbol: "NQ",
    direction: item.direction,
    entry_price: Number(item.entry),
    grade: item.grade,
    score: item.score,
    zone_score: report.zoneScore || report.score,
    precision_score: report.precisionScore || report.score,
    result: item.result,
    max_move: Number(item.maxMove) || null,
    max_drawdown: Number(item.maxDrawdown) || null,
    profit_loss: Number(item.profitLoss) || null,
    notes: item.notes,
    confluences: report.active,
    recommendations,
    screenshots: item.tradeImages || []
  }
]);

if (error) {
  console.error("Supabase save error:", error);
  alert("Trade saved locally, but database save failed.");
}
    setJournal((j) => editingId ? j.map((x) => x.id === editingId ? item : x) : [item, ...j]);
    setEditingId(null);
  };

  const editTrade = (item) => {
    setEditingId(item.id);
    setForm((f) => ({ ...f, direction: item.direction, tradeEntryPrice: item.entry, result: item.result, maxMove: item.maxMove, maxDrawdown: item.maxDrawdown, profitLoss: item.profitLoss, notes: item.notes,
      tradeImages: item.tradeImages || [] })) ;
    setTab("checklist");
  };

  const [letter, text] = grade(report.score);
  const unfilledOrders = journal.filter((j) => j.pendingOrder || j.result === "Edge" || j.result === "Unfilled" || j.orderStatus === "Unfilled");

  return (
    <WhopGate>
    <div className="min-h-screen bg-[#080808] text-white">
      <div className="mx-auto max-w-[1500px] p-4 md:p-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_325px]">
          <div>
            <div className="mb-5 text-[#ffcc19] font-black tracking-[0.24em] text-sm">♕ THE PLAYMAKER</div>
            <h1 className="text-5xl md:text-6xl font-black leading-none">Setup Grader</h1>
            <p className="mt-3 text-xl text-zinc-300">Starting-level scoring, distance compression, weighted confluences, behavior review, and trade journal.</p>
          </div>
          <div className="rounded-3xl border border-[#2c2300] bg-black p-7 shadow-xl shadow-black/50">
            <div className="flex items-start gap-5">
              <div className="text-7xl font-black text-[#00e68a]">{letter}</div>
              <div className="mt-2 rounded-full bg-[#00d27a] px-5 py-2 text-sm font-black text-black">{report.score}/100</div>
            </div>
            <div className="mt-2 text-2xl text-zinc-200">{text}</div>
            <div className="mt-4 h-2 rounded-full bg-zinc-900"><div className="h-full rounded-full bg-[#00d27a]" style={{width: `${report.score}%`}} /></div>
          </div>
        </div>

        <div className="mt-7 grid gap-5 md:grid-cols-5">
          <Dash label="Confluences" value={report.confluences} />
          <Dash label="Within 5 Points" value={report.within5} />
          <Dash label="Zone Score" value={`${report.zoneScore}/100`} />
          <Dash label="Precision Score" value={`${report.score}/100`} />
          <Dash label="Behavior Score" value={`${behavior.score}/10`} />
        </div>

        <div className="mt-5 rounded-3xl border border-[#2c2300] bg-black p-5 shadow-lg shadow-black/30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm font-black tracking-[0.2em] text-[#ffcc19]">ACTIVE TRADE ANCHOR</div>
              <div className="mt-2 text-2xl font-black text-white">{form.direction}: {Number(form.tradeEntryPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="mt-1 text-sm text-zinc-400">Starting Level: {startingLevel || "None selected"} • Top 3 within 5 pts: {report.topWithin5}/3 • Far levels: {report.farCount}</div>
            </div>
            <div className="grid gap-2 text-sm text-zinc-300 md:grid-cols-3">
              {recommendations.map((r) => (
                <div key={r.stop} className="rounded-xl border border-zinc-800 bg-[#090909] p-3">
                  <div className="font-black text-[#ffcc19]">{r.stop}pt Stop</div>
                  <div>Limit: {Number(r.limit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div>Stop: {Number(r.stopArea).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {unfilledOrders.length > 0 && (
          <div className="mt-6 rounded-3xl border border-[#ffcc19] bg-black p-5 shadow-xl shadow-yellow-950/20">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-black uppercase tracking-[0.22em] text-[#ffcc19]">Unfilled Orders</div>
                <p className="mt-1 text-sm text-zinc-400">These are saved trades that have not been reported yet. Check them before market close/open.</p>
              </div>
              <button onClick={() => setTab("journal")} className="rounded-xl bg-[#ffcc19] px-4 py-2 font-black text-black">Review Orders</button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {unfilledOrders.map((order) => (
                <div key={order.id} className="rounded-2xl border border-[#2c2300] bg-[#090909] p-4">
                  <div className="text-xl font-black text-[#00d27a]">{order.direction}: {Number(order.entry).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="mt-1 text-sm text-zinc-400">Grade {order.grade} • {order.score}/100</div>
                  <div className="mt-1 text-xs text-zinc-500">{order.date} • {order.top || "No top confluence saved"}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 rounded-3xl border border-[#2c2300] bg-black p-2">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <Tab id="trade" tab={tab} setTab={setTab}>Trade Info</Tab>
            <Tab id="checklist" tab={tab} setTab={setTab}>Setup Checklist</Tab>
            <Tab id="settings" tab={tab} setTab={setTab}>AI Settings</Tab>
            <Tab id="behavior" tab={tab} setTab={setTab}>Behavior</Tab>
            <Tab id="breakdown" tab={tab} setTab={setTab}>Score Breakdown</Tab>
            <Tab id="journal" tab={tab} setTab={setTab}>Journal</Tab>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={exportSetup} className="rounded-xl bg-[#ffcc19] px-5 py-3 font-black text-black shadow-lg shadow-yellow-950/30">Export Setup File</button>
          <button onClick={printSetup} className="rounded-xl border border-[#ffcc19] bg-black px-5 py-3 font-black text-[#ffcc19] hover:bg-[#171200]">Print / Save PDF</button>
        </div>

        {tab === "trade" && (
          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <Title>Trade Info</Title>
              <div className="grid gap-5 md:grid-cols-3 mt-5">
                <Field label="Trade Entry Price" value={form.tradeEntryPrice} onChange={(v) => set("tradeEntryPrice", v)} />
                <Select label="Long / Short" value={form.direction} options={["Long", "Short"]} onChange={(v) => set("direction", v)} />
                <Select label="Trend" value={form.trend} options={["With Trend", "Against Trend", "Neutral"]} onChange={(v) => set("trend", v)} />
                <Select label="1H Bias" value={form.bias1H} options={["Bullish", "Bearish", "Indecisive"]} onChange={(v) => set("bias1H", v)} />
                <Select label="4H Bias" value={form.bias4H} options={["Bullish", "Bearish", "Indecisive"]} onChange={(v) => set("bias4H", v)} />
              </div>
            </Card>
            <Card>
              <Title>Adjusted Recommendations</Title>
              <div className="mt-4 space-y-3">{recommendations.map((r) => <Rec key={r.stop} r={r} />)}</div>
            </Card>
          </div>
        )}

        {tab === "checklist" && (
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <Conf title="Previous Week Level" base="9" active={form.prevWeekLevelOn} onActive={(v) => set("prevWeekLevelOn", v)}>
              <StartControl k="prevWeekLevel" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("prevWeekLevel")} />
              <Away k="prevWeekLevel" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="Low Volume Node" base="10" active={form.lowVolumeNodeOn} onActive={(v) => set("lowVolumeNodeOn", v)} sub="Bigger LVN / volume crater = more weight">
              <Field label="How Wide?" value={form.lowVolumeNodeWidth} onChange={(v) => set("lowVolumeNodeWidth", v)} />
              <Field label="Points Away From Starting Level" value={form.lowVolumeNodeAway} onChange={(v) => set("lowVolumeNodeAway", v)} />
            </Conf>

            <Conf title="PlayMaker Signal" base="7.5" active={form.playMakerSignalOn} onActive={(v) => set("playMakerSignalOn", v)}>
              <StartControl k="playMakerSignal" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("playMakerSignal")} />
              <Away k="playMakerSignal" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="Prev Session STDV" base="8" active={form.prevSessionSTDVOn} onActive={(v) => set("prevSessionSTDVOn", v)} sub="3, 3.5, 4 and beyond carry stronger reaction weighting">
              <StartControl k="prevSessionSTDV" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("prevSessionSTDV")} />
              <Select label="STDV" value={form.prevSessionSTDVValue} options={stdvChoices} onChange={(v) => set("prevSessionSTDVValue", v)} />
              <Away k="prevSessionSTDV" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="Prior Session STDV" base="5.5" active={form.priorSessionSTDVOn} onActive={(v) => set("priorSessionSTDVOn", v)} sub="Prior session STDV carries less weight than current previous session STDV">
              <StartControl k="priorSessionSTDV" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("priorSessionSTDV")} />
              <Select label="STDV" value={form.priorSessionSTDVValue} options={stdvChoices} onChange={(v) => set("priorSessionSTDVValue", v)} />
              <Away k="priorSessionSTDV" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="1H STDV" base="6" active={form.oneHSTDVOn} onActive={(v) => set("oneHSTDVOn", v)}>
              <StartControl k="oneHSTDV" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("oneHSTDV")} />
              <Select label="STDV" value={form.oneHSTDVValue} options={stdvChoices} onChange={(v) => set("oneHSTDVValue", v)} />
              <Away k="oneHSTDV" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="4H STDV" base="7" active={form.fourHSTDVOn} onActive={(v) => set("fourHSTDVOn", v)}>
              <StartControl k="fourHSTDV" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("fourHSTDV")} />
              <Select label="STDV" value={form.fourHSTDVValue} options={stdvChoices} onChange={(v) => set("fourHSTDVValue", v)} />
              <Away k="fourHSTDV" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="15m Retracement" base="5" active={form.retrace15mOn} onActive={(v) => set("retrace15mOn", v)}>
              <StartControl k="retrace15m" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("retrace15m")} />
              <Select label="Retracement" value={form.retrace15mValue} options={retraceChoices} onChange={(v) => set("retrace15mValue", v)} />
              <Away k="retrace15m" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="1H Retracement" base="6" active={form.retrace1HOn} onActive={(v) => set("retrace1HOn", v)}>
              <StartControl k="retrace1H" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("retrace1H")} />
              <Select label="Retracement" value={form.retrace1HValue} options={retraceChoices} onChange={(v) => set("retrace1HValue", v)} />
              <Away k="retrace1H" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="4H Retracement" base="7" active={form.retrace4HOn} onActive={(v) => set("retrace4HOn", v)}>
              <StartControl k="retrace4H" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("retrace4H")} />
              <Select label="Retracement" value={form.retrace4HValue} options={retraceChoices} onChange={(v) => set("retrace4HValue", v)} />
              <Away k="retrace4H" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="Order Block" base="5" active={form.orderBlockOn} onActive={(v) => set("orderBlockOn", v)}>
              <Select label="Highest Timeframe" value={form.orderBlockTF} options={tfChoices} onChange={(v) => set("orderBlockTF", v)} />
              <Select label="Fresh or Prev Tapped" value={form.orderBlockState} options={["Fresh", "Prev Tapped"]} onChange={(v) => set("orderBlockState", v)} />
              <Field label="Points Away From Starting Level" value={form.orderBlockAway} onChange={(v) => set("orderBlockAway", v)} />
            </Conf>

            <Conf title="Rejection Block" base="5" active={form.rejectionBlockOn} onActive={(v) => set("rejectionBlockOn", v)}>
              <Select label="Highest Timeframe" value={form.rejectionBlockTF} options={tfChoices} onChange={(v) => set("rejectionBlockTF", v)} />
              <Select label="Fresh or Prev Tapped" value={form.rejectionBlockState} options={["Fresh", "Prev Tapped"]} onChange={(v) => set("rejectionBlockState", v)} />
              <Field label="Points Away From Starting Level" value={form.rejectionBlockAway} onChange={(v) => set("rejectionBlockAway", v)} />
            </Conf>

            <Conf title="FVG" base="5" active={form.fvgOn} onActive={(v) => set("fvgOn", v)}>
              <Select label="Highest Timeframe" value={form.fvgTF} options={tfChoices} onChange={(v) => set("fvgTF", v)} />
              <Select label="Fresh or Prev Tapped" value={form.fvgState} options={["Fresh", "Prev Tapped"]} onChange={(v) => set("fvgState", v)} />
              <Field label="Points Away From Starting Level" value={form.fvgAway} onChange={(v) => set("fvgAway", v)} />
            </Conf>

            <Conf title="Prev High or Low" base="4" active={form.prevHighLowOn} onActive={(v) => set("prevHighLowOn", v)} sub="More taps means less value">
              <Field label="Points Away From Starting Level" value={form.prevHighLowAway} onChange={(v) => set("prevHighLowAway", v)} />
              <Field label="Times Tapped on 15m" value={form.prevHighLowTaps} onChange={(v) => set("prevHighLowTaps", v)} />
            </Conf>

            <Conf title="LTF Vol Node" base="7" active={form.ltfVolNodeOn} onActive={(v) => set("ltfVolNodeOn", v)}>
              <Field label="Points Away From Starting Level" value={form.ltfVolNodeAway} onChange={(v) => set("ltfVolNodeAway", v)} />
            </Conf>

            <Conf title="Liquidity" base="8" active={form.liquidityOn} onActive={(v) => set("liquidityOn", v)} sub="Yes / No only" />
          </div>
        )}

        {tab === "settings" && (
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <Card>
              <Title>AI Auto Setup Settings</Title>
              <p className="mt-2 text-zinc-400">These inputs are for the AI auto setup engine only. They do not replace the manual checklist fields.</p>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label="Volume Crater Top Price" value={aiSettings.volumeCraterTop} onChange={(v) => setAiSettings((s) => ({ ...s, volumeCraterTop: v }))} />
                <Field label="Volume Crater Bottom Price" value={aiSettings.volumeCraterBottom} onChange={(v) => setAiSettings((s) => ({ ...s, volumeCraterBottom: v }))} />
                <Field label="Weekly Level Price" value={aiSettings.weeklyLevelPrice} onChange={(v) => setAiSettings((s) => ({ ...s, weeklyLevelPrice: v }))} />
                <Select label="Use Indicator Auto Signals" value={aiSettings.autoUseIndicator} options={["Yes", "No"]} onChange={(v) => setAiSettings((s) => ({ ...s, autoUseIndicator: v }))} />
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <Small label="Crater Size" value={aiCraterSize ? fmt(aiCraterSize) : "--"} />
                <Small label="Crater Mid Away" value={aiCraterAway ? fmt(aiCraterAway) : "--"} />
                <Small label="Weekly Away" value={aiWeeklyAway ? fmt(aiWeeklyAway) : "--"} />
              </div>
            </Card>

            <Card>
              <Title>AI Setup Checklist Chart</Title>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-zinc-400">
                    <tr><th className="p-3">Needed</th><th>Current Value</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {aiChecklist.map((row) => (
                      <tr key={row.item} className="border-t border-zinc-800">
                        <td className="p-3"><b>{row.item}</b><div className="text-xs text-zinc-500">{row.needed}</div></td>
                        <td>{row.value || "--"}</td>
                        <td className={row.value ? "font-black text-[#00d27a]" : "font-black text-[#ffcc19]"}>{row.value ? "Ready" : "Needed"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {tab === "behavior" && <Behavior behavior={behavior} journal={journal} />}
        {tab === "breakdown" && <Breakdown report={report} recommendations={recommendations} tips={tips} />}
        {tab === "journal" && <Journal journal={journal} saveTrade={saveTrade} editTrade={editTrade} form={form} set={set} editingId={editingId} handleImageUpload={handleImageUpload} />}
      </div>
    </div>
    </WhopGate>
  );
}

function Dash({ label, value }) {
  return <div className="rounded-2xl border border-[#2c2300] bg-black p-6 shadow-lg shadow-black/30"><div className="text-lg text-zinc-200">{label}</div><div className="mt-2 text-4xl font-black text-[#ffcc19]">{value}</div></div>;
}

function Tab({ id, tab, setTab, children }) {
  return <button onClick={() => setTab(id)} className={`rounded-xl px-4 py-3 font-bold ${tab === id ? "bg-white text-black" : "text-zinc-500 hover:text-white"}`}>{children}</button>;
}

function Card({ children, className = "" }) {
  return <div className={`rounded-3xl border border-[#2c2300] bg-black p-6 shadow-xl shadow-black/30 ${className}`}>{children}</div>;
}

function Title({ children }) {
  return <h2 className="text-2xl font-black">{children}</h2>;
}

function Field({ label, value, onChange, disabled }) {
  return <label className="block"><span className="mb-2 block text-sm text-zinc-300">{label}</span><input disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-[#0b0b0b] px-4 py-3 text-white outline-none focus:border-[#ffcc19] disabled:opacity-40" /></label>;
}

function Select({ label, value, options, onChange }) {
  return <label className="block"><span className="mb-2 block text-sm text-zinc-300">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-[#0b0b0b] px-4 py-3 text-white outline-none focus:border-[#ffcc19]">{options.map((o) => <option key={o}>{o}</option>)}</select></label>;
}

function StartControl({ k, startingLevel, setStart, disabled }) {
  const active = startingLevel === k;
  return <button disabled={disabled} onClick={() => setStart(k)} className={`rounded-xl border px-4 py-3 text-left font-bold ${active ? "border-[#ffcc19] bg-[#ffcc19] text-black" : "border-zinc-700 bg-[#0b0b0b] text-zinc-300 disabled:opacity-30"}`}>{active ? "Starting Level ✓" : "Set As Starting Level"}</button>;
}

function Away({ k, form, set, startingLevel }) {
  const key = `${k}Away`;
  return <Field label="Points Away From Starting Level" value={startingLevel === k ? "0" : form[key]} disabled={startingLevel === k} onChange={(v) => set(key, v)} />;
}

function ToggleMini({ value, onChange }) {
  return <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-700 bg-[#0b0b0b] p-1"><button onClick={() => onChange("Yes")} className={`rounded-lg py-2 font-black ${value === "Yes" ? "bg-[#ffcc19] text-black" : "text-zinc-400"}`}>Yes</button><button onClick={() => onChange("No")} className={`rounded-lg py-2 font-black ${value === "No" ? "bg-[#ffcc19] text-black" : "text-zinc-400"}`}>No</button></div>;
}

function Conf({ title, base, active, onActive, sub, children }) {
  return <Card><div className="mb-4 flex items-start justify-between gap-4"><div className="flex items-start gap-3"><div className={`mt-1 flex h-8 w-8 items-center justify-center rounded-lg border ${active === "Yes" ? "border-[#ffcc19] bg-[#ffcc19] text-black" : "border-zinc-700 text-transparent"}`}>✓</div><div><h3 className="text-2xl font-black">{title}</h3>{sub && <p className="mt-1 text-zinc-300">{sub}</p>}</div></div><div className="rounded-full border border-[#ffcc19] px-4 py-2 text-sm font-bold text-[#ffcc19]">Base {base}</div></div><ToggleMini value={active} onChange={onActive} /><div className="mt-5 grid gap-4 md:grid-cols-2">{children}</div></Card>;
}

function Rec({ r }) {
  return <div className="rounded-2xl border border-zinc-800 bg-[#090909] p-4"><div className="flex items-center justify-between"><div className="text-lg font-black text-[#ffcc19]">{r.stop}pt Stop</div><div className="rounded-full bg-[#00d27a] px-3 py-1 text-xs font-black text-black">{r.confidence}</div></div><div className="mt-3 grid grid-cols-2 gap-3"><Small label="Limit" value={fmt(r.limit)} /><Small label="Stop" value={fmt(r.stopArea)} /></div><p className="mt-3 text-sm text-zinc-400">Based on: {r.match}</p>{r.note && <p className="mt-1 text-xs text-zinc-500">{r.note}</p>}</div>;
}

function Small({ label, value }) {
  return <div className="rounded-xl border border-zinc-800 bg-black p-3"><div className="text-xs text-zinc-500">{label}</div><div className="font-black">{value}</div></div>;
}

function Breakdown({ report, recommendations, tips }) {
  return <div className="mt-6 grid gap-5 lg:grid-cols-2"><Card><Title>Adjusted Recommendations</Title><div className="mt-4 space-y-3">{recommendations.map((r) => <Rec key={r.stop} r={r} />)}</div></Card><Card><Title>Tips</Title><div className="mt-4 space-y-3">{tips.map((t, i) => <div key={i} className="rounded-xl border border-[#2c2300] bg-[#0b0b0b] p-4 text-zinc-200">{t}</div>)}</div></Card><Card className="lg:col-span-2"><Title>Score Breakdown</Title><div className="mt-4 grid gap-3 md:grid-cols-4"><Small label="Zone Score" value={`${report.zoneScore}/100`} /><Small label="Precision Grade Score" value={`${report.score}/100`} /><Small label="Top 3 Within 5" value={`${report.topWithin5}/3`} /><Small label="Far Levels 8+" value={report.farCount} /></div><div className="mt-4 rounded-xl border border-[#2c2300] bg-[#0b0b0b] p-4 text-sm text-zinc-300">Raw points still count the reaction zone. The grade is capped by entry precision: top-weighted confluences need to align within 3–5 points for A/A+.</div><div className="mt-4 grid gap-3 md:grid-cols-2">{report.rows.map((r) => <div key={r.key} className="rounded-xl border border-zinc-800 bg-[#090909] p-4"><div className="flex justify-between"><b>{r.name}</b><b className="text-[#ffcc19]">{r.score.toFixed(1)}</b></div><div className="mt-1 text-sm text-zinc-500">Base {r.base} • Away {r.pointsAway} • {r.note}</div></div>)}</div></Card></div>;
}

function Journal({ journal, saveTrade, editTrade, form, set, editingId, handleImageUpload }) {
  return <div className="mt-6 grid gap-5 lg:grid-cols-[420px_1fr]"><Card><Title>{editingId ? "Edit Report" : "Report Result"}</Title><div className="mt-5 grid gap-4"><Select label="Result" value={form.result} options={["Win", "Loss", "BE", "Unfilled"]} onChange={(v) => set("result", v)} /><Field label="Max Move" value={form.maxMove} onChange={(v) => set("maxMove", v)} /><Field label="Max Drawdown" value={form.maxDrawdown} onChange={(v) => set("maxDrawdown", v)} /><Field label="Profit / Loss $" value={form.profitLoss} onChange={(v) => set("profitLoss", v)} /><label><span className="mb-2 block text-sm text-zinc-300">Notes</span><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className="h-28 w-full rounded-lg border border-zinc-700 bg-[#0b0b0b] p-4 text-white outline-none focus:border-[#ffcc19]" /></label><label><span className="mb-2 block text-sm text-zinc-300">Trade Pictures / Screenshots</span><input type="file" multiple accept="image/*" onChange={handleImageUpload} className="w-full rounded-lg border border-zinc-700 bg-[#0b0b0b] px-4 py-3 text-white" /></label>{form.tradeImages?.length > 0 && <div className="grid grid-cols-2 gap-3">{form.tradeImages.map((img, i) => <img key={i} src={img} alt="trade" className="h-32 w-full rounded-xl object-cover border border-zinc-800" />)}</div>}<button onClick={saveTrade} className="rounded-xl bg-[#ffcc19] py-3 font-black text-black">{editingId ? "Update Report" : "Save To Journal"}</button></div></Card><Card><Title>Journal</Title><div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-zinc-400"><tr><th className="p-3">Date</th><th>Dir</th><th>Grade</th><th>Result</th><th>Top Confluence</th><th>P/L</th><th></th></tr></thead><tbody>{journal.map((j) => <React.Fragment key={j.id}><tr className="border-t border-zinc-800"><td className="p-3">{j.date}</td><td>{j.direction}</td><td>{j.grade} {j.score}</td><td>{j.result}</td><td>{j.top}</td><td>{j.profitLoss}</td><td><button onClick={() => editTrade(j)} className="text-[#ffcc19] font-bold">Edit</button></td></tr><tr><td colSpan="7" className="px-3 pb-5">{j.notes && <div className="mb-3 text-zinc-400">{j.notes}</div>}{j.tradeImages?.length > 0 && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{j.tradeImages.map((img, idx) => <img key={idx} src={img} alt="journal" className="h-32 w-full rounded-xl object-cover border border-zinc-800" />)}</div>}</td></tr></React.Fragment>)}</tbody></table>{journal.length === 0 && <div className="p-6 text-zinc-500">No saved trades yet.</div>}</div></Card></div>;
}

function Behavior({ behavior, journal }) {
  return <div className="mt-6 grid gap-5 lg:grid-cols-2"><Card><Title>Behavior Rating</Title><div className="mt-6 text-7xl font-black text-[#00d27a]">{behavior.score}/10</div><p className="mt-3 text-zinc-300">Based on saved results and notes. Notes mentioning chasing/late reduce behavior score. Notes mentioning patience/followed plan improve it.</p><div className="mt-5 grid grid-cols-4 gap-3"><Small label="Trades" value={behavior.total} /><Small label="Wins" value={behavior.wins} /><Small label="Losses" value={behavior.losses} /><Small label="BE" value={behavior.be} /></div></Card><Card><Title>Behavior Notes</Title><div className="mt-4 space-y-3">{journal.slice(0,5).map((j) => <div key={j.id} className="rounded-xl border border-zinc-800 bg-[#090909] p-4"><b>{j.result}</b><p className="mt-1 text-zinc-400">{j.notes || "No notes"}</p></div>)}{journal.length === 0 && <div className="text-zinc-500">Save journal results to populate behavior reports.</div>}</div></Card></div>;
}
