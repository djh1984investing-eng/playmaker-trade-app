import React, { useMemo, useState, useEffect, useRef } from "react";
import WhopGate from "./components/WhopGate";
import { supabase } from "./lib/supabaseClient";
import { trackBuyAccessClick, trackHomeClick, trackTrialAccessClick } from "./lib/googleTracking";
import {
  arrayFromMaybe,
  buildStopPlansForCluster,
  clamp,
  clusterPrecisionFromWidth,
  clusterStatusFromWidth,
  craterQualityScore,
  deviationAbsFromLabel,
  deviationEvidenceScore,
  dirSide,
  findBestEntryStack,
  firstDefined,
  fmt,
  fmtPrice,
  getLevelKey,
  getNestedLevelValue,
  getSignalPayload,
  grade,
  isGenericPriceAlertSignal,
  isYes,
  levelMergeTolerance,
  maxConfluenceDistancePoints,
  maxOrderCardDistancePoints,
  n,
  normalizeRetrace,
  normalizeSTDV,
  normalizeStatus,
  objectFromMaybeJson,
  parsePrice,
  parseYesNo,
  roundToTick,
  scoreDistance,
  structureEvidenceScore,
  timeframeFromPayload,
  uniqueEvidenceByPriceAndLabel,
  uniqueSortedPrices
} from "./lib/playmakerConfluence";
const GREEN = "#00d27a";
const GOLD = "#ffcc19";
const WHOP_CHECKOUT_URL = "https://whop.com/checkout/plan_wQepCbh0j806f";
const WHOP_TRIAL_CHECKOUT_URL = "https://whop.com/checkout/4cKnCvNHDSfSKF5YXv-OGdW-3d0o-JTbf-hvFSSmUpwW1R/";
const OWNER_EMAILS = ["djh1984investing@gmail.com", "djharrison", "durrell", "djh1984investing-eng"];
const isOwnerUser = (user) => {
  const text = String(user?.email || user?.id || "").toLowerCase();
  return OWNER_EMAILS.some((owner) => text.includes(String(owner).toLowerCase()));
};

const navTabs = [
  { id: "trade", label: "Trade Info" },
  { id: "procedure", label: "Procedure" },
  { id: "checklist", label: "Setup Checklist" },
  { id: "settings", label: "AI Settings", ownerOnly: true },
  { id: "behavior", label: "Behavior" },
  { id: "breakdown", label: "Score Breakdown" },
  { id: "journal", label: "Journal" }
];

const socialLinks = [
  { label: "YouTube", href: "https://www.youtube.com/@TRADESWITHYOU" },
  { label: "Facebook Group", href: "https://www.facebook.com/profile.php?id=61591225798882" },
  { label: "Facebook Page", href: "https://www.facebook.com/profile.php?id=61578057606369" },
  { label: "TikTok", href: "https://www.tiktok.com/@mr.djharrison" },
  { label: "Discord", href: "https://discord.com/channels/796158482431737906" }
];

const YOUTUBE_DEMO_URL = "https://www.youtube.com/watch?v=cBOf7gRdkXQ&t=548s";

const policyContent = {
  privacy: {
    title: "Privacy Policy",
    body: [
      "Playmaker collects account information such as your login email so you can access the app.",
      "Payment and subscription access may be handled by Whop. Playmaker does not store your full payment card details.",
      "The app may store trade journal entries, setup notes, screenshots, preferences, and access status so the product can work for your account.",
      "Playmaker may use service providers such as Supabase, Whop, Vercel, Google, or similar tools to host the app, manage access, measure traffic, and improve the service.",
      "Do not upload sensitive personal information that is not needed for your trading review workflow.",
      "For privacy questions or account help, contact support."
    ]
  },
  terms: {
    title: "Terms of Use",
    body: [
      "By using Playmaker, you agree to use the app only for lawful personal or business trading workflow review.",
      "You are responsible for keeping your login private and for all activity under your account.",
      "Access may depend on an active purchase or subscription through the listed checkout provider.",
      "Playmaker may change, suspend, or discontinue features as the product improves.",
      "You may not copy, resell, attack, scrape, or misuse the app or its private systems.",
      "These starter terms are provided for product clarity and should be reviewed by a qualified professional before heavy paid promotion."
    ]
  },
  risk: {
    title: "Trading Risk Disclaimer",
    body: [
      "Trading futures, stocks, options, crypto, and other markets involves substantial risk and is not suitable for every person.",
      "Playmaker is a workflow, checklist, journal, and setup review tool. It does not provide personalized investment, legal, tax, or financial advice.",
      "Playmaker does not guarantee profits, winning trades, accurate predictions, or any specific trading result.",
      "You are responsible for your own trade decisions, risk controls, position sizing, and compliance with any rules that apply to you.",
      "Past performance, examples, demos, screenshots, or educational content do not guarantee future results."
    ]
  },
  contact: {
    title: "Contact & Support",
    body: [
      "For help with Playmaker access, login, billing access, or product questions, contact support through the listed social channels or the purchase platform used for access.",
      "Include the email address you used to purchase or register so support can look up your account faster.",
      "For urgent billing or subscription issues, also check your Whop account or checkout receipt."
    ]
  }
};


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

const stdvChoices = ["0", "0.5", "0.705", "1", "1.5", "2", "2.25", "2.5", "3", "3.5", "4", "4.5", "5", "5.5", "6", "-0.5", "-0.705", "-1", "-1.5", "-2", "-2.25", "-2.5", "-3", "-3.5", "-4", "-4.5", "-5", "-5.5", "-6"];
const retraceChoices = ["None", "0.50", "0.618", "0.705", "0.786"];
const tfChoices = ["5m", "15m", "1H", "4H"];

const formatEastern = (value) => {
  if (!value) return "--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short"
  });
};

const isOpenOrder = (item) => {
  const result = normalizeStatus(item?.result);
  const orderStatus = normalizeStatus(item?.orderStatus);

  if (["win", "loss", "be", "filled", "reported", "closed", "cancelled", "canceled"].includes(result)) {
    return false;
  }

  if (["filled", "reported", "closed", "cancelled", "canceled"].includes(orderStatus)) {
    return false;
  }

  return result === "unfilled" || result === "edge" || orderStatus === "unfilled" || item?.pendingOrder === true;
};

const isCompletedTradeResult = (item) => {
  return ["win", "loss", "be"].includes(normalizeStatus(item?.result));
};

const journalNumberOrNull = (value) => {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

const averageJournalNumber = (items, key) => {
  const values = items
    .map((item) => journalNumberOrNull(item?.[key]))
    .filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
};

const sumJournalNumber = (items, key) => {
  return items.reduce((sum, item) => sum + (journalNumberOrNull(item?.[key]) ?? 0), 0);
};

const journalNetPoints = (item) => {
  const result = normalizeStatus(item?.result);
  const maxMove = journalNumberOrNull(item?.maxMove) ?? 0;
  const maxDrawdown = Math.abs(journalNumberOrNull(item?.maxDrawdown) ?? 0);

  if (result === "win") return maxMove;
  if (result === "loss") return -maxDrawdown;
  return 0;
};

const sumJournalNetPoints = (items) => {
  return items.reduce((sum, item) => sum + journalNetPoints(item), 0);
};

const journalDateMs = (item) => {
  const raw = item?.createdAt || item?.created_at || item?.date;
  const parsed = new Date(raw).getTime();
  if (Number.isFinite(parsed)) return parsed;

  const match = String(raw || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, month, day, year] = match;
  const fallback = new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  return Number.isFinite(fallback) ? fallback : null;
};

const journalStatsDateMs = (item) => {
  const raw = item?.statsUpdatedAt || item?.verification?.statsUpdatedAt || item?.updatedAt || item?.updated_at;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : journalDateMs(item);
};

const journalReportDateMs = (item) => {
  return journalStatsDateMs(item);
};

const easternDateParts = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  };
};

const journalDayKey = (value) => {
  const parts = easternDateParts(value);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const formatJournalDay = (value) => {
  const parts = easternDateParts(value);
  if (!parts) return "Today";
  const date = new Date(parts.year, parts.month - 1, parts.day);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const formatSignedPoints = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "+0.00";
  return `${parsed >= 0 ? "+" : ""}${fmt(parsed)}`;
};

const journalFilterRange = (filter = {}) => {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  endOfToday.setMilliseconds(endOfToday.getMilliseconds() - 1);

  const preset = filter.preset || "all";
  let start = null;
  let end = null;

  if (preset === "today") {
    start = new Date(startOfToday);
    end = new Date(endOfToday);
  } else if (preset === "yesterday") {
    start = new Date(startOfToday);
    start.setDate(start.getDate() - 1);
    end = new Date(startOfToday);
    end.setMilliseconds(end.getMilliseconds() - 1);
  } else if (preset === "last7") {
    start = new Date(startOfToday);
    start.setDate(start.getDate() - 6);
    end = new Date(endOfToday);
  } else if (preset === "last30") {
    start = new Date(startOfToday);
    start.setDate(start.getDate() - 29);
    end = new Date(endOfToday);
  } else if (preset === "custom") {
    if (filter.startDate) {
      start = new Date(`${filter.startDate}T00:00:00`);
    }
    if (filter.endDate) {
      end = new Date(`${filter.endDate}T23:59:59.999`);
    }
  }

  return {
    start: start && Number.isFinite(start.getTime()) ? start.getTime() : null,
    end: end && Number.isFinite(end.getTime()) ? end.getTime() : null
  };
};

const filterJournalByDate = (items = [], filter = {}) => {
  const { start, end } = journalFilterRange(filter);
  if (start === null && end === null) return items;

  return items.filter((item) => {
    const tradeMs = journalReportDateMs(item);
    if (tradeMs === null) return false;
    if (start !== null && tradeMs < start) return false;
    if (end !== null && tradeMs > end) return false;
    return true;
  });
};

const journalFilterLabel = (filter = {}) => {
  const preset = filter.preset || "all";
  if (preset === "today") return "Today";
  if (preset === "yesterday") return "Yesterday";
  if (preset === "last7") return "Last 7 days";
  if (preset === "last30") return "Last 30 days";
  if (preset === "custom") {
    const start = filter.startDate || "Start";
    const end = filter.endDate || "End";
    return `${start} to ${end}`;
  }
  return "All dates";
};

const journalScopeOf = (item) => {
  return String(item?.journalScope || item?.verification?.journalScope || item?.verification?.scope || "").toLowerCase();
};

const GLOBAL_JOURNAL_CACHE_KEY = "playmaker-global-journal-results-v1";

const calculateJournalStats = (items = []) => {
  const closed = items.filter((j) => isCompletedTradeResult(j));
  const wins = closed.filter((j) => normalizeStatus(j.result) === "win").length;
  const losses = closed.filter((j) => normalizeStatus(j.result) === "loss").length;
  const be = closed.filter((j) => normalizeStatus(j.result) === "be").length;
  const unfilled = items.filter((j) => isOpenOrder(j)).length;
  const totalPL = closed.reduce((sum, j) => sum + (journalNumberOrNull(j.profitLoss) ?? 0), 0);
  const totalPoints = sumJournalNetPoints(closed);
  const avgPL = averageJournalNumber(closed, "profitLoss");
  const avgMove = averageJournalNumber(closed, "maxMove");
  const avgDrawdown = averageJournalNumber(closed, "maxDrawdown");
  const avgDiscount = averageJournalNumber(closed, "discountPoints");
  const winRate = closed.length ? Math.round((wins / closed.length) * 100) : 0;
  const todayParts = easternDateParts(new Date());
  const today = todayParts ? new Date(todayParts.year, todayParts.month - 1, todayParts.day, 12) : new Date();
  const rollingDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    return {
      key: journalDayKey(date),
      label: formatJournalDay(date),
      points: 0,
      wins: 0,
      losses: 0,
      be: 0,
      trades: 0
    };
  });
  const dayMap = new Map(rollingDays.map((day) => [day.key, day]));
  const rollingClosed = closed.filter((j) => {
    const tradeMs = journalStatsDateMs(j);
    if (tradeMs === null) return false;
    return dayMap.has(journalDayKey(new Date(tradeMs)));
  });
  const rollingWins = rollingClosed.filter((j) => normalizeStatus(j.result) === "win").length;
  const rollingLosses = rollingClosed.filter((j) => normalizeStatus(j.result) === "loss").length;
  const rollingBe = rollingClosed.filter((j) => normalizeStatus(j.result) === "be").length;
  const rollingWinRate = rollingClosed.length ? Math.round((rollingWins / rollingClosed.length) * 100) : 0;
  const rollingPoints = sumJournalNetPoints(rollingClosed);
  rollingClosed.forEach((trade) => {
    const tradeMs = journalStatsDateMs(trade);
    if (tradeMs === null) return;
    const day = dayMap.get(journalDayKey(new Date(tradeMs)));
    if (!day) return;
    const result = normalizeStatus(trade.result);
    day.points += journalNetPoints(trade);
    day.trades += 1;
    if (result === "win") day.wins += 1;
    if (result === "loss") day.losses += 1;
    if (result === "be") day.be += 1;
  });
  return {
    total: items.length,
    closed: closed.length,
    wins,
    losses,
    be,
    unfilled,
    winRate,
    totalPL,
    totalPoints,
    avgPL,
    avgMove,
    avgDrawdown,
    avgDiscount,
    rolling7: {
      trades: rollingClosed.length,
      wins: rollingWins,
      losses: rollingLosses,
      be: rollingBe,
      winRate: rollingWinRate,
      points: rollingPoints,
      days: rollingDays,
      rangeLabel: `${rollingDays[0]?.label || ""} - ${rollingDays[6]?.label || ""}`,
      today: rollingDays[6]
    }
  };
};

const isManualOrder = (item) => {
  const sourceType = String(item?.sourceType || item?.source_type || item?.rawSignal?.sourceType || item?.payload?.sourceType || "").toLowerCase();
  const signalName = String(item?.signalName || item?.rawSignal?.signal || item?.payload?.signal || "").toLowerCase();
  const eventText = String(item?.event || item?.title || item?.detail || item?.notes || "").toLowerCase();
  const isAiSignal = sourceType === "ai signal" || sourceType.includes("persistent level") || signalName.includes("stacked cluster");
  return !isAiSignal && (sourceType.includes("manual") || signalName.includes("manual") || eventText.includes("manual order") || eventText.includes("manual scan"));
};

const hasOnlyManualPillars = (anchor = {}) => {
  const evidence = Array.isArray(anchor?.evidence)
    ? anchor.evidence
    : Array.isArray(anchor?.rawSignal?.evidence)
      ? anchor.rawSignal.evidence
      : Array.isArray(anchor?.payload?.evidence)
        ? anchor.payload.evidence
        : [];
  const manualSourceTypes = new Set(["weekly level", "volume crater / lvn"]);
  return Boolean(anchor?.hasOnlyManualPillars) || (evidence.length > 0 && evidence.every((item) => manualSourceTypes.has(String(item?.sourceType || "").toLowerCase())));
};

const isDiscordEligibleSignal = (anchor = null) => {
  if (!anchor || isManualOrder(anchor) || hasOnlyManualPillars(anchor)) return false;
  const sourceType = String(anchor?.sourceType || anchor?.source_type || anchor?.rawSignal?.sourceType || anchor?.payload?.sourceType || "").toLowerCase();
  const signalName = String(anchor?.signalName || anchor?.rawSignal?.signal || anchor?.payload?.signal || "").toLowerCase();
  return sourceType === "ai signal" || sourceType.includes("persistent level") || signalName.includes("stacked cluster");
};

const loadStoredNoticeKeys = () => {
  try {
    if (typeof window === "undefined") return {};
    const saved = JSON.parse(window.localStorage.getItem("playmakerNoticeKeys") || "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return saved;
  } catch (_err) {
    return {};
  }
};

const saveStoredNoticeKeys = (keys) => {
  try {
    if (typeof window === "undefined") return;
    const entries = Object.entries(keys || {}).slice(-300);
    window.localStorage.setItem("playmakerNoticeKeys", JSON.stringify(Object.fromEntries(entries)));
  } catch (_err) {}
};

const discordNoticeKey = ({ event = "UPDATE", title = "", detail = "", anchor = null } = {}) => {
  const price = parsePrice(anchor?.entry || anchor?.price || anchor?.rawSignal?.entry || anchor?.rawSignal?.price);
  const direction = String(anchor?.direction || anchor?.rawSignal?.direction || "BOTH").toUpperCase();
  const grade = String(anchor?.grade || anchor?.rawSignal?.ai_grade || "");
  const sources = String(anchor?.sourceCount || anchor?.evidence?.length || anchor?.rawSignal?.evidence?.length || "");
  const signature = String(anchor?.signature || anchor?.evidenceSignature || anchor?.rawSignal?.id || anchor?.id || "").slice(0, 80);
  const detailSignature = ["VERIFIED", "NOTE_UPDATED"].includes(String(event).toUpperCase()) ? String(detail || "").slice(0, 160) : "";
  const normalizedPrice = price === null ? "NA" : String(Math.round(price * 4) / 4);
  return [event, direction, normalizedPrice, grade, sources, signature, detailSignature].map((part) => String(part || "").trim()).join("|");
};

const sameTradeAnchor = (a, b) => {
  if (!a || !b) return false;

  const aId = String(a.id ?? "");
  const bId = String(b.id ?? "");
  if (aId && bId && aId === bId) return true;

  const aSignal = String(a.signal_id ?? a.ai_signal_id ?? "");
  const bSignal = String(b.signal_id ?? b.ai_signal_id ?? "");
  if (aSignal && bSignal && aSignal === bSignal) return true;

  const aEntry = String(a.entry ?? a.entry_price ?? "").replace(/,/g, "");
  const bEntry = String(b.entry ?? b.entry_price ?? "").replace(/,/g, "");
  const sameEntry = aEntry && bEntry && Number(aEntry) === Number(bEntry);

  const sameDirection = String(a.direction ?? "").toLowerCase() === String(b.direction ?? "").toLowerCase();

  return sameEntry && sameDirection && (isOpenOrder(a) || isOpenOrder(b));
};


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

const getDefaultForm = () => ({
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
    discountPoints: "",
    maxDiscountPoints: "",
    notes: "",
    tradeImages: []
  });

export default function PlaymakerSetupGrader() {
  const [tab, setTab] = useState("checklist");
  const [journal, setJournal] = useState([]);
  const [journalFilter, setJournalFilter] = useState({
    preset: "all",
    startDate: "",
    endDate: ""
  });
  const [globalJournal, setGlobalJournal] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const cached = window.localStorage.getItem(GLOBAL_JOURNAL_CACHE_KEY);
      const parsed = cached ? JSON.parse(cached) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [user, setUser] = useState(null);
const [authEmail, setAuthEmail] = useState("");
const [authPassword, setAuthPassword] = useState("");
const [authMessage, setAuthMessage] = useState("");
const [policyView, setPolicyView] = useState(null);
const signUp = async () => {
  const { error } = await supabase.auth.signUp({
    email: authEmail,
    password: authPassword
  });

  setAuthMessage(
    error ? error.message : "Check your email to confirm account."
  );
};

const signIn = async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password: authPassword
  });

  setAuthMessage(
    error ? error.message : "Logged in."
  );
};

const signOut = async () => {
  await supabase.auth.signOut();
};

useEffect(() => {
  supabase.auth.getSession().then(({ data }) => {
    setUser(data.session?.user || null);
  });

  const {
    data: { subscription }
  } = supabase.auth.onAuthStateChange(
    (_event, session) => {
      setUser(session?.user || null);
    }
  );

  return () => subscription?.unsubscribe();
}, []);

useEffect(() => {
  let cancelled = false;

  const commitGlobalJournalRows = (rows) => {
    if (cancelled) return;
    setGlobalJournal(rows);
    try {
      window.localStorage.setItem(GLOBAL_JOURNAL_CACHE_KEY, JSON.stringify(rows));
    } catch {
      // If browser storage is unavailable, the live fetch still keeps the screen updated.
    }
  };

  const fetchGlobalJournal = async () => {
    try {
      const response = await fetch("/api/journal-stats?limit=1000", { cache: "no-store" });
      if (response.ok) {
        const payload = await response.json();
        if (Array.isArray(payload?.rows)) {
          commitGlobalJournalRows(payload.rows);
          return;
        }
      }
    } catch (error) {
      console.warn("Global journal stats API unavailable, using direct Supabase fallback:", error);
    }

    const { data, error } = await supabase
      .from("trade_journal")
      .select("id,created_at,result,max_move,max_drawdown,profit_loss,verification,notes,signal_id,confluences")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) {
      console.error("Global journal stats fetch error:", error);
      return;
    }

    const globalRows = (data || []).filter((row) => {
      const scope = String(row.verification?.journalScope || row.verification?.scope || "").toLowerCase();
      const notes = String(row.notes || "").toLowerCase();
      const completed = isCompletedTradeResult({ result: row.result });
      const legacyGlobal = !scope && !notes.includes("local journal");
      return completed && scope !== "local" && (scope === "global" || legacyGlobal);
    });

    const mappedRows = globalRows.map((row) => ({
      id: row.id || "",
      createdAt: row.created_at || null,
      statsUpdatedAt: row.verification?.statsUpdatedAt || row.updated_at || row.created_at || null,
      result: row.result || "",
      maxMove: row.max_move ?? "",
      maxDrawdown: row.max_drawdown ?? "",
      profitLoss: row.profit_loss ?? "",
      verification: row.verification || null,
      journalScope: row.verification?.journalScope || ""
    }));

    commitGlobalJournalRows(mappedRows);
  };

  fetchGlobalJournal();

  return () => {
    cancelled = true;
  };
}, [user?.id]);
  const [aiSignals, setAiSignals] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiFetchMessage, setAiFetchMessage] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [startingLevel, setStartingLevel] = useState("playMakerSignal");
  const [aiSettings, setAiSettings] = useState({
    volumeCraterTop: "",
    volumeCraterBottom: "",
    weeklyLevelPrice: "",
    weeklyLevelName: "",
    craterBoxName: "",
    autoUseIndicator: "Yes"
  });
  const [aiLevels, setAiLevels] = useState([]);
  const [editingWeeklyLevelId, setEditingWeeklyLevelId] = useState(null);
  const [editingCraterBoxId, setEditingCraterBoxId] = useState(null);
  const [aiLevelMessage, setAiLevelMessage] = useState("");
  const [form, setForm] = useState(getDefaultForm());
  const [manualScanner, setManualScanner] = useState({
    price: "",
    direction: "Long",
    bias4H: "Bullish",
    bias1H: "Bullish"
  });
  const [manualScannerResult, setManualScannerResult] = useState(null);
  const [verifiedAnchors, setVerifiedAnchors] = useState({});
  const [notificationLog, setNotificationLog] = useState([]);
  const [seenNotificationKeys, setSeenNotificationKeys] = useState(() => loadStoredNoticeKeys());
  const [submittedAnchorKeys, setSubmittedAnchorKeys] = useState({});
  const [filledAnchorKeys, setFilledAnchorKeys] = useState({});
  const [pulledAnchorKeys, setPulledAnchorKeys] = useState({});
  const [ownerSignalNotes, setOwnerSignalNotes] = useState({});

  const previousAnchorMapRef = useRef(null);
  const pendingRemovedAnchorMapRef = useRef(new Map());
  const sentDiscordNoticeKeysRef = useRef(new Set(Object.keys(seenNotificationKeys)));
  const suppressDiscordUntilRef = useRef(0);
  const notificationAudioRef = useRef(null);

  useEffect(() => {
    sentDiscordNoticeKeysRef.current = new Set([
      ...Array.from(sentDiscordNoticeKeysRef.current || []),
      ...Object.keys(seenNotificationKeys || {})
    ]);
    saveStoredNoticeKeys(seenNotificationKeys);
  }, [seenNotificationKeys]);


  const requestDesktopNotifications = async () => {
    if (typeof window === "undefined") return;
    try {
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
    } catch (_err) {}

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass && !notificationAudioRef.current) {
        notificationAudioRef.current = new AudioContextClass();
      }
    } catch (_err) {}
  };

  const playNotificationSound = () => {
    if (typeof window === "undefined") return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const ctx = notificationAudioRef.current || (AudioContextClass ? new AudioContextClass() : null);
      if (!ctx) return;
      notificationAudioRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (_err) {}
  };

  const notifyPlaymaker = (title, detail, voiceText) => {
    playNotificationSound();

    try {
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body: detail });
      }
    } catch (_err) {}

    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window && voiceText) {
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(voiceText);
        msg.rate = 0.95;
        msg.pitch = 1;
        window.speechSynthesis.speak(msg);
      }
    } catch (_err) {}
  };

  const isManualAnchor = (anchor = null) => {
    return isManualOrder(anchor);
  };

  const sendDiscordBoardNotice = async ({ event, title = "Playmaker Signal", detail = "", anchor = null }) => {
    if (!ownerMode || !user) return;
    if (Date.now() < suppressDiscordUntilRef.current) return;
    if (!anchor || isManualAnchor(anchor) || !isDiscordEligibleSignal(anchor)) return;

    const dedupeKey = `DISCORD|${discordNoticeKey({ event, title, detail, anchor })}`;
    if (sentDiscordNoticeKeysRef.current.has(dedupeKey) || seenNotificationKeys[dedupeKey]) return;
    sentDiscordNoticeKeysRef.current.add(dedupeKey);
    setSeenNotificationKeys((prev) => ({ ...prev, [dedupeKey]: true }));

    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) return;

      const response = await fetch("/api/discord-signal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ event, title, detail, anchor })
      });

      if (!response.ok) {
        const message = await response.text().catch(() => "");
        console.error("Playmaker Discord notice failed:", response.status, message);
      }
    } catch (err) {
      console.error("Playmaker Discord notice error:", err);
    }
  };


  const ownerMode = isOwnerUser(user);
  const [accessStatus, setAccessStatus] = useState("checking");
  const [accessMessage, setAccessMessage] = useState("");

  useEffect(() => {
    const checkPaidAccess = async () => {
      if (!user) {
        setAccessStatus("signed_out");
        setAccessMessage("");
        return;
      }

      if (ownerMode) {
        setAccessStatus("allowed");
        setAccessMessage("Owner access active.");
        return;
      }

      setAccessStatus("checking");
      setAccessMessage("Checking Playmaker access...");

      const userEmail = String(user.email || "").trim().toLowerCase();
      let row = null;
      let accessError = null;

      // Manual unlock rows are usually added by email, so check email first.
      // Keep this case-insensitive so Supabase rows still work if the email was typed with caps/spaces.
      if (userEmail) {
        const { data: emailRow, error: emailError } = await supabase
          .from("playmaker_access")
          .select("id, user_id, email, active, expires_at, whop_plan")
          .ilike("email", userEmail)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (emailError) {
          accessError = emailError;
          console.error("Playmaker access email check error:", emailError);
        } else {
          row = emailRow || null;
        }
      }

      // Fallback for rows tied directly to the Supabase auth user id.
      if (!row && user?.id) {
        const { data: idRow, error: idError } = await supabase
          .from("playmaker_access")
          .select("id, user_id, email, active, expires_at, whop_plan")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (idError) {
          accessError = idError;
          console.error("Playmaker access user_id check error:", idError);
        } else {
          row = idRow || null;
          accessError = null;
        }
      }

      if (accessError && !row) {
        setAccessStatus("blocked");
        setAccessMessage("Access check failed. Check the playmaker_access table policy or contact support.");
        return;
      }

      const expiresAt = row?.expires_at ? new Date(row.expires_at).getTime() : null;
      const isExpired = Boolean(expiresAt && expiresAt < Date.now());
      const active = row?.active === true || String(row?.active).toLowerCase() === "true";

      if (active && !isExpired) {
        setAccessStatus("allowed");
        setAccessMessage("Access active.");
      } else {
        setAccessStatus("blocked");
        setAccessMessage(`No active Playmaker subscription found for ${userEmail || "this login"}.`);
      }
    };

    checkPaidAccess();
  }, [user, ownerMode]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("playmaker_verified_anchors") || "{}");
      if (saved && typeof saved === "object") setVerifiedAnchors(saved);
    } catch (_err) {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("playmaker_verified_anchors", JSON.stringify(verifiedAnchors));
    } catch (_err) {}
  }, [verifiedAnchors]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("playmaker_owner_signal_notes") || "{}");
      if (saved && typeof saved === "object") setOwnerSignalNotes(saved);
    } catch (_err) {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("playmaker_owner_signal_notes", JSON.stringify(ownerSignalNotes));
    } catch (_err) {}
  }, [ownerSignalNotes]);

  useEffect(() => {
    if (!user) return;
    try {
      const saved = JSON.parse(localStorage.getItem("playmaker_submitted_anchor_keys") || "{}");
      if (ownerMode && saved && typeof saved === "object") {
        setSubmittedAnchorKeys(saved);
      } else if (!ownerMode) {
        localStorage.removeItem("playmaker_submitted_anchor_keys");
        setSubmittedAnchorKeys({});
      }
    } catch (_err) {}
  }, [user, ownerMode]);

  useEffect(() => {
    if (!ownerMode) return;
    try {
      localStorage.setItem("playmaker_submitted_anchor_keys", JSON.stringify(submittedAnchorKeys));
    } catch (_err) {}
  }, [submittedAnchorKeys, ownerMode]);

  useEffect(() => {
    if (!ownerMode) return;
    // Rebuild hidden/submitted anchor keys from reported/closed journal rows.
    // This stops a submitted setup from returning after refresh/deploy.
    setSubmittedAnchorKeys((prev) => {
      const next = { ...prev };
      journal.forEach((item) => {
        if (isOpenOrder(item)) return;
        const direction = String(item.direction || "BOTH").toUpperCase();
        const price = parsePrice(item.entry || item.entry_price);
        if (price === null) return;
        const baseKey = `${direction}|${String(Math.round(price * 4) / 4)}|`;
        if (!next[baseKey]) {
          next[baseKey] = {
            submittedAt: item.date || new Date().toISOString(),
            sourceCount: Number(item.sourceCount || item.evidence?.length || 0),
            score: Number(item.score || 0),
            evidenceSig: Array.isArray(item.evidence)
              ? item.evidence.map((ev) => `${ev.sourceType || ""}:${ev.label || ""}:${anchorPriceKey(ev.price)}`).sort().join("|")
              : ""
          };
        }
      });
      return next;
    });
  }, [journal, ownerMode]);

  useEffect(() => {
    if (!user) return;
    try {
      const saved = JSON.parse(localStorage.getItem("playmaker_filled_anchor_keys") || "{}");
      if (saved && typeof saved === "object") {
        setFilledAnchorKeys(saved);
      }
    } catch (_err) {}
  }, [user]);

  useEffect(() => {
    try {
      localStorage.setItem("playmaker_filled_anchor_keys", JSON.stringify(filledAnchorKeys));
    } catch (_err) {}
  }, [filledAnchorKeys]);

  useEffect(() => {
    if (!user) return;
    try {
      const saved = JSON.parse(localStorage.getItem("playmaker_pulled_anchor_keys") || "{}");
      if (ownerMode && saved && typeof saved === "object") {
        setPulledAnchorKeys(saved);
      } else if (!ownerMode) {
        localStorage.removeItem("playmaker_pulled_anchor_keys");
        setPulledAnchorKeys({});
      }
    } catch (_err) {}
  }, [user, ownerMode]);

  useEffect(() => {
    if (!ownerMode) return;
    try {
      localStorage.setItem("playmaker_pulled_anchor_keys", JSON.stringify(pulledAnchorKeys));
    } catch (_err) {}
  }, [pulledAnchorKeys, ownerMode]);

  // Global verification/note sync from Supabase.
  // This keeps Mr. DJ Harrison verification badges and owner notes visible
  // after refresh and across customer accounts.
  useEffect(() => {
    if (!user) return;

    const fetchBoardVerification = async () => {
      const { data, error } = await supabase
        .from("playmaker_board_state")
        .select("*");

      if (error) {
        console.error("Playmaker verification sync fetch error:", error);
        return;
      }

      const nextVerified = {};
      const nextNotes = {};
      const nextFilled = {};
      const clearedFilled = [];

      (data || []).forEach((row) => {
        const key = String(row.anchor_key || row.card_id || "").trim();
        if (!key) return;

        if (key.startsWith("FILLED|")) {
          const filledKey = key.replace(/^FILLED\|/, "");
          if (!row.owner_note) {
            if (filledKey) clearedFilled.push(filledKey);
            return;
          }
          try {
            const filledRecord = JSON.parse(row.owner_note);
            if (filledRecord?.anchorSnapshot && filledKey) {
              nextFilled[filledKey] = {
                filledAt: filledRecord.filledAt || row.updated_at || new Date().toISOString(),
                detail: filledRecord.detail || "",
                anchorSnapshot: filledRecord.anchorSnapshot
              };
            }
          } catch (_err) {}
          return;
        }

        if (!(row.verified || row.owner_note)) return;

        const directionFromKey = key.split("|")[0] || "BOTH";
        const verification = {
          verified: Boolean(row.verified),
          verifiedBy: "Mr. DJ Harrison",
          label: `Mr. DJ Harrison Verified ${directionFromKey}`,
          direction: directionFromKey,
          verifiedAt: row.updated_at || new Date().toISOString(),
          ownerNote: String(row.owner_note || "").trim()
        };

        nextVerified[key] = verification;
        nextNotes[key] = verification;
      });

      setVerifiedAnchors((prev) => ({ ...prev, ...nextVerified }));
      setOwnerSignalNotes((prev) => ({ ...prev, ...nextNotes }));
      setFilledAnchorKeys((prev) => {
        const next = { ...prev, ...nextFilled };
        clearedFilled.forEach((key) => delete next[key]);
        return next;
      });
    };

    fetchBoardVerification();

    const channel = supabase
      .channel("playmaker-board-verification-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "playmaker_board_state" }, fetchBoardVerification)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const setStart = (key) => {
    setStartingLevel((cur) => (cur === key ? "" : key));
    const awayKey = `${key}Away`;
    if (awayKey in form) set(awayKey, "0");
  };

  const away = (key) => (startingLevel === key ? 0 : n(form[`${key}Away`]));
  const canStart = (key) => startingOptions.includes(key);
  const startDisabled = (key) => startingLevel && startingLevel !== key;
  const weeklyLevelKey = (level) => String(level?.id || level?.price || level?.name || "");

  const aiLevelCreatedTime = (level) => new Date(level?.created_at || level?.updated_at || 0).getTime() || 0;
  const weeklySortPrice = (level) => {
    const price = parsePrice(level?.price);
    return price === null ? Number.POSITIVE_INFINITY : price;
  };
  const craterSortPrice = (box) => {
    const top = parsePrice(box?.top_price);
    const bottom = parsePrice(box?.bottom_price);
    return top === null || bottom === null ? Number.POSITIVE_INFINITY : (Math.max(top, bottom) + Math.min(top, bottom)) / 2;
  };

  const weeklyLevels = aiLevels
    .filter((level) => level.level_type === "weekly")
    .sort((a, b) => weeklySortPrice(a) - weeklySortPrice(b) || aiLevelCreatedTime(a) - aiLevelCreatedTime(b));
  const craterBoxes = aiLevels
    .filter((level) => level.level_type === "crater")
    .sort((a, b) => craterSortPrice(a) - craterSortPrice(b) || aiLevelCreatedTime(a) - aiLevelCreatedTime(b));

  const currentCraterTop = parsePrice(aiSettings.volumeCraterTop);
  const currentCraterBottom = parsePrice(aiSettings.volumeCraterBottom);
  const aiCraterSize = currentCraterTop !== null && currentCraterBottom !== null
    ? Math.abs(currentCraterTop - currentCraterBottom)
    : 0;
  const aiCraterMid = currentCraterTop !== null && currentCraterBottom !== null
    ? (currentCraterTop + currentCraterBottom) / 2
    : 0;
  const aiCraterAway = aiCraterMid && form.tradeEntryPrice
    ? Math.abs(aiCraterMid - n(form.tradeEntryPrice))
    : 0;
  const currentWeeklyPrice = parsePrice(aiSettings.weeklyLevelPrice);
  const aiWeeklyAway = currentWeeklyPrice !== null && form.tradeEntryPrice
    ? Math.abs(currentWeeklyPrice - n(form.tradeEntryPrice))
    : 0;

  const automationOn = aiSettings.autoUseIndicator === "Yes";
  const hasTradeEntry = parsePrice(form.tradeEntryPrice) !== null;

  const aiChecklist = [
    {
      item: "Saved weekly levels",
      value: weeklyLevels.length,
      needed: "Manual weekly pillar zones",
      ready: weeklyLevels.length > 0,
      status: weeklyLevels.length > 0 ? "Ready" : "Needed"
    },
    {
      item: "Saved crater boxes",
      value: craterBoxes.length,
      needed: "Manual crater box pillar zones",
      ready: craterBoxes.length > 0,
      status: craterBoxes.length > 0 ? "Ready" : "Needed"
    },
    {
      item: "Draft crater input",
      value: aiCraterSize ? `${fmt(aiCraterSize)} pts wide / Mid ${fmtPrice(aiCraterMid)}` : "Optional — saved crater boxes already loaded",
      needed: craterBoxes.length > 0 ? "Not required. Only type here when adding or editing a crater box." : "Add at least one crater box pillar zone.",
      ready: craterBoxes.length > 0 || aiCraterSize > 0,
      status: craterBoxes.length > 0 ? "Optional" : (aiCraterSize > 0 ? "Ready" : "Needed")
    },
    {
      item: "Draft weekly input",
      value: currentWeeklyPrice !== null ? fmtPrice(currentWeeklyPrice) : "Optional — saved weekly levels already loaded",
      needed: weeklyLevels.length > 0 ? "Not required. Only type here when adding or editing a weekly level." : "Add at least one weekly level pillar zone.",
      ready: weeklyLevels.length > 0 || currentWeeklyPrice !== null,
      status: weeklyLevels.length > 0 ? "Optional" : (currentWeeklyPrice !== null ? "Ready" : "Needed")
    },
    {
      item: "Entry source",
      value: automationOn ? "Auto from Playmaker signal engine" : (hasTradeEntry ? fmtPrice(parsePrice(form.tradeEntryPrice)) : "Manual entry needed"),
      needed: automationOn ? "No manual entry needed. Playmaker supplies the trade price when a signal fires." : "Manual mode needs an entry price typed before scoring.",
      ready: automationOn || hasTradeEntry,
      status: automationOn ? "Auto" : (hasTradeEntry ? "Ready" : "Needed")
    },
    {
      item: "Indicator automation",
      value: aiSettings.autoUseIndicator,
      needed: "Lets webhook signals combine with saved AI pillar zones",
      ready: true,
      status: aiSettings.autoUseIndicator === "Yes" ? "Ready" : "Manual"
    }
  ];

  const fetchAiLevels = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from("ai_levels")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("AI levels fetch error:", error);
      setAiLevelMessage("AI levels failed to load. Check Supabase ai_levels table.");
    } else {
      setAiLevels(data || []);
    }
  };

  const fetchAiSignals = async () => {
    setAiLoading(true);
    setAiFetchMessage("");

    // Pull both automated signal rows and older DJH rows.
    // The scanner must use delivered indicator levels, not only manual weekly/crater inputs.
    const { data, error } = await supabase
      .from("playmaker_signals")
      .select("*")
      .in("user_id", ["tradingview", "djh1984investing-eng"])
      .order("created_at", { ascending: false })
      .limit(750);

    if (error) {
      console.error("AI signal fetch error:", error);
      setAiFetchMessage("AI fetch failed. Check Supabase table/settings.");
    } else {
      setAiSignals(data || []);
      setAiFetchMessage((data || []).length ? `Fetched ${(data || []).length} Playmaker signal rows.` : "No AI signals found yet.");
    }
    setAiLoading(false);
  };

  useEffect(() => {
    const fetchSavedJournal = async () => {
      if (!user) return;
      const { data, error } = await supabase
        .from("trade_journal")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
        if (!error && data) {
        setJournal(data.map((row) => ({
          id: row.id || Date.now(),
          createdAt: row.created_at || null,
          date: row.created_at ? new Date(row.created_at).toLocaleDateString() : new Date().toLocaleDateString(),
          direction: row.direction || "",
          entry: row.entry_price || "",
          grade: row.grade || "",
          score: row.score || 0,
          result: row.result || "Unfilled",
          orderStatus: row.result === "Unfilled" ? "Unfilled" : "Reported",
          pendingOrder: row.result === "Unfilled",
          maxMove: row.max_move ?? "",
          maxDrawdown: row.max_drawdown ?? "",
          profitLoss: row.profit_loss ?? "",
          discountPoints: "",
          maxDiscountPoints: "",
          notes: row.notes || "",
          tradeImages: row.screenshots || [],
          top: Array.isArray(row.confluences) ? row.confluences.map((r) => r.name).join(", ") : "",
          signal_id: row.signal_id || row.ai_signal_id || "",
          verification: row.verification || null,
          journalScope: row.verification?.journalScope || row.verification?.scope || "",
          statsUpdatedAt: row.verification?.statsUpdatedAt || row.updated_at || row.created_at || null,
          sourceType: row.notes?.includes("AI Signal:") ? "AI Signal" : "Manual Order",
          evidence: Array.isArray(row.confluences) ? row.confluences : [],
          formSnapshot: row.confluences ? { evidence: row.confluences } : null
        })));
      }
    };

        
    fetchSavedJournal();
    fetchAiSignals();
    fetchAiLevels();
  }, [user]);

  const resetAiLevelInputs = () => {
    setAiSettings((s) => ({
      ...s,
      weeklyLevelName: "",
      weeklyLevelPrice: "",
      craterBoxName: "",
      volumeCraterTop: "",
      volumeCraterBottom: ""
    }));
    setEditingWeeklyLevelId(null);
    setEditingCraterBoxId(null);
  };

  const saveWeeklyLevel = async () => {
  
  if (!user) {
      alert("Please log in before saving AI levels.");
      return;
    }

    const price = parsePrice(aiSettings.weeklyLevelPrice);
    if (price === null || price <= 0) {
      alert("Enter a valid weekly level price.");
      return;
    }

    const payload = {
      user_id: user.id,
      level_type: "weekly",
      name: aiSettings.weeklyLevelName || "Weekly Level",
      price,
      top_price: null,
      bottom_price: null
    };

    if (editingWeeklyLevelId) {
      const { error } = await supabase
        .from("ai_levels")
        .update(payload)
        .eq("id", editingWeeklyLevelId)
        .eq("user_id", user.id);

      if (error) {
        console.error("Weekly level update error:", error);
        alert("Weekly level did not update.");
        return;
      }

      setAiLevels((levels) => levels.map((level) => level.id === editingWeeklyLevelId ? { ...level, ...payload } : level));
      setAiLevelMessage("Weekly level updated.");
    } else {
      const { data, error } = await supabase
        .from("ai_levels")
        .insert([payload])
        .select("*")
        .single();

      if (error) {
        console.error("Weekly level save error:", error);
        alert("Weekly level did not save.");
        return;
      }

      setAiLevels((levels) => [data, ...levels]);
      setAiLevelMessage("Weekly level saved.");
    }

    setAiSettings((s) => ({ ...s, weeklyLevelName: "", weeklyLevelPrice: "" }));
    setEditingWeeklyLevelId(null);
  };

  const saveCraterBox = async () => {
    if (!user) {
      alert("Please log in before saving crater boxes.");
      return;
    }

    const top = parsePrice(aiSettings.volumeCraterTop);
    const bottom = parsePrice(aiSettings.volumeCraterBottom);

    if (top === null || bottom === null || top <= 0 || bottom <= 0) {
      alert("Enter valid crater top and bottom prices.");
      return;
    }

    if (top === bottom) {
      alert("Crater top and bottom cannot be the same price.");
      return;
    }

    const high = Math.max(top, bottom);
    const low = Math.min(top, bottom);
    const payload = {
      user_id: user.id,
      level_type: "crater",
      name: aiSettings.craterBoxName || "Crater Box",
      price: null,
      top_price: high,
      bottom_price: low
    };

    if (editingCraterBoxId) {
      const { error } = await supabase
        .from("ai_levels")
        .update(payload)
        .eq("id", editingCraterBoxId)
        .eq("user_id", user.id);

      if (error) {
        console.error("Crater box update error:", error);
        alert("Crater box did not update.");
        return;
      }

      setAiLevels((levels) => levels.map((level) => level.id === editingCraterBoxId ? { ...level, ...payload } : level));
      setAiLevelMessage("Crater box updated.");
    } else {
      const { data, error } = await supabase
        .from("ai_levels")
        .insert([payload])
        .select("*")
        .single();

      if (error) {
        console.error("Crater box save error:", error);
        alert("Crater box did not save.");
        return;
      }

      setAiLevels((levels) => [data, ...levels]);
      setAiLevelMessage("Crater box saved.");
    }

    setAiSettings((s) => ({ ...s, craterBoxName: "", volumeCraterTop: "", volumeCraterBottom: "" }));
    setEditingCraterBoxId(null);
  };

  const editWeeklyLevel = (level) => {
    setEditingWeeklyLevelId(level.id);
    setEditingCraterBoxId(null);
    setAiSettings((s) => ({
      ...s,
      weeklyLevelName: level.name || "Weekly Level",
      weeklyLevelPrice: level.price ? String(level.price) : ""
    }));
    setAiLevelMessage("Editing weekly level.");
  };

  const editCraterBox = (box) => {
    setEditingCraterBoxId(box.id);
    setEditingWeeklyLevelId(null);
    setAiSettings((s) => ({
      ...s,
      craterBoxName: box.name || "Crater Box",
      volumeCraterTop: box.top_price ? String(box.top_price) : "",
      volumeCraterBottom: box.bottom_price ? String(box.bottom_price) : ""
    }));
    setAiLevelMessage("Editing crater box.");
  };

  const deleteAiLevel = async (level) => {
    if (!user) return;

    const { error } = await supabase
      .from("ai_levels")
      .delete()
      .eq("id", level.id)
      .eq("user_id", user.id);

    if (error) {
      console.error("AI level delete error:", error);
      alert("Delete failed.");
      return;
    }

    setAiLevels((levels) => levels.filter((item) => item.id !== level.id));
    if (editingWeeklyLevelId === level.id || editingCraterBoxId === level.id) {
      resetAiLevelInputs();
    }
    setAiLevelMessage("AI level deleted.");
  };

  const submitAiSettings = async () => {
    await Promise.all([
      aiSettings.weeklyLevelPrice ? saveWeeklyLevel() : Promise.resolve(),
      (aiSettings.volumeCraterTop || aiSettings.volumeCraterBottom) ? saveCraterBox() : Promise.resolve()
    ]);
  };

  const isRecentSignal = (createdAt) => {
    if (!createdAt) return false;
    const diffDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= 7;
  };

  const signalHasJournal = (signal) => {
    const signalId = String(signal.id || "");
    const signalName = String(signal.signal || "").toLowerCase();
    return journal.some((j) => {
      const journalSignalId = String(j.signal_id || j.ai_signal_id || "");
      const journalNotes = String(j.notes || "").toLowerCase();
      const journalTop = String(j.top || "").toLowerCase();
      return (signalId && journalSignalId === signalId) || (signalName && (journalNotes.includes(signalName) || journalTop.includes(signalName)));
    });
  };

  const unfilledAiSignals = aiSignals.filter((signal) => !signalHasJournal(signal));

  // Scanner input should include all fetched automated level rows.
  // Journal filtering is only for hiding already-submitted order cards, not for excluding confluence levels.
  const scannerAiSignals = aiSignals.filter((signal) => !isGenericPriceAlertSignal(signal));


  const normalizeDirection = (value, fallbackSignal = "") => {
    const direct = String(value || "").trim().toLowerCase();
    if (["both", "neutral", "level", "levels"].includes(direct)) return "Both";

    const text = String(value || fallbackSignal || "").toLowerCase();
    if (text.includes("short") || text.includes("sell") || text.includes("bearish") || text.includes("top")) return "Short";
    if (text.includes("long") || text.includes("buy") || text.includes("bullish") || text.includes("bottom")) return "Long";
    return "Long";
  };

  const deviationStrength = (name) => {
    const match = String(name || "").match(/(-?\d+(?:_\d+)?|-?\d+(?:\.\d+)?)/);
    if (!match) return 0;
    const value = Math.abs(Number(match[1].replace("_", ".")));

    // Manual-style weighting:
    // ±3 is where the level becomes a serious candidate.
    // ±4 and beyond are premium reaction zones.
    // ±5 to ±6 are elite, but they still need another level nearby before being promoted.
    if (value >= 6) return 58;
    if (value >= 5.5) return 54;
    if (value >= 5) return 50;
    if (value >= 4.5) return 45;
    if (value >= 4) return 40;
    if (value >= 3.5) return 35;
    if (value >= 3) return 30;
    if (value >= 2.5) return 18;
    if (value >= 2) return 14;
    if (value >= 1.5) return 10;
    if (value >= 1) return 7;
    if (value >= 0.705) return 5;
    if (value >= 0.5) return 3;
    return 0;
  };

  const deviationValueFromLabel = (label) => {
    const match = String(label || "").match(/(-?\d+(?:_\d+)?|-?\d+(?:\.\d+)?)/);
    if (!match) return 0;
    return Number(match[1].replace("_", "."));
  };

  const isMajorDeviationLabel = (label) => Math.abs(deviationValueFromLabel(label)) >= 3;

  const aiGrade = (score) => {
    if (score >= 92) return "A+";
    if (score >= 84) return "A";
    if (score >= 74) return "B+";
    if (score >= 65) return "B";
    if (score >= 55) return "C";
    return "D";
  };

  const sessionRankLimit = 5;

  const nearestWeeklyToPrice = (price) => {
    const entry = parsePrice(price);
    if (entry === null || weeklyLevels.length === 0) return null;
    return weeklyLevels
      .map((level) => ({
        ...level,
        anchorType: "Previous Week Level",
        anchorPrice: Number(level.price),
        distance: Math.abs(Number(level.price) - entry)
      }))
      .filter((level) => Number.isFinite(level.anchorPrice) && Number.isFinite(level.distance) && level.distance <= maxConfluenceDistancePoints)
      .sort((a, b) => a.distance - b.distance)[0] || null;
  };

  const nearestCraterToPrice = (price) => {
    const entry = parsePrice(price);
    if (entry === null || craterBoxes.length === 0) return null;
    return craterBoxes
      .map((box) => {
        const top = Number(box.top_price);
        const bottom = Number(box.bottom_price);
        if (!Number.isFinite(top) || !Number.isFinite(bottom) || top <= 0 || bottom <= 0 || top === bottom) return null;
        const high = Math.max(top, bottom);
        const low = Math.min(top, bottom);
        const mid = (high + low) / 2;
        const width = Math.abs(high - low);
        const inside = entry <= high && entry >= low;
        return {
          ...box,
          anchorType: "Volume Crater / LVN",
          anchorPrice: inside ? entry : mid,
          high,
          low,
          mid,
          width,
          inside,
          distance: inside ? 0 : Math.min(Math.abs(entry - high), Math.abs(entry - low), Math.abs(entry - mid))
        };
      })
      .filter((crater) => crater && crater.distance <= maxConfluenceDistancePoints)
      .sort((a, b) => a.distance - b.distance)[0] || null;
  };

  const buildLevelEvidenceCandidates = (signal) => {
    const payload = getSignalPayload(signal);
    const signalName = String(payload.signal || payload.setup || signal.signal || "AI Signal");
    const type = signalName.toUpperCase();
    const session = String(payload.session || payload.session_name || payload.timeframe || signal.timeframe || "GLOBAL");
    const triggerPrice = parsePrice(firstDefined(payload.trigger_price, payload.price, payload.entry, payload.entry_price, signal.price));
    const created = signal.created_at || payload.created_at;
    const base = { sourceSignal: signal, payload, sourceId: signal.id || payload.id || created || signalName, created_at: created, session, triggerPrice, signalName };

    const make = (price, label, direction, sourceType, evidenceScore = 0, evidenceClass = "support") => {
      const parsed = parsePrice(price);
      if (parsed === null || parsed <= 0) return null;
      return { ...base, price: parsed, label, direction: normalizeDirection(direction, signalName), sourceType, evidenceScore, evidenceClass, levelKey: getLevelKey(parsed) };
    };

    const candidates = [];
    const push = (candidate) => { if (candidate) candidates.push(candidate); };

    if (type.includes("SESSION_DEVIATION")) {
      const stdvLabels = ["-6", "-5.5", "-5", "-4.5", "-4", "-3.5", "-3", "-2.5", "-2", "-1.5", "-1", "-0.786", "-0.705", "-0.618", "-0.5", "CE", "+0.5", "+0.618", "+0.705", "+0.786", "+1", "+1.5", "+2", "+2.5", "+3", "+3.5", "+4", "+4.5", "+5", "+5.5", "+6"];
      const levels = stdvLabels.map((label) => [label, label === "CE" ? firstDefined(payload.mid, payload.mean, payload.ce, payload.session_mid, payload.session_mean, payload.levels?.mid, payload.levels?.mean, payload.levels?.ce) : getNestedLevelValue(payload, label)]);
      const tf = timeframeFromPayload(payload, signalName) || String(payload.timeframe || signal.timeframe || "5m");
      const tfWeight = tf === "D" ? 1.7 : tf === "4H" ? 1.8 : tf === "1H" ? 1.45 : tf === "15m" ? 1.15 : 1;
      const family = tf === "D" ? "Daily STDV" : tf === "4H" ? "4H STDV" : tf === "1H" ? "1H STDV" : tf === "15m" ? "15m STDV" : "5m Session STDV";
      push(make(firstDefined(payload.session_high, payload.high, payload.range_high, payload.levels?.session_high), `${family} ${session} session high`, "Both", `${family} Range`, 8 * tfWeight, "support"));
      push(make(firstDefined(payload.session_low, payload.low, payload.range_low, payload.levels?.session_low), `${family} ${session} session low`, "Both", `${family} Range`, 8 * tfWeight, "support"));
      levels.forEach(([name, value]) => {
        const isCE = name === "CE";
        const dir = isCE ? "Both" : String(name).startsWith("-") ? "Long" : "Short";
        const abs = isCE ? 0 : deviationAbsFromLabel(name);
        const sourceType = isCE ? `${family} CE` : abs >= 3 ? "Major Session Deviation" : "Session Deviation";
        const score = isCE ? 12 * tfWeight : deviationEvidenceScore(name) * tfWeight;
        push(make(value, `${family} ${session} ${name}`, dir, sourceType, score, isCE || abs >= 3 || tf === "D" || tf === "4H" || tf === "1H" ? "anchor" : "support"));
      });
    }

    if (type.includes("CONFLUENCE") || type.includes("PLAYMAKER")) {
      const centerPrice = firstDefined(
        payload.confluence_center,
        payload.cluster_center,
        payload.confluence_price,
        payload.htf_confluence_price,
        payload.price,
        payload.trigger_price
      );

      const rawSources = firstDefined(
        payload.confluence_levels,
        payload.playmaker_levels,
        payload.source_levels,
        payload.level_prices,
        payload.levels_detail,
        []
      );

      const parsedSourceLevels = Array.isArray(rawSources)
        ? rawSources
        : typeof rawSources === "string"
          ? (() => {
              try {
                const parsed = JSON.parse(rawSources);
                return Array.isArray(parsed) ? parsed : [];
              } catch (_err) {
                return rawSources.split(",").map((part) => {
                  const [label, price] = part.split(":").map((x) => String(x || "").trim());
                  return { label, source: label, price };
                });
              }
            })()
          : [];

      const sourceText = String(firstDefined(payload.sources, payload.confluence_sources, payload.matches, "") || "");
      const count = n(firstDefined(payload.confluence_count, payload.matches, payload.count, payload.htfConfluenceCount, parsedSourceLevels.length), 1);
      const baseScore = 26 + Math.min(24, count * 6);

      // Always count the PlayMaker alert itself as a major confluence source.
      push(make(
        centerPrice,
        `PlayMaker confluence center ${sourceText}`.trim(),
        payload.direction,
        "PlayMaker Confluence",
        baseScore,
        "major"
      ));

      // Also unpack each individual PlayMaker confluence level when the alert sends them.
      // This is what makes D:-1, W:0.5, etc. appear in the order-card source list.
      parsedSourceLevels.forEach((level, idx) => {
        const label = firstDefined(level.label, level.source, level.name, level.tf, `source ${idx + 1}`);
        const price = firstDefined(level.price, level.value, level.level, level.confluence_price);
        push(make(
          price,
          `PlayMaker ${label}`,
          firstDefined(level.direction, payload.direction, "Both"),
          "PlayMaker Confluence",
          Math.max(18, Math.round(baseScore / 2)),
          "major"
        ));
      });

      // Backward-compatible unpacking for flat payloads like d_neg_1_price or w_0_5.
      Object.entries(payload || {}).forEach(([key, value]) => {
        const lower = String(key).toLowerCase();
        const looksLikePlaymakerLevel =
          (lower.startsWith("pm_") || lower.startsWith("playmaker_") || lower.startsWith("confluence_")) &&
          (lower.includes("level") || lower.includes("price")) &&
          !["confluence_price", "confluence_center"].includes(lower);
        if (!looksLikePlaymakerLevel) return;
        push(make(
          value,
          `PlayMaker ${key.replace(/^pm_|^playmaker_|^confluence_/i, "").replace(/_/g, " ")}`,
          payload.direction || "Both",
          "PlayMaker Confluence",
          Math.max(18, Math.round(baseScore / 2)),
          "major"
        ));
      });
    }

    if (type.includes("ORDER_BLOCK") || type.includes("ORDER BLOCK")) {
      const high = parsePrice(firstDefined(payload.high, payload.ob_high, payload.top, payload.block_top));
      const low = parsePrice(firstDefined(payload.low, payload.ob_low, payload.bottom, payload.block_bottom));
      const ce = parsePrice(firstDefined(payload.ce, payload.ob_ce, high !== null && low !== null ? (high + low) / 2 : null));
      const score = structureEvidenceScore(payload, signalName, "ORDER_BLOCK");
      if (score > 0) push(make(ce, `${timeframeFromPayload(payload, signalName) || "HTF"} order block CE`, firstDefined(payload.direction, signalName), "Order Block", score, score >= 13 ? "major" : "minor"));
    }

    if (type.includes("REJECTION_BLOCK") || type.includes("REJECTION BLOCK")) {
      const high = parsePrice(firstDefined(payload.high, payload.rb_high, payload.top, payload.block_top));
      const low = parsePrice(firstDefined(payload.low, payload.rb_low, payload.bottom, payload.block_bottom));
      const ce = parsePrice(firstDefined(payload.ce, payload.rb_ce, high !== null && low !== null ? (high + low) / 2 : null));
      const score = structureEvidenceScore(payload, signalName, "REJECTION_BLOCK");
      if (score > 0) push(make(ce, `${timeframeFromPayload(payload, signalName) || "HTF"} rejection block CE`, firstDefined(payload.direction, signalName), "Rejection Block", score, score >= 13 ? "major" : "minor"));
    }

    if (type.includes("EXTENSION") || String(payload.type || "").toUpperCase().includes("EXTENSION")) {
      const tf = timeframeFromPayload(payload, signalName) || "HTF";
      const tfWeight = tf === "D" ? 1.65 : tf === "4H" ? 1.9 : tf === "1H" ? 1.55 : 1;
      const family = tf === "D" ? "Daily STDV" : tf === "4H" ? "4H STDV" : tf === "1H" ? "1H STDV" : `${tf} STDV`;
      const levelPairs = [
        ["-6", firstDefined(getNestedLevelValue(payload, "-6"), payload.ext_neg_6)],
        ["-5.5", firstDefined(getNestedLevelValue(payload, "-5.5"), payload.ext_neg_5_5)],
        ["-5", firstDefined(getNestedLevelValue(payload, "-5"), payload.ext_neg_5)],
        ["-4.5", firstDefined(getNestedLevelValue(payload, "-4.5"), payload.ext_neg_4_5)],
        ["-4", firstDefined(getNestedLevelValue(payload, "-4"), payload.ext_neg_4)],
        ["-3.5", firstDefined(getNestedLevelValue(payload, "-3.5"), payload.ext_neg_3_5)],
        ["-3", firstDefined(getNestedLevelValue(payload, "-3"), payload.ext_neg_3)],
        ["-2.5", firstDefined(getNestedLevelValue(payload, "-2.5"), payload.ext_neg_2_5)],
        ["-2", firstDefined(getNestedLevelValue(payload, "-2"), payload.ext_neg_2)],
        ["-1.5", firstDefined(getNestedLevelValue(payload, "-1.5"), payload.ext_neg_1_5)],
        ["-1", firstDefined(getNestedLevelValue(payload, "-1"), payload.ext_neg_1, payload.swing_low)],
        ["CE", firstDefined(payload.ce, payload.mid, payload.mean, payload.levels?.ce, payload.levels?.mid, payload.levels?.mean)],
        ["+1", firstDefined(getNestedLevelValue(payload, "+1"), payload.ext_pos_1, payload.swing_high)],
        ["+1.5", firstDefined(getNestedLevelValue(payload, "+1.5"), payload.ext_pos_1_5)],
        ["+2", firstDefined(getNestedLevelValue(payload, "+2"), payload.ext_pos_2)],
        ["+2.5", firstDefined(getNestedLevelValue(payload, "+2.5"), payload.ext_pos_2_5)],
        ["+3", firstDefined(getNestedLevelValue(payload, "+3"), payload.ext_pos_3)],
        ["+3.5", firstDefined(getNestedLevelValue(payload, "+3.5"), payload.ext_pos_3_5)],
        ["+4", firstDefined(getNestedLevelValue(payload, "+4"), payload.ext_pos_4)],
        ["+4.5", firstDefined(getNestedLevelValue(payload, "+4.5"), payload.ext_pos_4_5)],
        ["+5", firstDefined(getNestedLevelValue(payload, "+5"), payload.ext_pos_5)],
        ["+5.5", firstDefined(getNestedLevelValue(payload, "+5.5"), payload.ext_pos_5_5)],
        ["+6", firstDefined(getNestedLevelValue(payload, "+6"), payload.ext_pos_6)]
      ];
      levelPairs.forEach(([name, value]) => {
        const isCE = name === "CE";
        const levelScore = isCE ? 12 * tfWeight : deviationEvidenceScore(name) * tfWeight;
        const evidenceClass = tf === "D" || tf === "4H" || tf === "1H" || deviationAbsFromLabel(name) >= 3 ? "anchor" : "support";
        // Neutral sweep extensions are level sources, not long/short bias.
        // Daily levels are good but treated as broader zones; cluster precision still decides exact entry.
        push(make(value, `${family} ${name}`, "Both", family, levelScore, evidenceClass));
      });
    }

    if (type.includes("VOLUME_PROFILE_LEVELS") || type.includes("VOLUME PROFILE")) {
      const tf = timeframeFromPayload(payload, signalName) || String(payload.timeframe || signal.timeframe || "");
      const tfPrefix = tf ? `${tf} ` : "";
      const is15 = tf === "15m";
      const is5 = tf === "5m";

      // Volume profile is used for precision/confirmation, not as a standalone trade anchor.
      // POC can react directly. LVN/crater can sweep below/above then reverse depending on the other levels stacked there.
      const poc = firstDefined(payload.poc, payload.point_of_control, payload.vp_poc, payload.volume_poc);
      const vah = firstDefined(payload.vah, payload.value_area_high, payload.va_high);
      const val = firstDefined(payload.val, payload.value_area_low, payload.va_low);
      const lvnValues = [
        ...arrayFromMaybe(payload.lvn_levels),
        ...arrayFromMaybe(payload.lvns),
        ...arrayFromMaybe(payload.low_volume_nodes),
        ...arrayFromMaybe(payload.low_volume_node),
        ...arrayFromMaybe(payload.crater_levels),
        ...arrayFromMaybe(payload.craters)
      ];
      const hvnValues = [
        ...arrayFromMaybe(payload.hvn_levels),
        ...arrayFromMaybe(payload.hvns),
        ...arrayFromMaybe(payload.high_volume_nodes),
        ...arrayFromMaybe(payload.high_volume_node)
      ];

      const pocScore = is15 ? 24 : is5 ? 18 : 14;
      const lvnScore = is15 ? 26 : is5 ? 20 : 15;
      const vaScore = is15 ? 16 : is5 ? 12 : 9;
      const hvnScore = is15 ? 11 : is5 ? 8 : 6;

      push(make(poc, `${tfPrefix}Volume POC precision`, "Both", "Volume Profile POC", pocScore, "precision"));
      push(make(vah, `${tfPrefix}Volume VAH precision`, "Both", "Volume Profile VAH", vaScore, "precision"));
      push(make(val, `${tfPrefix}Volume VAL precision`, "Both", "Volume Profile VAL", vaScore, "precision"));
      lvnValues.forEach((value, idx) => push(make(value, `${tfPrefix}LVN / crater precision ${idx + 1}`, "Both", "Volume Profile LVN", lvnScore, "precision")));
      hvnValues.forEach((value, idx) => push(make(value, `${tfPrefix}HVN confirmation ${idx + 1}`, "Both", "Volume Profile HVN", hvnScore, "precision")));
    }

    if (type.includes("RETRACE") || type.includes("RETRACEMENT")) {
      const tf = timeframeFromPayload(payload, signalName);
      const tfScore = tf === "D" ? 30 : tf === "4H" ? 24 : tf === "1H" ? 20 : tf === "15m" ? 12 : 8;
      [
        ["Swing High", firstDefined(payload.swing_high, payload.high, payload.levels?.swing_high)],
        ["Swing Low", firstDefined(payload.swing_low, payload.low, payload.levels?.swing_low)],
        ["CE / 0.50", firstDefined(payload.ce, payload.mid, payload.mean, payload.fib_050, payload.ote_050, payload.levels?.ce, payload.levels?.mid, payload.levels?.fib_050, payload.levels?.ote_050)],
        ["0.618", firstDefined(payload.ote_0618, payload.fib_0618, payload.levels?.ote_0618, payload.levels?.fib_0618)],
        ["0.705", firstDefined(payload.ote_0705, payload.fib_0705, payload.levels?.ote_0705, payload.levels?.fib_0705)],
        ["0.786", firstDefined(payload.ote_0786, payload.fib_0786, payload.levels?.ote_0786, payload.levels?.fib_0786)]
      ].forEach(([name, value]) => {
        const fibBonus = name.includes("0.786") ? 5 : name.includes("0.705") ? 4 : name.includes("0.618") ? 3 : 1;
        push(make(value, `${tf || "HTF"} OTE Retracement ${name}`, payload.direction, "OTE Retracement", tfScore + fibBonus, tf === "D" || tf === "4H" || tf === "1H" ? "major" : "support"));
      });
    }

    return uniqueEvidenceByPriceAndLabel(candidates);
  };

  const latestMarketSnapshot = useMemo(() => {
    for (const signal of aiSignals) {
      const payload = getSignalPayload(signal);
      const directPrice = parsePrice(firstDefined(
        payload.current_price,
        payload.close,
        payload.last
      ));
      if (directPrice !== null) {
        const createdMs = new Date(signal.created_at || payload.created_at || Date.now()).getTime();
        const ageMinutes = Number.isFinite(createdMs) ? (Date.now() - createdMs) / 60000 : null;
        return {
          price: directPrice,
          ageMinutes,
          source: "market"
        };
      }

      const sessionHigh = parsePrice(firstDefined(payload.session_high, payload.high, payload.range_high));
      const sessionLow = parsePrice(firstDefined(payload.session_low, payload.low, payload.range_low));
      if (sessionHigh !== null && sessionLow !== null) {
        const createdMs = new Date(signal.created_at || payload.created_at || Date.now()).getTime();
        const ageMinutes = Number.isFinite(createdMs) ? (Date.now() - createdMs) / 60000 : null;
        return {
          price: roundToTick((sessionHigh + sessionLow) / 2),
          ageMinutes,
          source: "session"
        };
      }
    }
    return null;
  }, [aiSignals]);

  const latestKnownMarketPrice = latestMarketSnapshot?.price ?? null;

  const rankedAiLimitZones = useMemo(() => {
    const rawEvidence = scannerAiSignals.flatMap(buildLevelEvidenceCandidates);
    const seedLevels = [
      ...weeklyLevels.map((level) => ({ price: Number(level.price), direction: "Both", label: `Weekly ${level.name || "level"}`, sourceType: "Weekly Level", evidenceScore: 24, evidenceClass: "pillar", session: "WEEKLY", sourceId: `weekly-${level.id}`, created_at: level.created_at, payload: level, signalName: "Weekly Level", triggerPrice: null, levelKey: getLevelKey(level.price) })).filter((item) => Number.isFinite(item.price) && item.price > 0),
      ...craterBoxes.flatMap((box) => {
        const top = Number(box.top_price), bottom = Number(box.bottom_price);
        if (!Number.isFinite(top) || !Number.isFinite(bottom) || top <= 0 || bottom <= 0 || top === bottom) return [];
        const high = Math.max(top, bottom), low = Math.min(top, bottom), mid = (high + low) / 2, width = Math.abs(high - low);
        const score = width >= 120 ? 34 : width >= 80 ? 30 : width >= 50 ? 24 : width >= 25 ? 17 : 11;
        return [{ price: mid, direction: "Both", label: `${box.name || "Crater"} mid ${fmt(width)} pts wide`, sourceType: "Volume Crater / LVN", evidenceScore: score, evidenceClass: "pillar", session: "CRATER", sourceId: `crater-${box.id}`, created_at: box.created_at, payload: box, signalName: "Crater Box", triggerPrice: null, high, low, mid, width, levelKey: getLevelKey(mid) }];
      })
    ];

    const zones = [];
    [...seedLevels, ...rawEvidence].forEach((ev) => {
      const price = parsePrice(ev.price);
      if (price === null || price <= 0) return;
      const direction = ev.direction === "Both" ? "Both" : ev.direction;
      let zone = zones.find((item) => Math.abs(item.price - price) <= levelMergeTolerance && (item.direction === direction || item.direction === "Both" || direction === "Both"));
      if (!zone) {
        zone = { price, direction, evidence: [], sessions: new Set(), sourceIds: new Set(), created_at: ev.created_at, triggerPrice: ev.triggerPrice, payload: ev.payload, sourceId: ev.sourceId };
        zones.push(zone);
      }
      zone.evidence.push({ ...ev, price });
      if (ev.session) zone.sessions.add(ev.session);
      if (ev.sourceId) zone.sourceIds.add(String(ev.sourceId));
      const clusteredPrices = uniqueSortedPrices(zone.evidence);
      zone.clusterLow = clusteredPrices.length ? clusteredPrices[0] : price;
      zone.clusterHigh = clusteredPrices.length ? clusteredPrices[clusteredPrices.length - 1] : price;
      zone.clusterWidth = Math.max(0, zone.clusterHigh - zone.clusterLow);
      zone.price = (zone.clusterHigh + zone.clusterLow) / 2;
      zone.clusterPrices = clusteredPrices;
      if (zone.direction === "Both" && direction !== "Both") zone.direction = direction;
    });

    const scored = zones.map((zone) => {
      const weekly = nearestWeeklyToPrice(zone.price);
      const crater = nearestCraterToPrice(zone.price);
      const sourceTypes = new Set(zone.evidence.map((item) => item.sourceType));
      const majorDeviation = zone.evidence.find((item) => item.sourceType === "Major Session Deviation");
      const minorDeviation = zone.evidence.find((item) => item.sourceType === "Session Deviation");
      const htfStdv = zone.evidence.find((item) => item.sourceType === "1H STDV" || item.sourceType === "4H STDV" || item.sourceType === "Daily STDV");
      const hasDailyStdv = zone.evidence.some((item) => item.sourceType === "Daily STDV");
      const has4HStdv = zone.evidence.some((item) => item.sourceType === "4H STDV");
      const has1HStdv = zone.evidence.some((item) => item.sourceType === "1H STDV");
      const hasVpPrecision = zone.evidence.some((item) => String(item.sourceType).startsWith("Volume Profile"));
      const has5mVpPrecision = zone.evidence.some((item) => String(item.sourceType).startsWith("Volume Profile") && String(item.label).includes("5m"));
      const has15mVpPrecision = zone.evidence.some((item) => String(item.sourceType).startsWith("Volume Profile") && String(item.label).includes("15m"));
      const hasPocPrecision = zone.evidence.some((item) => String(item.sourceType).includes("POC"));
      const hasLvnPrecision = zone.evidence.some((item) => String(item.sourceType).includes("LVN"));
      const vpPrecisionBonus =
        has5mVpPrecision && has15mVpPrecision ? 14 :
        has15mVpPrecision ? 9 :
        has5mVpPrecision ? 6 :
        hasVpPrecision ? 3 :
        0;
      const hasPlaymaker = sourceTypes.has("PlayMaker Confluence");
      const hasOTE = sourceTypes.has("OTE Retracement");
      const hasWeekly = Boolean(weekly);
      const hasCrater = Boolean(crater) || sourceTypes.has("Volume Profile LVN");
      const hasHTFStructure = zone.evidence.some((item) => ["Order Block", "Rejection Block"].includes(item.sourceType) && item.evidenceScore >= 13);
      const evidenceScore = zone.evidence.reduce((sum, item) => sum + n(item.evidenceScore), 0);
      const pillarScore = (hasWeekly ? 22 * scoreDistance(weekly?.distance ?? 0, 3, 7, 15) : 0) + (hasCrater ? craterQualityScore(crater) : 0);
      const sourceCount = zone.evidence.length;
      const stackCount = [Boolean(majorDeviation), Boolean(htfStdv), has1HStdv, has4HStdv, hasDailyStdv, hasPlaymaker, hasOTE, hasWeekly, hasCrater, hasHTFStructure, Boolean(minorDeviation), hasVpPrecision].filter(Boolean).length;
      const athModeBonus = (Boolean(majorDeviation) || has1HStdv || has4HStdv || hasDailyStdv) && (has1HStdv || has4HStdv || hasDailyStdv || sourceCount >= 3) ? 14 : 0;
      const noAnchorPenalty = (!majorDeviation && !htfStdv && !hasWeekly && !hasCrater && !hasPlaymaker) ? 20 : 0;
      const rawZoneScore = evidenceScore + pillarScore + Math.min(24, sourceCount * 3) + Math.min(18, sourceTypes.size * 3) + stackCount * 6 + athModeBonus + vpPrecisionBonus - noAnchorPenalty;
      const precisionOnly = zone.evidence.length > 0 && zone.evidence.every((item) => String(item.sourceType).startsWith("Volume Profile"));
      const familyCount = sourceTypes.size;
      const hasDirectionalEngine = Boolean(majorDeviation) || Boolean(htfStdv) || hasPlaymaker || hasOTE || hasHTFStructure;
      const hasPrecisionEngine = hasVpPrecision || hasPocPrecision || hasLvnPrecision;
      const hasOnlyManualPillars = zone.evidence.length > 0 && zone.evidence.every((item) => ["Weekly Level", "Volume Crater / LVN"].includes(item.sourceType));
      let gatedScore = rawZoneScore;
      if (hasOnlyManualPillars) gatedScore = Math.min(gatedScore, 74);
      if (sourceCount < 2) gatedScore = Math.min(gatedScore, 69);
      if (sourceCount < 3) gatedScore = Math.min(gatedScore, 79);
      if (familyCount < 2) gatedScore = Math.min(gatedScore, 74);
      if (familyCount < 3 && !hasDirectionalEngine) gatedScore = Math.min(gatedScore, 79);
      if (!hasDirectionalEngine && !hasPrecisionEngine) gatedScore = Math.min(gatedScore, 74);
      if (!hasDirectionalEngine && hasPrecisionEngine) gatedScore = Math.min(gatedScore, 84);
      const score = Math.round(clamp(gatedScore, 0, 100));
      const [zoneGrade] = grade(score);
      const triggerPrices = zone.evidence.map((item) => item.triggerPrice).filter(Number.isFinite);
      const clusterPrices = uniqueSortedPrices(zone.evidence);
      const clusterLow = clusterPrices.length ? clusterPrices[0] : zone.price;
      const clusterHigh = clusterPrices.length ? clusterPrices[clusterPrices.length - 1] : zone.price;
      const clusterWidth = Math.max(0, clusterHigh - clusterLow);
      const zoneCenter = (clusterHigh + clusterLow) / 2;
      const entryStack = findBestEntryStack(zone.evidence, zoneCenter);
      const clusterCenter = roundToTick(entryStack.center);
      const triggerDistances = triggerPrices.map((price) => Math.abs(price - clusterCenter));
      const nearestTriggerDistance = triggerDistances.length ? Math.min(...triggerDistances) : null;
      const marketDistance = latestKnownMarketPrice !== null ? Math.abs(clusterCenter - latestKnownMarketPrice) : null;
      const boardDistance = nearestTriggerDistance ?? marketDistance;
      const boardDistanceMode = nearestTriggerDistance !== null ? "alert" : "market";
      const tight5Count = clusterPrices.filter((price) => Math.abs(price - clusterCenter) <= 2.5).length;
      const tight10Count = clusterPrices.filter((price) => Math.abs(price - clusterCenter) <= 5).length;
      const tight20Count = clusterPrices.filter((price) => Math.abs(price - clusterCenter) <= 10).length;
      const precisionScore = clamp(clusterPrecisionFromWidth(entryStack.width || clusterWidth) + (has5mVpPrecision && has15mVpPrecision ? 8 : hasVpPrecision ? 4 : 0), 0, 100);
      const status = entryStack.width <= 6 ? "PINPOINT CONFLUENCE STACK" : clusterStatusFromWidth(clusterWidth);
      const stopPlans = buildStopPlansForCluster(zone.direction, clusterLow, clusterHigh, zoneCenter, clusterCenter, entryStack.low, entryStack.high);
      const reasons = [
        majorDeviation ? majorDeviation.label : null,
        hasDailyStdv ? "Daily STDV zone aligned" : null,
        has1HStdv ? "1H STDV aligned" : null,
        has4HStdv ? "4H STDV aligned" : null,
        hasPlaymaker ? "PlayMaker confluence" : null,
        hasOTE ? "OTE retracement" : null,
        hasVpPrecision ? `${has5mVpPrecision && has15mVpPrecision ? "5m + 15m" : has15mVpPrecision ? "15m" : has5mVpPrecision ? "5m" : "HTF"} volume-profile precision${hasPocPrecision ? " / POC" : ""}${hasLvnPrecision ? " / LVN-crater" : ""}` : null,
        hasWeekly && weekly ? `Weekly ${weekly.name || "level"} ${fmt(weekly.distance)} pts` : null,
        hasCrater && crater ? `${crater.inside ? "Inside" : "Near"} crater ${crater.name || "box"} ${fmt(crater.distance)} pts / ${fmt(crater.width)} wide` : null,
        hasHTFStructure ? "1H/4H OB/RB structure" : null,
        hasOnlyManualPillars ? "GATED: manual weekly/crater only — needs PlayMaker, STDV, OTE, VP, or HTF structure before A/A+" : null,
        sourceCount < 3 ? `GATED: only ${sourceCount} source(s) — needs 3+ for A/A+` : null,
        familyCount < 3 ? `GATED: only ${familyCount} source family/families — needs broader confirmation` : null,
        entryStack.count ? `Entry stack center ${fmtPrice(clusterCenter)} from ${entryStack.count} strongest confluence source(s)` : null,
        minorDeviation && !majorDeviation ? "Prior/minor deviation support" : null,
        hasDailyStdv ? "Daily level is treated as a reaction zone; precision still comes from nearby 1H/4H/5m/15m sources." : null,
        `Cluster ${fmt(clusterLow)}–${fmt(clusterHigh)} / width ${fmt(clusterWidth)} pts`,
        `${tight5Count} within 5 • ${tight10Count} within 10 • ${tight20Count} within 20`,
        boardDistanceMode === "alert" && nearestTriggerDistance !== null ? `Alert price ${fmt(nearestTriggerDistance)} pts away (old reading mode)` : (
          marketDistance !== null ? `Latest known price ${fmtPrice(latestKnownMarketPrice)} / ${fmt(marketDistance)} pts away` : "Limit can be far from current price"
        )
      ].filter(Boolean);
      const sortedEvidence = [...zone.evidence].sort((a, b) => n(b.evidenceScore) - n(a.evidenceScore));
      const createdTimes = sortedEvidence.map((item) => item.created_at).filter(Boolean).map((value) => new Date(value).getTime()).filter(Number.isFinite);
      const createdAt = createdTimes.length ? new Date(Math.min(...createdTimes)).toISOString() : zone.created_at;
      const updatedAt = createdTimes.length ? new Date(Math.max(...createdTimes)).toISOString() : zone.created_at;
      return { ...zone, precisionOnly, hasOnlyManualPillars, id: `level-${Math.round(clusterCenter)}-${zone.direction}`, label: `${zone.direction === "Both" ? "Long/Short" : zone.direction} cluster ${fmtPrice(clusterCenter)}`, sourceType: "Persistent Level Stack", price: clusterCenter, clusterCenter, clusterLow, clusterHigh, clusterWidth, clusterPrices, tight5Count, tight10Count, tight20Count, stopPlans, score, zoneScore: score, precisionScore, grade: zoneGrade, status, triggerDistance: nearestTriggerDistance, marketDistance, boardDistance, boardDistanceMode, latestKnownMarketPrice, weekly, crater, reasons, evidence: sortedEvidence, sourceCount, created_at: createdAt, updated_at: updatedAt, sourceId: Array.from(zone.sourceIds).join("|") || zone.sourceId, session: Array.from(zone.sessions).join(",") || "GLOBAL", signalName: `Stacked cluster ${fmtPrice(clusterCenter)}`, payload: { price: clusterCenter, cluster_center: clusterCenter, zone_center: zoneCenter, entry_stack_center: clusterCenter, entry_stack_low: entryStack.low, entry_stack_high: entryStack.high, entry_stack_width: entryStack.width, entry_stack_count: entryStack.count, entry_stack_labels: entryStack.labels, cluster_low: clusterLow, cluster_high: clusterHigh, cluster_width: clusterWidth, stop_plans: stopPlans, direction: zone.direction, zone_score: score, precision_score: precisionScore, market_distance: marketDistance, board_distance: boardDistance, board_distance_mode: boardDistanceMode, latest_known_price: latestKnownMarketPrice, evidence: sortedEvidence.map((item) => ({ label: item.label, price: item.price, sourceType: item.sourceType, score: item.evidenceScore, created_at: item.created_at })) } };
    }).filter((zone) => (
      zone.score >= 55 &&
      !zone.precisionOnly &&
      !zone.hasOnlyManualPillars
    ));

    const ordered = [...scored].sort((a, b) => {
      const aInRange = a.boardDistance === null || a.boardDistance <= maxOrderCardDistancePoints;
      const bInRange = b.boardDistance === null || b.boardDistance <= maxOrderCardDistancePoints;
      if (aInRange !== bInRange) return bInRange - aInRange;
      return b.score - a.score || b.precisionScore - a.precisionScore || (a.boardDistance ?? Infinity) - (b.boardDistance ?? Infinity);
    });

    const selected = [];
    const directionCounts = { Long: 0, Short: 0, Both: 0 };
    const baseBoardCardCap = 12;
    const maxBoardCardCap = 16;
    const baseDirectionCap = 5;
    const overflowDirectionCap = 7;
    for (const zone of ordered) {
      const duplicate = selected.some((item) => Math.abs(item.price - zone.price) <= levelMergeTolerance && (item.direction === zone.direction || item.direction === "Both" || zone.direction === "Both"));
      const dir = zone.direction === "Both" ? "Both" : zone.direction;
      const isOverflowSlot = selected.length >= baseBoardCardCap;
      const isStrongOverflow = zone.score >= 84 || (zone.score >= 74 && zone.precisionScore >= 80 && zone.sourceCount >= 4);
      const directionCap = isOverflowSlot ? overflowDirectionCap : baseDirectionCap;
      const underCap = dir === "Long" ? directionCounts.Long < directionCap : dir === "Short" ? directionCounts.Short < directionCap : directionCounts.Both < directionCap;
      if (isOverflowSlot && !isStrongOverflow) continue;
      if (!duplicate && underCap) {
        selected.push(zone);
        directionCounts[dir] += 1;
      }
      if (selected.length >= maxBoardCardCap) break;
    }
    return selected;
  }, [scannerAiSignals, weeklyLevels, craterBoxes, latestKnownMarketPrice]);

  const feedAudit = useMemo(() => {
    const evidence = scannerAiSignals.flatMap(buildLevelEvidenceCandidates);
    const count = (test) => evidence.filter(test).length;
    return [
      { name: "PlayMaker", count: count((e) => e.sourceType === "PlayMaker Confluence") },
      { name: "Session/STDV", count: count((e) => String(e.sourceType).includes("Deviation") || String(e.sourceType).includes("STDV")) },
      { name: "Retracements/OTE", count: count((e) => e.sourceType === "OTE Retracement") },
      { name: "Extensions", count: count((e) => ["1H STDV", "4H STDV", "Daily STDV"].includes(e.sourceType) && String(e.signalName).toUpperCase().includes("EXTENSION")) },
      { name: "Volume Profile", count: count((e) => String(e.sourceType).startsWith("Volume Profile")) },
      { name: "POC", count: count((e) => String(e.sourceType).includes("POC")) },
      { name: "LVN/Crater", count: count((e) => String(e.sourceType).includes("LVN") || String(e.sourceType).includes("Crater")) },
      { name: "OB/RB", count: count((e) => ["Order Block", "Rejection Block"].includes(e.sourceType)) },
      { name: "Weekly", count: weeklyLevels.length },
      { name: "Manual Craters", count: craterBoxes.length }
    ];
  }, [scannerAiSignals, weeklyLevels, craterBoxes]);

  const latestSignalRows = useMemo(() => {
    return aiSignals
      .slice(0, 10)
      .map((signal) => {
        const payload = getSignalPayload(signal);
        const price = parsePrice(firstDefined(payload.trigger_price, payload.price, payload.entry, payload.entry_price, signal.price));
        const signalName = String(payload.signal || signal.signal || "Signal").replace(/_/g, " ");
        const direction = String(payload.direction || signal.direction || "Both").toUpperCase();
        const createdAt = signal.created_at || payload.created_at;
        return {
          id: signal.id || `${signalName}-${createdAt}`,
          signalName,
          direction,
          price,
          createdAt,
          timeframe: timeframeFromPayload(payload, signalName) || String(payload.timeframe || signal.timeframe || "--"),
          status: isGenericPriceAlertSignal(signal) ? "Price alert" : "Level feed"
        };
      });
  }, [aiSignals]);

  const fetchManualLevelGrade = () => {
    const price = parsePrice(manualScanner.price);
    if (price === null) {
      alert("Enter a price first.");
      return;
    }

    const direction = manualScanner.direction || "Long";
    const bias4H = manualScanner.bias4H || "Bullish";
    const bias1H = manualScanner.bias1H || "Bullish";
    const desiredDirection = String(direction).toLowerCase();
    const directionBiasWord = desiredDirection.includes("short") ? "Bearish" : "Bullish";
    const biasAligned = [bias4H, bias1H].filter((bias) => bias === directionBiasWord).length;
    const mixedBias = bias4H !== bias1H;

    const allEvidence = [
      ...scannerAiSignals.flatMap(buildLevelEvidenceCandidates),
      ...weeklyLevels.map((level) => ({
        price: Number(level.price),
        direction: "Both",
        label: `Weekly ${level.name || "level"}`,
        sourceType: "Weekly Level",
        evidenceScore: 24
      })),
      ...craterBoxes.flatMap((box) => {
        const top = Number(box.top_price);
        const bottom = Number(box.bottom_price);
        if (!Number.isFinite(top) || !Number.isFinite(bottom) || top <= 0 || bottom <= 0 || top === bottom) return [];
        const high = Math.max(top, bottom);
        const low = Math.min(top, bottom);
        const mid = (high + low) / 2;
        const width = Math.abs(high - low);
        const inside = price <= high && price >= low;
        return [{
          price: inside ? price : mid,
          direction: "Both",
          label: `${box.name || "Crater"} ${inside ? "inside" : "mid"} ${fmt(width)} pts wide`,
          sourceType: "Volume Crater / LVN",
          evidenceScore: width >= 80 ? 30 : width >= 50 ? 24 : width >= 25 ? 17 : 11,
          width
        }];
      })
    ]
      .map((item) => ({ ...item, parsedPrice: parsePrice(item.price) }))
      .filter((item) => item.parsedPrice !== null)
      .filter((item) => {
        const itemDirection = String(item.direction || "Both").toLowerCase();
        return itemDirection === "both" || itemDirection.includes(desiredDirection);
      });

    const nearbyEntryWindow = allEvidence
      .map((item) => ({ ...item, fetchDistance: Math.abs(item.parsedPrice - price) }))
      .filter((item) => item.fetchDistance <= 20);

    const entryStack = nearbyEntryWindow.length
      ? findBestEntryStack(nearbyEntryWindow.map((item) => ({ ...item, price: item.parsedPrice })), price)
      : { center: price, low: price, high: price, width: 0, count: 0, labels: [] };
    const suggestedEntryRaw = roundToTick(entryStack.center);
    const suggestedEntry = clamp(Number(suggestedEntryRaw), price - 20, price + 20);

    const evidence = allEvidence
      .map((item) => ({
        ...item,
        distance: Math.abs(item.parsedPrice - suggestedEntry),
        fetchDistance: Math.abs(item.parsedPrice - price)
      }))
      .filter((item) => item.distance <= maxConfluenceDistancePoints)
      .sort((a, b) => a.distance - b.distance || Number(b.evidenceScore || 0) - Number(a.evidenceScore || 0));
    const entryEvidence = evidence.filter((item) => Math.abs(item.parsedPrice - suggestedEntry) <= 6).slice(0, 6);

    const nearest = (test) => evidence.find(test);
    const nearestWeekly = nearest((item) => item.sourceType === "Weekly Level");
    const nearestLvn = nearest((item) => String(item.sourceType).includes("LVN") || String(item.sourceType).includes("Crater"));
    const nearestPlaymaker = nearest((item) => item.sourceType === "PlayMaker Confluence");
    const nearestSession = nearest((item) => item.sourceType === "Major Session Deviation" || item.sourceType === "Session Deviation");
    const nearest1H = nearest((item) => String(item.sourceType).includes("1H STDV"));
    const nearest4H = nearest((item) => String(item.sourceType).includes("4H STDV") || String(item.sourceType).includes("Daily STDV"));
    const nearest15Retrace = nearest((item) => item.sourceType === "OTE Retracement" && String(item.label).includes("15m"));
    const nearest1HRetrace = nearest((item) => item.sourceType === "OTE Retracement" && String(item.label).includes("1H"));
    const nearest4HRetrace = nearest((item) => item.sourceType === "OTE Retracement" && (String(item.label).includes("4H") || String(item.label).includes("D")));
    const nearestOrderBlock = nearest((item) => item.sourceType === "Order Block");
    const nearestRejectionBlock = nearest((item) => item.sourceType === "Rejection Block");
    const nearestPoc = nearest((item) => String(item.sourceType).includes("POC"));
    const nearestVp = nearest((item) => String(item.sourceType).startsWith("Volume Profile"));

    setStartingLevel("");
    setSelectedTrade(null);
    setEditingId(null);
    setForm((prev) => ({
      ...prev,
      tradeEntryPrice: String(suggestedEntry),
      direction,
      bias4H,
      bias1H,
      trend: biasAligned === 2 ? "With Trend" : biasAligned === 0 ? "Against Trend" : "Neutral",
      prevWeekLevelOn: nearestWeekly ? "Yes" : "No",
      prevWeekLevelAway: nearestWeekly ? String(fmt(nearestWeekly.distance)) : prev.prevWeekLevelAway,
      lowVolumeNodeOn: nearestLvn ? "Yes" : "No",
      lowVolumeNodeWidth: nearestLvn?.width ? String(fmt(nearestLvn.width)) : prev.lowVolumeNodeWidth,
      lowVolumeNodeAway: nearestLvn ? String(fmt(nearestLvn.distance)) : prev.lowVolumeNodeAway,
      playMakerSignalOn: nearestPlaymaker ? "Yes" : "No",
      playMakerSignalAway: nearestPlaymaker ? String(fmt(nearestPlaymaker.distance)) : prev.playMakerSignalAway,
      prevSessionSTDVOn: nearestSession ? "Yes" : "No",
      prevSessionSTDVAway: nearestSession ? String(fmt(nearestSession.distance)) : prev.prevSessionSTDVAway,
      prevSessionSTDVValue: nearestSession ? String(Math.max(1, deviationAbsFromLabel(nearestSession.label) || 3)) : prev.prevSessionSTDVValue,
      oneHSTDVOn: nearest1H ? "Yes" : "No",
      oneHSTDVAway: nearest1H ? String(fmt(nearest1H.distance)) : prev.oneHSTDVAway,
      oneHSTDVValue: nearest1H ? String(Math.max(1, deviationAbsFromLabel(nearest1H.label) || 2)) : prev.oneHSTDVValue,
      fourHSTDVOn: nearest4H ? "Yes" : "No",
      fourHSTDVAway: nearest4H ? String(fmt(nearest4H.distance)) : prev.fourHSTDVAway,
      fourHSTDVValue: nearest4H ? String(Math.max(1, deviationAbsFromLabel(nearest4H.label) || 3)) : prev.fourHSTDVValue,
      retrace15mOn: nearest15Retrace ? "Yes" : "No",
      retrace15mAway: nearest15Retrace ? String(fmt(nearest15Retrace.distance)) : prev.retrace15mAway,
      retrace15mValue: nearest15Retrace ? normalizeRetrace(nearest15Retrace.label) : prev.retrace15mValue,
      retrace1HOn: nearest1HRetrace ? "Yes" : "No",
      retrace1HAway: nearest1HRetrace ? String(fmt(nearest1HRetrace.distance)) : prev.retrace1HAway,
      retrace1HValue: nearest1HRetrace ? normalizeRetrace(nearest1HRetrace.label) : prev.retrace1HValue,
      retrace4HOn: nearest4HRetrace ? "Yes" : "No",
      retrace4HAway: nearest4HRetrace ? String(fmt(nearest4HRetrace.distance)) : prev.retrace4HAway,
      retrace4HValue: nearest4HRetrace ? normalizeRetrace(nearest4HRetrace.label) : prev.retrace4HValue,
      orderBlockOn: nearestOrderBlock ? "Yes" : "No",
      orderBlockAway: nearestOrderBlock ? String(fmt(nearestOrderBlock.distance)) : prev.orderBlockAway,
      orderBlockTF: nearestOrderBlock ? (timeframeFromPayload(nearestOrderBlock.payload, nearestOrderBlock.label) || prev.orderBlockTF) : prev.orderBlockTF,
      rejectionBlockOn: nearestRejectionBlock ? "Yes" : "No",
      rejectionBlockAway: nearestRejectionBlock ? String(fmt(nearestRejectionBlock.distance)) : prev.rejectionBlockAway,
      rejectionBlockTF: nearestRejectionBlock ? (timeframeFromPayload(nearestRejectionBlock.payload, nearestRejectionBlock.label) || prev.rejectionBlockTF) : prev.rejectionBlockTF,
      ltfVolNodeOn: nearestVp ? "Yes" : "No",
      ltfVolNodeAway: nearestVp ? String(fmt(nearestVp.distance)) : prev.ltfVolNodeAway,
      liquidityOn: nearestPoc ? "Yes" : "No",
      notes: [
        `Manual scan ${direction} fetched at ${fmtPrice(price)}.`,
        `Suggested entry ${fmtPrice(suggestedEntry)} from strongest confluence stack inside 20 points.`,
        `4H ${bias4H}, 1H ${bias1H}${mixedBias ? " (mixed bias)" : ""}.`,
        evidence.length ? `Found ${evidence.length} source(s) near suggested entry.` : "No stored confluences found within 15 points of suggested entry."
      ].join(" ")
    }));

    setManualScannerResult({
      price,
      fetchedPrice: price,
      suggestedEntry,
      suggestedDistance: Math.abs(suggestedEntry - price),
      entryStack,
      entryEvidence,
      direction,
      bias4H,
      bias1H,
      evidence,
      biasAligned,
      message: evidence.length
        ? `Suggested ${fmtPrice(suggestedEntry)} from ${entryEvidence.length || evidence.length} source(s) inside the 20-point fetch window.`
        : `No stored confluence found near that range yet. Using fetched price ${fmtPrice(price)}.`
    });
    setTab("checklist");
  };

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
    if (selectedTrade?.stopPlans?.length) {
      return selectedTrade.stopPlans.map((plan) => ({
        stop: plan.stop,
        limit: plan.limit,
        stopArea: plan.stopArea,
        match: selectedTrade.signalName || "AI cluster center",
        confidence: plan.confidence || (plan.valid ? "Valid" : "Too Tight"),
        note: plan.note || (plan.valid ? "Cluster width supports this stop." : "This stop is too tight for the cluster width."),
        valid: plan.valid
      }));
    }

    const entry = n(form.tradeEntryPrice);
    const side = dirSide(form.direction);

    const priorityByStop = {
      7: ["ltfVolNode", "playMakerSignal", "fvg", "orderBlock", "rejectionBlock", "lowVolumeNode"],
      10: ["lowVolumeNode", "playMakerSignal", "prevWeekLevel", "prevSessionSTDV", "fourHSTDV", "ltfVolNode"],
      15: ["prevWeekLevel", "prevSessionSTDV", "fourHSTDV", "lowVolumeNode", "priorSessionSTDV", "liquidity"]
    };

    const active = report.rows
      .filter((r) => r.active && r.score > 0 && r.key !== "liquidity")
      .map((r) => ({ ...r, pullback: Math.abs(n(r.pointsAway)), signedPullback: n(r.pointsAway) }));

    return [7, 10, 15].map((stop) => {
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
  }, [report.rows, form.tradeEntryPrice, form.direction, selectedTrade]);

  const behavior = useMemo(() => {
    const closed = journal.filter((j) => isCompletedTradeResult(j));
    const wins = closed.filter((j) => normalizeStatus(j.result) === "win").length;
    const losses = closed.filter((j) => normalizeStatus(j.result) === "loss").length;
    const be = closed.filter((j) => normalizeStatus(j.result) === "be").length;
    const notesText = journal.map((j) => j.notes || "").join(" ").toLowerCase();
    let score = 5;
    if (closed.length >= 3 && wins > losses) score += 2;
    if (losses > wins) score -= 2;
    if (notesText.includes("chased") || notesText.includes("late")) score -= 1;
    if (notesText.includes("patient") || notesText.includes("followed")) score += 1;
    score = clamp(score, 0, 10);
    return { score, wins, losses, be, total: closed.length };
  }, [journal]);

  const filteredJournal = useMemo(() => filterJournalByDate(journal, journalFilter), [journal, journalFilter]);
  const journalStats = useMemo(() => calculateJournalStats(filteredJournal), [filteredJournal]);
  const globalJournalStats = useMemo(() => calculateJournalStats(globalJournal), [globalJournal]);
  const automaticSignalStats = globalJournalStats;

  const tips = useMemo(() => {
    const t = [];
    if (report.coreBonus > 0) t.push("Core setup is active: Previous Week Level + LVN + PlayMaker stack is your strongest base.");
    if (n(form.lowVolumeNodeWidth) >= 70 && isYes(form.lowVolumeNodeOn)) t.push("LVN is wide: reaction weight is high, but use LTF volume node or tighter confluence for limit precision.");
    if (startingLevel) t.push("Starting level selected. All other starting-level toggles are locked to prevent mixed anchors.");
    if (isYes(form.ltfVolNodeOn)) t.push("LTF volume node is active: use it to pinpoint the entry suggestion.");
    if (form.orderBlockState === "Fresh" && form.orderBlockTF === "5m") t.push("Fresh low timeframe OB should stay lower weight because the turn can happen before the block fully builds.");
    if (journal.some((j) => isOpenOrder(j))) t.push("You have unfilled orders showing on the front screen. Review them before market close or market open.");
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

const exportJournalCSV = (rowsToExport = filteredJournal) => {
  const headers = [
    "Date",
    "Direction",
    "Entry",
    "Grade",
    "Score",
    "Result",
    "Max Move",
    "200+ Move",
    "Max Drawdown",
    "Profit/Loss",
    "Discount Points",
    "Max Discount Points",
    "Notes"
  ];

  const rows = rowsToExport.map((j) => [
    j.date || "",
    j.direction || "",
    j.entry || "",
    j.grade || "",
    j.score || "",
    j.result || "",
    j.maxMove || "",
    n(j.maxMove) >= 200 ? "Yes" : "No",
    j.maxDrawdown || "",
    j.profitLoss || "",
    j.discountPoints || "",
    j.maxDiscountPoints || "",
   JSON.stringify(j.notes || "")
  ]);

  const csv = [
  headers.join(","),
  ...rows.map((r) => r.join(","))
].join("\n");
  const blob = new Blob([csv], {
    type: "text/csv"
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `playmaker-journal-${Date.now()}.csv`;
  link.click();
};

  const exportSetup = () => {
    const [gradeLabel, gradeName] = grade(report.score);
    const activeConfluences = report.rows.filter((r) => r.active);
    const money = form.profitLoss ? `$${form.profitLoss}` : "Not recorded";
    const reportLines = [
      "PLAYMAKER SETUP REPORT",
      "======================",
      "",
      `Exported: ${new Date().toLocaleString()}`,
      `Grade: ${gradeLabel} - ${gradeName}`,
      `Precision Score: ${Math.round(report.score)}`,
      `Zone Score: ${Math.round(report.zoneScore)}`,
      "",
      "TRADE INFO",
      "----------",
      `Entry Price: ${form.tradeEntryPrice || "Not entered"}`,
      `Direction: ${form.direction || "Not entered"}`,
      `1H Bias: ${form.bias1H || "Not entered"}`,
      `4H Bias: ${form.bias4H || "Not entered"}`,
      `Trend: ${form.trend || "Not entered"}`,
      "",
      "SUGGESTED PLANS",
      "---------------",
      ...(recommendations.length
        ? recommendations.map((plan) => {
            const limit = Number(plan.limit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const stopArea = Number(plan.stopArea).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return `${plan.stop} pt stop | Limit ${limit} | Stop ${stopArea} | ${plan.confidence} | ${plan.match}`;
          })
        : ["No plans available."]),
      "",
      "ACTIVE CONFLUENCES",
      "------------------",
      ...(activeConfluences.length
        ? activeConfluences.map((row) => {
            const pointsAway = Number(row.pointsAway || 0).toFixed(2);
            return `${row.name}: ${row.score} pts | ${pointsAway} points away`;
          })
        : ["No active confluences selected."]),
      "",
      "PLAYMAKER NOTES",
      "---------------",
      ...(tips.length ? tips : ["No extra notes for this setup."]),
      "",
      "RESULT",
      "------",
      `Result: ${form.result || "Not recorded"}`,
      `Max Move: ${form.maxMove || "Not recorded"}`,
      `Max Drawdown: ${form.maxDrawdown || "Not recorded"}`,
      `Profit / Loss: ${money}`,
      `Notes: ${form.notes || "None"}`,
      "",
      "This file is a readable report export. Use Print / Save PDF for a cleaner client-facing copy."
    ];

    const blob = new Blob([reportLines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `playmaker-setup-report-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printSetup = () => window.print();

  const makeJournalItem = (resultOverride = form.result, extra = {}) => {
    const normalizedResult = resultOverride === "Edge" || resultOverride === "Unfilled" ? "Unfilled" : resultOverride;
    const sourceType = extra.sourceType || selectedTrade?.sourceType || "Manual Order";
    const signalName = extra.signalName || selectedTrade?.signalName || selectedTrade?.signal || "";
    const baseNotes = form.notes || "";
    const discountText = [
      form.discountPoints ? `Discount: ${form.discountPoints} pts` : "",
      form.maxDiscountPoints ? `Max Discount: ${form.maxDiscountPoints} pts` : ""
    ].filter(Boolean).join(" • ");
    const rawNotes =
      sourceType === "AI Signal" && signalName && !baseNotes.includes(`AI Signal: ${signalName}`)
        ? `AI Signal: ${signalName}${baseNotes ? ` — ${baseNotes}` : ""}`
        : baseNotes;
    const notes = discountText && !String(rawNotes).includes("Discount:")
      ? `${rawNotes ? `${rawNotes} — ` : ""}${discountText}`
      : rawNotes;

    const isAiAnchor = sourceType === "AI Signal";
    const aiEvidence = selectedTrade?.evidence || selectedTrade?.rawSignal?.evidence || form.evidence || [];
    const aiPayload = selectedTrade?.rawSignal || form.aiPayload || null;
    const aiTop = selectedTrade?.top || selectedTrade?.signalName || signalName || "AI Level";

    return {
      id: extra.id || selectedTrade?.id || editingId || Date.now(),
      createdAt: extra.createdAt || selectedTrade?.createdAt || new Date().toISOString(),
      statsUpdatedAt: extra.statsUpdatedAt || selectedTrade?.statsUpdatedAt || selectedTrade?.verification?.statsUpdatedAt || null,
      date: extra.date || selectedTrade?.date || formatEastern(new Date()),
      direction: form.direction,
      entry: form.tradeEntryPrice,
      grade: isAiAnchor && selectedTrade?.grade ? selectedTrade.grade : grade(report.score)[0],
      score: isAiAnchor && selectedTrade?.score ? selectedTrade.score : report.score,
      result: normalizedResult,
      orderStatus: normalizedResult === "Unfilled" ? "Unfilled" : "Reported",
      pendingOrder: normalizedResult === "Unfilled",
      maxMove: form.maxMove,
      maxDrawdown: form.maxDrawdown,
      profitLoss: form.profitLoss,
      discountPoints: form.discountPoints,
      maxDiscountPoints: form.maxDiscountPoints,
      notes,
      tradeImages: form.tradeImages,
      top: isAiAnchor ? aiTop : report.active.slice(0, 4).map((r) => r.name).join(", "),
      sourceType,
      signal_id: extra.signal_id || selectedTrade?.signal_id || aiPayload?.id || "",
      verification: selectedTrade?.verification || verifiedAnchors[anchorVerificationKey(selectedTrade)] || null,
      journalScope: extra.journalScope || selectedTrade?.journalScope || journalScopeOf(selectedTrade),
      signalName,
      evidence: aiEvidence,
      rawSignal: aiPayload,
      formSnapshot: { ...form, evidence: aiEvidence, aiPayload }
    };
  };

  const tradePayload = (item) => {
    const journalScope = journalScopeOf(item);
    const verificationPayload = item.verification || journalScope
      ? { ...(item.verification || {}), ...(journalScope ? { journalScope } : {}) }
      : null;

    return {
    user_id: user.id,
    symbol: "NQ",
    direction: item.direction,
    entry_price: journalNumberOrNull(item.entry),
    grade: item.grade,
    score: item.score,
    zone_score: report.zoneScore || report.score,
    precision_score: report.precisionScore || report.score,
    result: item.result,
    max_move: journalNumberOrNull(item.maxMove),
    max_drawdown: journalNumberOrNull(item.maxDrawdown),
    profit_loss: journalNumberOrNull(item.profitLoss),
    notes: item.notes,
    confluences: item.evidence?.length ? item.evidence : report.active,
    recommendations,
    verification: verificationPayload,
    screenshots: item.tradeImages || []
    };
  };

  const clearTradeForm = () => {
    const next = getDefaultForm();
    next.tradeEntryPrice = "";
    next.prevWeekLevelOn = "No";
    next.lowVolumeNodeOn = "No";
    next.playMakerSignalOn = "No";
    next.prevSessionSTDVOn = "No";
    next.priorSessionSTDVOn = "No";
    next.oneHSTDVOn = "No";
    next.fourHSTDVOn = "No";
    next.retrace15mOn = "No";
    next.retrace1HOn = "No";
    next.retrace4HOn = "No";
    next.orderBlockOn = "No";
    next.rejectionBlockOn = "No";
    next.fvgOn = "No";
    next.prevHighLowOn = "No";
    next.ltfVolNodeOn = "No";
    next.liquidityOn = "No";
    next.result = "Unfilled";
    next.maxMove = "";
    next.maxDrawdown = "";
    next.profitLoss = "";
    next.discountPoints = "";
    next.maxDiscountPoints = "";
    next.notes = "";
    next.tradeImages = [];

    setForm(next);
    setStartingLevel("");
    setSelectedTrade(null);
    setEditingId(null);
  };

  const saveTradeToDatabase = async (item, updateExisting = false) => {
    if (!user) {
      alert("Please log in before saving a trade.");
      return item;
    }

    let savedItem = item;

    if (updateExisting && item.id) {
      const { error } = await supabase
        .from("trade_journal")
        .update(tradePayload(item))
        .eq("id", item.id)
        .eq("user_id", user.id);

      if (error) {
        console.error("Supabase update error:", error);
        alert("Trade updated locally, but database update failed.");
      }
    } else {
      const { data, error } = await supabase
        .from("trade_journal")
        .insert([tradePayload(item)])
        .select("id, created_at")
        .single();

      if (error) {
        console.error("Supabase save error:", error);
        alert("Trade saved locally, but database save failed.");
      } else if (data?.id) {
        savedItem = {
          ...item,
          id: data.id,
          date: data.created_at ? new Date(data.created_at).toLocaleDateString() : item.date
        };
      }
    }

    return savedItem;
  };

  const syncGlobalJournalAfterSave = (savedItem) => {
    const scope = journalScopeOf(savedItem);
    const notes = String(savedItem.notes || "").toLowerCase();
    const shouldShowGlobal =
      isCompletedTradeResult(savedItem) &&
      scope !== "local" &&
      (!scope || scope === "global") &&
      !(!scope && notes.includes("local journal"));

    const globalRow = shouldShowGlobal ? {
      id: savedItem.id || "",
      createdAt: savedItem.createdAt || null,
      statsUpdatedAt: savedItem.statsUpdatedAt || savedItem.verification?.statsUpdatedAt || new Date().toISOString(),
      result: savedItem.result || "",
      maxMove: savedItem.maxMove ?? "",
      maxDrawdown: savedItem.maxDrawdown ?? "",
      profitLoss: savedItem.profitLoss ?? "",
      verification: savedItem.verification || null,
      journalScope: savedItem.journalScope || savedItem.verification?.journalScope || ""
    } : null;

    setGlobalJournal((rows) => {
      const withoutOld = rows.filter((row) => String(row.id) !== String(savedItem.id));
      const next = (globalRow ? [globalRow, ...withoutOld] : withoutOld)
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .slice(0, 1000);
      try {
        window.localStorage.setItem(GLOBAL_JOURNAL_CACHE_KEY, JSON.stringify(next));
      } catch {
        // The live state is already updated; storage is only a fast reload cache.
      }
      return next;
    });
  };

  const saveTradeMemory = async (item) => {
    if (!user || isOpenOrder(item)) return;

    const { error } = await supabase.from("ai_trade_memory").insert([
      {
        user_id: user.id,
        source_type: item.sourceType || "Manual Order",
        signal_id: item.signal_id || null,
        symbol: "NQ",
        direction: item.direction,
        entry_price: journalNumberOrNull(item.entry),
        grade: item.grade,
        score: Number(item.score) || null,
        result: item.result,
        max_move: journalNumberOrNull(item.maxMove),
        max_drawdown: journalNumberOrNull(item.maxDrawdown),
        profit_loss: journalNumberOrNull(item.profitLoss),
        confluences: item.evidence?.length ? item.evidence : report.active,
        recommendations,
        notes: item.notes || null
      }
    ]);

    if (error) {
      console.error("AI trade memory save error:", error);
    }
  };

  const submitOrder = async () => {
    const item = makeJournalItem("Unfilled", {
      sourceType: selectedTrade?.sourceType || "Manual Order",
      signal_id: selectedTrade?.signal_id || selectedTrade?.rawSignal?.id || "",
      signalName: selectedTrade?.signalName || selectedTrade?.rawSignal?.signal || ""
    });
    const savedItem = await saveTradeToDatabase(item, false);

    setJournal((j) => {
      const withoutDuplicates = j.filter((x) => !sameTradeAnchor(x, savedItem));
      return [savedItem, ...withoutDuplicates];
    });

    clearTradeForm();
    setTab("trade");
  };

  const saveTrade = async () => {
    const statsUpdatedAt = new Date().toISOString();
    const isEditingExisting = Boolean(
      editingId &&
      selectedTrade?.id &&
      !String(selectedTrade.id).startsWith("reported-") &&
      !String(selectedTrade.id).startsWith("ai-") &&
      !String(selectedTrade.id).startsWith("zone-")
    );
    const normalizedResult = form.result === "Edge" || form.result === "Unfilled" ? "Unfilled" : form.result;
    const editEvidence = selectedTrade?.evidence || selectedTrade?.formSnapshot?.evidence || selectedTrade?.rawSignal?.evidence || [];
    const item = isEditingExisting
      ? {
        ...selectedTrade,
        id: selectedTrade.id,
        createdAt: selectedTrade.createdAt || selectedTrade.created_at || selectedTrade.date || new Date().toISOString(),
        date: selectedTrade.date || formatEastern(selectedTrade.createdAt || selectedTrade.created_at || new Date()),
        statsUpdatedAt,
        direction: selectedTrade.direction || form.direction,
        entry: selectedTrade.entry || form.tradeEntryPrice,
        grade: selectedTrade.grade || "",
        score: selectedTrade.score ?? 0,
        result: normalizedResult,
        orderStatus: normalizedResult === "Unfilled" ? "Unfilled" : "Reported",
        pendingOrder: normalizedResult === "Unfilled",
        maxMove: form.maxMove,
        maxDrawdown: form.maxDrawdown,
        profitLoss: form.profitLoss,
        discountPoints: form.discountPoints,
        maxDiscountPoints: form.maxDiscountPoints,
        notes: form.notes || "",
        tradeImages: form.tradeImages || [],
        top: selectedTrade.top || "",
        sourceType: selectedTrade.sourceType || "Manual Order",
        signal_id: selectedTrade.signal_id || selectedTrade.ai_signal_id || "",
        signalName: selectedTrade.signalName || selectedTrade.signal || "",
        evidence: editEvidence,
        rawSignal: selectedTrade.rawSignal || selectedTrade.aiPayload || null,
        verification: { ...(selectedTrade.verification || {}), statsUpdatedAt },
        journalScope: selectedTrade.journalScope || journalScopeOf(selectedTrade),
        formSnapshot: { ...(selectedTrade.formSnapshot || {}), ...form, evidence: editEvidence, aiPayload: selectedTrade.rawSignal || selectedTrade.formSnapshot?.aiPayload || null }
      }
      : makeJournalItem(form.result, { statsUpdatedAt });
    item.statsUpdatedAt = statsUpdatedAt;
    item.verification = { ...(item.verification || {}), statsUpdatedAt };
    const savedItem = await saveTradeToDatabase(item, isEditingExisting);

    if (!isEditingExisting) await saveTradeMemory(savedItem);

    setJournal((j) => {
      const withoutOldOpenCopies = j.filter((x) => String(x.id) !== String(savedItem.id) && !sameTradeAnchor(x, savedItem));

      // Closed/filled/reported orders stay in the Journal table, but they no longer qualify
      // for Active Trade Anchors because isOpenOrder() returns false for them.
      return [savedItem, ...withoutOldOpenCopies];
    });
    syncGlobalJournalAfterSave(savedItem);

    clearTradeForm();
    setTab("journal");
  };

  const editTrade = (item, options = {}) => {
    setSelectedTrade(item);
    setEditingId(item.id);

    const targetTab = options.targetTab || "journal";
    const savedFormValues = {
      direction: item.direction || "Long",
      tradeEntryPrice: item.entry || "",
      result: item.result || "Unfilled",
      maxMove: item.maxMove ?? "",
      maxDrawdown: item.maxDrawdown ?? "",
      profitLoss: item.profitLoss ?? "",
      discountPoints: item.discountPoints ?? "",
      maxDiscountPoints: item.maxDiscountPoints ?? "",
      notes: item.notes || "",
      tradeImages: item.tradeImages || []
    };

    if (item.formSnapshot) {
      const snapshot = item.formSnapshot || {};
      setForm({
        ...getDefaultForm(),
        ...snapshot,
        ...savedFormValues,
        evidence: snapshot.evidence || item.evidence || []
      });
    } else {
      setForm((f) => ({
        ...f,
        ...savedFormValues
      }));
    }

    setTab(targetTab);
    if (targetTab === "journal") {
      window.setTimeout(() => {
        const formCard = document.getElementById("journal-report-form");
        formCard?.scrollIntoView({ behavior: "smooth", block: "start" });
        formCard?.querySelector("select, input, textarea, button")?.focus?.();
      }, 120);
    }
  };

  const deleteJournalEntry = async (item) => {
    if (!item) return;
    const ok = window.confirm("Delete this journal entry?");
    if (!ok) return;

    suppressDiscordUntilRef.current = Date.now() + 5000;
    setJournal((prev) => prev.filter((row) => String(row.id) !== String(item.id)));

    if (editingId && String(editingId) === String(item.id)) {
      clearTradeForm();
    }

    if (user && item.id && !String(item.id).startsWith("reported-") && !String(item.id).startsWith("ai-") && !String(item.id).startsWith("zone-")) {
      const { error } = await supabase
        .from("trade_journal")
        .delete()
        .eq("id", item.id)
        .eq("user_id", user.id);

      if (error) {
        console.error("Journal delete error:", error);
        alert("Deleted from this screen, but Supabase delete failed.");
      }
    }
  };

  const closestWeeklyLevelToEntry = (entryPrice) => {
    const entry = parsePrice(entryPrice);
    if (entry === null || weeklyLevels.length === 0) return null;

    return weeklyLevels
      .map((level) => ({ ...level, distance: Math.abs(Number(level.price) - entry) }))
      .filter((level) => Number.isFinite(level.distance) && level.distance <= maxConfluenceDistancePoints)
      .sort((a, b) => a.distance - b.distance)[0] || null;
  };

  const closestCraterBoxToEntry = (entryPrice) => {
    const entry = parsePrice(entryPrice);
    if (entry === null || craterBoxes.length === 0) return null;

    return craterBoxes
      .map((box) => {
        const top = Number(box.top_price);
        const bottom = Number(box.bottom_price);
        if (!Number.isFinite(top) || !Number.isFinite(bottom) || top <= 0 || bottom <= 0 || top === bottom) return null;
        const high = Math.max(top, bottom);
        const low = Math.min(top, bottom);
        const mid = (high + low) / 2;
        const width = Math.abs(high - low);
        return { ...box, high, low, mid, width, distance: Math.abs(mid - entry) };
      })
      .filter((crater) => crater && crater.distance <= maxConfluenceDistancePoints)
      .sort((a, b) => a.distance - b.distance)[0] || null;
  };

  const buildFormFromAiSignal = (signal, fallbackForm) => {
    const payload = getSignalPayload(signal);
    const signalText = String(firstDefined(payload.signal, payload.side, payload.action, signal.signal, "AI Signal"));
    const lowerSignal = signalText.toLowerCase();
    const inferredDirection = normalizeDirection(firstDefined(payload.direction, payload.side, signal.direction), signalText);
    const entryValue = firstDefined(payload.entry, payload.entry_price, payload.price, payload.trigger_price, payload.close, payload.alert_price, signal.entry, fallbackForm.tradeEntryPrice, "");
    const nearestWeekly = closestWeeklyLevelToEntry(entryValue);
    const nearestCrater = closestCraterBoxToEntry(entryValue);

    const playMakerSignalOn = parseYesNo(firstDefined(payload.playmaker_signal, payload.playMakerSignal, payload.pm_signal, payload.signal_active));
    const liquidityOn = parseYesNo(firstDefined(payload.liquidity, payload.liquidity_on));
    const lvnPrice = parsePrice(firstDefined(payload.lvn, payload.low_volume_node, payload.lowVolumeNode, payload.volume_node));
    const ltfNodePrice = parsePrice(firstDefined(payload.ltf_vol_node, payload.ltf_volume_node, payload.ltfVolNode));
    const entryNumber = parsePrice(entryValue);

    const next = {
      ...fallbackForm,
      direction: inferredDirection,
      tradeEntryPrice: String(entryValue || ""),
      result: "Unfilled",
      maxMove: "",
      maxDrawdown: "",
      profitLoss: "",
      notes: `AI Signal: ${signalText}`,
      tradeImages: []
    };

    if (nearestWeekly) {
      next.prevWeekLevelOn = "Yes";
      next.prevWeekLevelAway = String(fmt(nearestWeekly.distance));
    }

    if (nearestCrater) {
      next.lowVolumeNodeOn = "Yes";
      next.lowVolumeNodeWidth = String(fmt(nearestCrater.width));
      next.lowVolumeNodeAway = String(fmt(nearestCrater.distance));
    } else if (entryNumber !== null && lvnPrice !== null) {
      next.lowVolumeNodeOn = "Yes";
      next.lowVolumeNodeAway = String(fmt(Math.abs(lvnPrice - entryNumber)));
    }

    if (playMakerSignalOn) next.playMakerSignalOn = playMakerSignalOn;
    if (liquidityOn) next.liquidityOn = liquidityOn;

    const prevSessionSTDV = firstDefined(payload.stdv_session, payload.session_stdv, payload.prev_session_stdv, payload.prevSessionSTDV);
    if (prevSessionSTDV !== undefined) {
      next.prevSessionSTDVOn = "Yes";
      next.prevSessionSTDVValue = normalizeSTDV(prevSessionSTDV);
      next.prevSessionSTDVAway = String(firstDefined(payload.prev_session_stdv_away, payload.stdv_session_away, "0"));
    }

    const oneHSTDV = firstDefined(payload.stdv_1h, payload.oneHSTDV, payload.one_h_stdv, payload.h1_fib_0705, payload.h1_fib_0618);
    if (oneHSTDV !== undefined) {
      next.oneHSTDVOn = "Yes";
      next.oneHSTDVValue = normalizeSTDV(oneHSTDV);
      next.oneHSTDVAway = String(firstDefined(payload.stdv_1h_away, payload.one_h_stdv_away, "0"));
    }

    const fourHSTDV = firstDefined(payload.stdv_4h, payload.fourHSTDV, payload.four_h_stdv, payload.h4_fib_0705, payload.h4_fib_0618);
    if (fourHSTDV !== undefined) {
      next.fourHSTDVOn = "Yes";
      next.fourHSTDVValue = normalizeSTDV(fourHSTDV);
      next.fourHSTDVAway = String(firstDefined(payload.stdv_4h_away, payload.four_h_stdv_away, "0"));
    }

    const fib15 = firstDefined(payload.fib_15m, payload.retrace_15m, payload.retrace15m, payload.fib_0705, payload.fib_0618);
    if (fib15 !== undefined) {
      next.retrace15mOn = "Yes";
      next.retrace15mValue = normalizeRetrace(fib15);
      next.retrace15mAway = String(firstDefined(payload.fib_15m_away, payload.retrace_15m_away, "0"));
    }

    const fib1h = firstDefined(payload.fib_1h, payload.retrace_1h, payload.retrace1H, payload.h1_fib_0705, payload.h1_fib_0618);
    if (fib1h !== undefined) {
      next.retrace1HOn = "Yes";
      next.retrace1HValue = normalizeRetrace(fib1h);
      next.retrace1HAway = String(firstDefined(payload.fib_1h_away, payload.retrace_1h_away, "0"));
    }

    const fib4h = firstDefined(payload.fib_4h, payload.retrace_4h, payload.retrace4H, payload.h4_fib_0705, payload.h4_fib_0618);
    if (fib4h !== undefined) {
      next.retrace4HOn = "Yes";
      next.retrace4HValue = normalizeRetrace(fib4h);
      next.retrace4HAway = String(firstDefined(payload.fib_4h_away, payload.retrace_4h_away, "0"));
    }

    if (entryNumber !== null && ltfNodePrice !== null) {
      next.ltfVolNodeOn = "Yes";
      next.ltfVolNodeAway = String(fmt(Math.abs(ltfNodePrice - entryNumber)));
    }

    return { next, signalText, inferredDirection, entryValue };
  };

  const selectAiSignal = (signal) => {
    const payload = getSignalPayload(signal);
    const { next, signalText, inferredDirection, entryValue } = buildFormFromAiSignal(signal, form);

    const item = {
      id: `ai-${signal.id || signal.created_at || Date.now()}`,
      date: formatEastern(signal.created_at || payload.created_at || new Date()),
      updatedAt: formatEastern(payload.updated_at || signal.updated_at || signal.created_at || payload.created_at || new Date()),
      direction: inferredDirection,
      entry: entryValue || "",
      clusterLow: payload.cluster_low,
      clusterHigh: payload.cluster_high,
      clusterWidth: payload.cluster_width,
      stopPlans: payload.stop_plans,
      grade: payload.ai_grade || "AI",
      score: payload.ai_score || payload.zone_score || 0,
      precisionScore: payload.precision_score || 0,
      zoneScore: payload.zone_score || payload.ai_score || 0,
      sourceCount: payload.source_count || payload.evidence?.length || 0,
      evidence: payload.evidence || [],
      result: "Unfilled",
      orderStatus: "Unfilled",
      pendingOrder: true,
      maxMove: "",
      maxDrawdown: "",
      profitLoss: "",
      notes: `AI Signal: ${signalText}`,
      tradeImages: [],
      top: signalText,
      sourceType: "AI Signal",
      signal_id: signal.id || "",
      signalName: signalText,
      formSnapshot: { ...next, evidence: payload.evidence || [], aiPayload: payload }
    };

    setSelectedTrade(item);
    setEditingId(null);
    setForm(next);
    if (next.playMakerSignalOn === "Yes") setStartingLevel("playMakerSignal");
    else setStartingLevel("");
    setTab("checklist");
  };

  const selectActiveAnchor = (anchor) => {
    if (anchor.sourceType === "AI Signal") {
      selectAiSignal(anchor.rawSignal || anchor);
    } else {
      editTrade(anchor, { targetTab: "checklist" });
    }
  };

  const anchorPriceKey = (value) => {
    const price = parsePrice(value);
    return price === null ? "NA" : String(Math.round(price * 4) / 4);
  };

  const anchorBaseKey = (anchor) => {
    const direction = String(anchor?.direction || "BOTH").toUpperCase();
    const price = anchor?.entry ?? anchor?.price ?? anchor?.rawSignal?.entry ?? anchor?.rawSignal?.price;
    return `${direction}|${anchorPriceKey(price)}`;
  };

  const anchorSubmitKey = (anchor) => {
    return `${anchorBaseKey(anchor)}|${String(anchor?.signal_id || anchor?.sourceId || anchor?.id || "")}`;
  };

  const zoneSubmitKey = (zone) => {
    return `${anchorBaseKey(zone)}|${String(zone?.sourceId || zone?.id || "")}`;
  };

  const anchorEvidenceSignature = (anchor) => {
    const evidence = Array.isArray(anchor?.evidence) ? anchor.evidence : Array.isArray(anchor?.payload?.evidence) ? anchor.payload.evidence : [];
    const sourceCount = Number(anchor?.sourceCount || evidence.length || 0);
    const score = Number(anchor?.score || anchor?.zoneScore || anchor?.payload?.zone_score || 0);
    const evidenceSig = evidence
      .map((item) => `${item.sourceType || ""}:${item.label || ""}:${anchorPriceKey(item.price)}`)
      .sort()
      .join("|");
    return { sourceCount, score, evidenceSig };
  };

  const submittedRecordForAnchor = (anchor) => {
    return submittedAnchorKeys[anchorSubmitKey(anchor)] || null;
  };

  const pulledRecordForAnchor = (anchor) => {
    const baseKey = anchorBaseKey(anchor);
    return pulledAnchorKeys[anchorSubmitKey(anchor)] || pulledAnchorKeys[`${baseKey}|`] || pulledAnchorKeys[baseKey] || null;
  };

  const clearAnchorTransientState = (anchor) => {
    if (!anchor) return;
    const submitKey = anchorSubmitKey(anchor);
    const baseKey = anchorBaseKey(anchor);
    const priceOnlyKey = `${baseKey}|`;

    setFilledAnchorKeys((prev) => {
      const next = { ...prev };
      delete next[baseKey];
      return next;
    });
    clearFilledBoardState(baseKey);

    setPulledAnchorKeys((prev) => {
      const next = { ...prev };
      delete next[submitKey];
      delete next[priceOnlyKey];
      delete next[baseKey];
      return next;
    });
  };

  const saveBoardState = async (anchorKey, patch) => {
    if (!anchorKey) return false;

    const allowedPatch = {};
    ["verified", "owner_note"].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        allowedPatch[key] = patch[key];
      }
    });

    const payload = {
      anchor_key: anchorKey,
      updated_by: user?.id || null,
      updated_at: new Date().toISOString(),
      ...allowedPatch
    };

    try {
      const { error } = await supabase
        .from("playmaker_board_state")
        .upsert([payload], { onConflict: "anchor_key" });

      if (error) {
        console.error("Playmaker board state save error:", error, payload);
        alert(`Board update did not save to Supabase: ${error.message || error}`);
        return false;
      }

      return true;
    } catch (err) {
      console.error("Playmaker board state save failed:", err, payload);
      alert(`Board update did not save to Supabase: ${err?.message || err}`);
      return false;
    }
  };

  const saveFilledBoardState = async (baseKey, record) => {
    if (!ownerMode || !baseKey) return false;
    return saveBoardState(`FILLED|${baseKey}`, {
      owner_note: record ? JSON.stringify({
        kind: "filled",
        filledAt: record.filledAt,
        detail: record.detail,
        anchorSnapshot: record.anchorSnapshot
      }) : null
    });
  };

  const clearFilledBoardState = async (baseKey) => {
    if (!ownerMode || !baseKey) return false;
    return saveFilledBoardState(baseKey, null);
  };

  const markAnchorHiddenNow = (anchor) => {
    if (!anchor) return;
    const submittedKey = anchorSubmitKey(anchor);
    const submittedBaseKey = anchorBaseKey(anchor);
    const priceOnlyKey = `${submittedBaseKey}|`;
    const submittedRecord = {
      submittedAt: new Date().toISOString(),
      ...anchorEvidenceSignature(anchor)
    };

    setSubmittedAnchorKeys((prev) => ({
      ...prev,
      [submittedKey]: submittedRecord,
      [priceOnlyKey]: submittedRecord
    }));

    setFilledAnchorKeys((prev) => {
      const next = { ...prev };
      delete next[submittedBaseKey];
      return next;
    });

    setPulledAnchorKeys((prev) => {
      const next = { ...prev };
      delete next[submittedKey];
      delete next[priceOnlyKey];
      delete next[submittedBaseKey];
      return next;
    });

    return { submittedKey, submittedBaseKey, priceOnlyKey, submittedRecord };
  };

  const hasMeaningfulNewInfo = (zone, submittedRecord) => {
    // Do not let a just-submitted/reported setup immediately rebuild itself.
    // Same price + same direction stays hidden unless it becomes materially stronger.
    if (!submittedRecord || submittedRecord === true) return false;
    const sig = anchorEvidenceSignature(zone);
    const oldSourceCount = Number(submittedRecord.sourceCount || 0);
    const oldScore = Number(submittedRecord.score || 0);
    const submittedAt = submittedRecord.submittedAt ? new Date(submittedRecord.submittedAt).getTime() : Date.now();
    const minutesSinceSubmit = (Date.now() - submittedAt) / 60000;
    if (minutesSinceSubmit < 30) return false;
    return sig.sourceCount >= oldSourceCount + 2 && sig.score >= oldScore + 10;
  };

  const hasPulledCardComeBack = (zone, pulledRecord) => {
    if (!pulledRecord || pulledRecord === true) return false;
    const sig = anchorEvidenceSignature(zone);
    const oldSourceCount = Number(pulledRecord.sourceCount || 0);
    const oldScore = Number(pulledRecord.score || 0);
    const pulledAt = pulledRecord.pulledAt ? new Date(pulledRecord.pulledAt).getTime() : Date.now();
    const minutesSincePull = (Date.now() - pulledAt) / 60000;

    // A pulled card is a temporary hide. Keep it quiet right away, but let it
    // return later if the level still qualifies and the stack improved.
    if (minutesSincePull < 60) return false;
    return sig.sourceCount >= oldSourceCount + 1 || sig.score >= oldScore + 5;
  };

  const submittedZoneMatches = (zone) => {
    const submittedRecord = submittedRecordForAnchor(zone);
    if (submittedRecord && !hasMeaningfulNewInfo(zone, submittedRecord)) return true;
    if (!ownerMode) return false;

    return journal.some((j) => {
      if (isOpenOrder(j)) return false;
      const journalSignalId = String(j.signal_id || j.ai_signal_id || "");
      return journalSignalId && String(zone?.sourceId || "").includes(journalSignalId);
    });
  };

  const pulledZoneMatches = (zone) => {
    const pulledRecord = pulledRecordForAnchor(zone);
    if (!pulledRecord) return false;
    if (hasPulledCardComeBack(zone, pulledRecord)) return false;
    return true;
  };

  const markAnchorFilled = async (anchor) => {
    if (!anchor) return;
    const key = anchorBaseKey(anchor);
    const isManualFilledAnchor = isManualOrder(anchor);
    const entryValue = anchor.entry ?? anchor.price ?? anchor.rawSignal?.entry ?? anchor.rawSignal?.price ?? "";
    const directionValue = anchor.direction || anchor.rawSignal?.direction || "Both";
    const detail = `${String(directionValue || "BOTH").toUpperCase()} ${fmtPrice(entryValue)} • marked filled • stays on board until journaled • ${formatEastern(new Date())}`;

    // Store the FULL order card, not just a filled flag.
    // This pins the exact setup on the board even if the scanner rebuilds, refreshes,
    // or the live confluence list temporarily changes. It only leaves after journal/report.
    const anchorSnapshot = {
      ...anchor,
      id: anchor.id || `filled-${key}-${Date.now()}`,
      entry: entryValue,
      price: entryValue,
      direction: directionValue,
      result: "Unfilled",
      orderStatus: "Filled - Journal Needed",
      pendingOrder: true,
      filledLocked: true,
      filledAt: new Date().toISOString(),
      sourceType: anchor.sourceType || (isManualFilledAnchor ? "Manual Order" : "AI Signal"),
      rawSignal: anchor.rawSignal || anchor.payload || {},
      evidence: anchor.evidence || anchor.rawSignal?.evidence || anchor.payload?.evidence || []
    };

    const filledRecord = {
      filledAt: new Date().toISOString(),
      detail,
      anchorSnapshot
    };

    setFilledAnchorKeys((prev) => ({
      ...prev,
      [key]: filledRecord
    }));
    if (!isManualFilledAnchor) {
      await saveFilledBoardState(key, filledRecord);
    }
    setNotificationLog((prev) => [{
      key: `FILLED-${key}-${Date.now()}`,
      kind: "FILLED",
      title: isManualFilledAnchor ? "Manual trade moved to managing" : "Playmaker setup filled",
      detail,
      createdAt: new Date().toISOString()
    }, ...prev].slice(0, 50));
    if (!isManualFilledAnchor) {
      notifyPlaymaker("Playmaker setup filled", detail, "play maker setup filled");
      sendDiscordBoardNotice({ event: "FILLED", title: "Playmaker Signal Filled", detail, anchor: anchorSnapshot });
    }
  };

  const dismissAnchorFromBoard = async (anchor) => {
    if (!anchor) return;
    if (isManualOrder(anchor)) {
      setJournal((prev) => prev.filter((item) => String(item.id) !== String(anchor.id)));
      if (user && anchor.id && !String(anchor.id).startsWith("reported-") && !String(anchor.id).startsWith("ai-") && !String(anchor.id).startsWith("zone-")) {
        try {
          await supabase
            .from("trade_journal")
            .update({ result: "Cancelled" })
            .eq("id", anchor.id)
            .eq("user_id", user.id);
        } catch (err) {
          console.error("Manual order remove error:", err);
        }
      }

      const detail = `${String(anchor.direction || "BOTH").toUpperCase()} ${fmtPrice(anchor.entry || anchor.price)} - manual order removed locally - ${formatEastern(new Date())}`;
      setNotificationLog((prev) => [{
        key: `MANUAL-REMOVED-${anchorSubmitKey(anchor)}-${Date.now()}`,
        kind: "MANUAL_REMOVED",
        title: "Manual order removed",
        detail,
        createdAt: new Date().toISOString()
      }, ...prev].slice(0, 50));
      return;
    }

    const pulledKey = anchorSubmitKey(anchor);
    const pulledBaseKey = anchorBaseKey(anchor);
    const priceOnlyKey = `${pulledBaseKey}|`;
    const pulledRecord = {
      pulledAt: new Date().toISOString(),
      anchorSnapshot: {
        ...anchor,
        pulled: true,
        pulledAt: new Date().toISOString()
      },
      ...anchorEvidenceSignature(anchor)
    };

    setPulledAnchorKeys((prev) => ({
      ...prev,
      [pulledKey]: pulledRecord,
      [priceOnlyKey]: pulledRecord
    }));

    const pulledDetail = `${String(anchor.direction || "BOTH").toUpperCase()} ${fmtPrice(anchor.entry || anchor.price)} - pulled from board - saved in Pulled Orders - ${formatEastern(new Date())}`;
    setNotificationLog((prev) => [{
      key: `PULLED-${pulledKey}-${Date.now()}`,
      kind: "PULLED",
      title: "Playmaker setup pulled",
      detail: pulledDetail,
      createdAt: new Date().toISOString()
    }, ...prev].slice(0, 50));
    notifyPlaymaker("Playmaker setup pulled", pulledDetail, "play maker set up pulled");
    sendDiscordBoardNotice({ event: "PULLED", title: "Playmaker Signal Pulled", detail: pulledDetail, anchor });
    return;

    const hidden = markAnchorHiddenNow(anchor);
    const submittedKey = hidden?.submittedKey || anchorSubmitKey(anchor);

    // Manual orders live in the journal table as open orders. Removing from board
    // must also remove/close that local row so it does not keep showing as a manual order.
    if (anchor.sourceType !== "AI Signal") {
      setJournal((prev) => prev.filter((item) => String(item.id) !== String(anchor.id)));
      if (user && anchor.id && !String(anchor.id).startsWith("reported-") && !String(anchor.id).startsWith("ai-") && !String(anchor.id).startsWith("zone-")) {
        try {
          await supabase
            .from("trade_journal")
            .update({ result: "Cancelled" })
            .eq("id", anchor.id)
            .eq("user_id", user.id);
        } catch (err) {
          console.error("Manual order remove error:", err);
        }
      }
    }

    const detail = `${String(anchor.direction || "BOTH").toUpperCase()} ${fmtPrice(anchor.entry || anchor.price)} • removed from board • ${formatEastern(new Date())}`;
    setNotificationLog((prev) => [{
      key: `DISMISSED-${submittedKey}-${Date.now()}`,
      kind: "DISMISSED",
      title: "Playmaker setup removed",
      detail,
      createdAt: new Date().toISOString()
    }, ...prev].slice(0, 50));
    notifyPlaymaker("Playmaker setup removed", detail, "play maker set up removed");
    sendDiscordBoardNotice({ event: "REMOVED", title: "Playmaker Signal Removed", detail, anchor });
  };

  const restorePulledAnchor = (anchor) => {
    clearAnchorTransientState(anchor);
    const detail = `${String(anchor.direction || "BOTH").toUpperCase()} ${fmtPrice(anchor.entry || anchor.price)} - restored to board - ${formatEastern(new Date())}`;
    setNotificationLog((prev) => [{
      key: `RESTORED-${anchorSubmitKey(anchor)}-${Date.now()}`,
      kind: "RESTORED",
      title: "Playmaker setup restored",
      detail,
      createdAt: new Date().toISOString()
    }, ...prev].slice(0, 50));
  };

  const deletePulledAnchor = (anchor) => {
    clearAnchorTransientState(anchor);
  };

  const restoreHiddenAiCards = () => {
    if (!ownerMode) return;
    setSubmittedAnchorKeys({});
    setPulledAnchorKeys({});
    setFilledAnchorKeys({});
    setNotificationLog((prev) => [{
      key: `RESTORE-HIDDEN-${Date.now()}`,
      kind: "RESTORED",
      title: "Hidden AI cards restored",
      detail: `Pulled, filled, and submitted board-hide memory cleared - ${formatEastern(new Date())}`,
      createdAt: new Date().toISOString()
    }, ...prev].slice(0, 50));
  };

  const restorePulledAiCards = () => {
    if (!ownerMode) return;
    setPulledAnchorKeys({});
    setNotificationLog((prev) => [{
      key: `RESTORE-PULLED-${Date.now()}`,
      kind: "RESTORED",
      title: "Pulled AI cards restored",
      detail: `Pulled board memory cleared - ${formatEastern(new Date())}`,
      createdAt: new Date().toISOString()
    }, ...prev].slice(0, 50));
  };

  const submitAnchorToJournal = async (anchor, scope = "global") => {
    if (!anchor) return;
    const isGlobalSubmit = scope === "global";

    // Owner board actions hide cards; member local journal saves should not
    // change which shared signal cards are visible.
    const hidden = ownerMode ? markAnchorHiddenNow(anchor) : null;

    const payload = anchor.rawSignal || anchor.payload || {};
    const entryValue = anchor.entry || anchor.price || payload.entry || payload.price || "";
    const directionValue = anchor.direction || payload.direction || "Both";
    const isManualSubmit = isManualOrder(anchor);
    const signalName = anchor.signalName || payload.signal || (isManualSubmit ? "Manual Trade" : "AI Level");
    const verification = getAnchorVerification(anchor);
    const submitNotes = isManualSubmit
      ? `Manual Trade: ${String(directionValue || "BOTH").toUpperCase()} ${fmtPrice(entryValue)}`
      : (verification?.ownerNote
        ? `AI Signal: ${signalName} - Owner Note: ${verification.ownerNote}`
        : `AI Signal: ${signalName}`);

    const item = {
      id: `reported-${anchor.id || Date.now()}`,
      date: formatEastern(new Date()),
      direction: directionValue,
      entry: entryValue,
      grade: anchor.grade || payload.ai_grade || (isManualSubmit ? "Manual" : "AI"),
      score: anchor.score || payload.ai_score || payload.zone_score || 0,
      result: "Reported",
      orderStatus: "Reported",
      pendingOrder: false,
      maxMove: "",
      maxDrawdown: "",
      profitLoss: "",
      notes: submitNotes,
      tradeImages: [],
      top: anchor.top || signalName,
      sourceType: anchor.sourceType || "AI Signal",
      signal_id: anchor.signal_id || payload.id || "",
      verification: { ...(verification || {}), journalScope: scope },
      journalScope: scope,
      signalName,
      evidence: anchor.evidence || payload.evidence || [],
      rawSignal: payload,
      formSnapshot: {
        ...form,
        tradeEntryPrice: String(entryValue || ""),
        direction: directionValue,
        result: "Reported",
        notes: verification?.ownerNote || "",
        evidence: anchor.evidence || payload.evidence || [],
        aiPayload: payload
      }
    };

    const savedItem = await saveTradeToDatabase(item, false);

    setJournal((j) => {
      const withoutDuplicates = j.filter((x) => !sameTradeAnchor(x, savedItem));
      return [savedItem, ...withoutDuplicates];
    });

    const submittedKey = hidden?.submittedKey || anchorSubmitKey(anchor);

    const detail = `${String(directionValue || "BOTH").toUpperCase()} ${fmtPrice(entryValue)} • Grade ${item.grade} • Sources ${anchor.sourceCount || anchor.evidence?.length || 0} • submitted to journal • ${formatEastern(new Date())}`;
    setNotificationLog((prev) => [{
      key: `SUBMITTED-${submittedKey}-${Date.now()}`,
      kind: "SUBMITTED",
      title: "Playmaker setup submitted",
      detail,
      createdAt: new Date().toISOString()
    }, ...prev].slice(0, 50));
    notifyPlaymaker("Playmaker setup submitted", detail, "play maker setup submitted");
    if (isGlobalSubmit) {
      sendDiscordBoardNotice({ event: "SUBMITTED", title: "Playmaker Signal Submitted", detail, anchor: item });
    }

    setSelectedTrade(null);
    clearTradeForm();
    setTab("journal");
  };

  const anchorVerificationKey = (anchor) => anchorBaseKey(anchor);

  const anchorVerificationKeys = (anchor) => {
    const baseKey = anchorBaseKey(anchor);
    const legacyKey = String(anchor?.signal_id || anchor?.sourceId || anchor?.id || anchor?.entry || "").trim();
    const submitKey = anchorSubmitKey(anchor);
    return Array.from(new Set([
      baseKey,
      `${baseKey}|`,
      submitKey,
      legacyKey
    ].filter(Boolean)));
  };

  const getAnchorVerification = (anchor) => {
    if (!anchor) return null;
    for (const key of anchorVerificationKeys(anchor)) {
      if (verifiedAnchors[key]) return verifiedAnchors[key];
      if (ownerSignalNotes[key]) return ownerSignalNotes[key];
    }
    return anchor.verification || null;
  };

  const verifyAnchor = async (anchor, ownerNote = "") => {
    if (!ownerMode || !anchor) return;
    const keys = anchorVerificationKeys(anchor);
    if (!keys.length) return;

    const existingVerification = getAnchorVerification(anchor);
    const wasAlreadyVerified = Boolean(existingVerification?.verified);
    const direction = String(anchor.direction || "Both").toUpperCase();
    const verification = {
      verified: true,
      verifiedBy: "Mr. DJ Harrison",
      label: `Mr. DJ Harrison Verified ${direction}`,
      direction,
      verifiedAt: existingVerification?.verifiedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerNote: String(ownerNote || "").trim()
    };

    setVerifiedAnchors((prev) => ({
      ...prev,
      ...Object.fromEntries(keys.map((key) => [key, verification]))
    }));
    setOwnerSignalNotes((prev) => ({
      ...prev,
      ...Object.fromEntries(keys.map((key) => [key, verification]))
    }));

    await Promise.all(keys.map((key) => saveBoardState(key, {
      status: "active",
      verified: true,
      owner_note: verification.ownerNote,
      removed: false,
      submitted: false
    })));

    const detail = `${direction} ${fmtPrice(anchor.entry || anchor.price)} - ${wasAlreadyVerified ? "verification note updated" : "verified by Mr. DJ Harrison"}${verification.ownerNote ? ` - ${verification.ownerNote}` : ""} - ${formatEastern(new Date())}`;
    sendDiscordBoardNotice({
      event: wasAlreadyVerified ? "NOTE_UPDATED" : "VERIFIED",
      title: wasAlreadyVerified ? "Playmaker Signal Note Updated" : "Playmaker Signal Verified",
      detail,
      anchor: { ...anchor, verification }
    });
  };

  const removeAnchorVerification = async (anchor) => {
    if (!ownerMode || !anchor) return;
    const keys = anchorVerificationKeys(anchor);

    setVerifiedAnchors((prev) => {
      const next = { ...prev };
      keys.forEach((key) => delete next[key]);
      return next;
    });
    setOwnerSignalNotes((prev) => {
      const next = { ...prev };
      keys.forEach((key) => delete next[key]);
      return next;
    });

    await Promise.all(keys.map((key) => saveBoardState(key, {
      verified: false,
      owner_note: null
    })));

    const detail = `${String(anchor.direction || "BOTH").toUpperCase()} ${fmtPrice(anchor.entry || anchor.price)} - verification removed - ${formatEastern(new Date())}`;
    sendDiscordBoardNotice({ event: "UNVERIFIED", title: "Playmaker Signal Verification Removed", detail, anchor });
  };

  const [manualLetter, manualText] = grade(report.score);
  const selectedAiScore = selectedTrade?.sourceType === "AI Signal" ? n(selectedTrade.score || selectedTrade.rawSignal?.ai_score || selectedTrade.rawSignal?.zone_score, 0) : 0;
  const selectedAiPrecision = selectedTrade?.sourceType === "AI Signal" ? n(selectedTrade.precisionScore || selectedTrade.rawSignal?.precision_score, 0) : 0;
  const letter = selectedTrade?.sourceType === "AI Signal" && selectedAiScore ? (selectedTrade.grade || selectedTrade.rawSignal?.ai_grade || grade(selectedAiScore)[0]) : manualLetter;
  const text = selectedTrade?.sourceType === "AI Signal" && selectedAiScore ? "AI Level / Limit Anchor" : manualText;
  const displayScore = selectedTrade?.sourceType === "AI Signal" && selectedAiScore ? selectedAiScore : report.score;
  const displayPrecision = selectedTrade?.sourceType === "AI Signal" && selectedAiPrecision ? selectedAiPrecision : report.score;
  const unfilledOrders = journal.filter((j) => isOpenOrder(j));
  const manualUnfilledOrders = unfilledOrders.filter((order) => isManualOrder(order));
  const signalUnfilledOrders = unfilledOrders.filter((order) => !isManualOrder(order));

  const manualManagingOrders = manualUnfilledOrders
    .filter((order) => !submittedRecordForAnchor(order))
    .filter((order) => !pulledRecordForAnchor(order))
    .map((order) => ({
      ...order,
      sourceType: order.sourceType || "Manual Order",
      orderStatus: order.orderStatus === "Unfilled" ? "Filled - Journal Needed" : order.orderStatus,
      filledLocked: true,
      filledAt: order.filledAt || order.createdAt || order.date || new Date().toISOString()
    }));

  const boardUnfilledOrders = (ownerMode ? signalUnfilledOrders : [])
    .filter((order) => !submittedRecordForAnchor(order))
    .filter((order) => !pulledRecordForAnchor(order));

  const filledPinnedAnchors = Object.values(filledAnchorKeys)
    .map((record) => record?.anchorSnapshot)
    .filter(Boolean)
    .filter((anchor) => !submittedRecordForAnchor(anchor))
    .filter((anchor) => !pulledRecordForAnchor(anchor));

  const pulledAnchors = Object.values(pulledAnchorKeys)
    .map((record) => record?.anchorSnapshot)
    .filter(Boolean)
    .filter((anchor) => !isManualOrder(anchor))
    .reduce((acc, anchor) => {
      const key = anchorSubmitKey(anchor);
      if (!acc.some((item) => anchorSubmitKey(item) === key)) acc.push(anchor);
      return acc;
    }, [])
    .filter((anchor) => !submittedRecordForAnchor(anchor));

  const anchorMarketDistance = (anchor) => {
    if (latestKnownMarketPrice === null) return null;
    const price = parsePrice(anchor.entry || anchor.price);
    return price === null ? null : Math.abs(price - latestKnownMarketPrice);
  };

  const isInLatestMarketRange = (anchor) => {
    const distance = anchor.boardDistance ?? anchor.triggerDistance ?? anchorMarketDistance(anchor);
    return distance === null || distance <= maxOrderCardDistancePoints;
  };

  const rawActiveAnchors = [
    ...boardUnfilledOrders
      .filter(isInLatestMarketRange)
      .filter((order) => !filledPinnedAnchors.some((filled) => anchorBaseKey(filled) === anchorBaseKey(order)))
      .map((order) => ({
      ...order,
      sourceType: order.sourceType || "Manual Order"
    })),
    ...rankedAiLimitZones
      .filter(isInLatestMarketRange)
      .filter((zone) => !submittedZoneMatches(zone))
      .filter((zone) => !pulledZoneMatches(zone))
      .filter((zone) => !filledPinnedAnchors.some((filled) => {
        const filledPrice = parsePrice(filled.entry || filled.price);
        const sameDirection = String(filled.direction || "").toLowerCase() === String(zone.direction || "").toLowerCase() || zone.direction === "Both";
        return filledPrice !== null && sameDirection && Math.abs(filledPrice - zone.price) <= Math.max(2, Math.min(levelMergeTolerance, zone.clusterWidth || levelMergeTolerance));
      }))
      .filter((zone) => !signalUnfilledOrders.some((order) => {
        const orderEntry = parsePrice(order.entry || order.entry_price);
        const sameDirection = String(order.direction || "").toLowerCase() === String(zone.direction || "").toLowerCase() || zone.direction === "Both";
        const entryMatches = orderEntry !== null && Math.abs(orderEntry - zone.price) <= Math.max(2, Math.min(levelMergeTolerance, zone.clusterWidth || levelMergeTolerance));
        const orderSignalId = String(order.signal_id || order.ai_signal_id || "");
        const signalMatches = orderSignalId && String(zone.sourceId || "").includes(orderSignalId);
        return sameDirection && (entryMatches || signalMatches);
      }))
      .map((zone) => ({
      id: `zone-${zone.sourceId}-${zone.session}-${zone.direction}-${zone.price}`,
      date: formatEastern(zone.created_at),
      updatedAt: formatEastern(zone.updated_at || zone.created_at),
      direction: zone.direction,
      entry: zone.price,
      clusterLow: zone.clusterLow,
      clusterHigh: zone.clusterHigh,
      clusterWidth: zone.clusterWidth,
      stopPlans: zone.stopPlans,
      grade: zone.grade,
      score: zone.score,
      precisionScore: zone.precisionScore,
      zoneScore: zone.zoneScore || zone.score,
      sourceCount: zone.sourceCount || zone.evidence?.length || 0,
      evidence: zone.evidence || [],
      verification: getAnchorVerification(zone) || verifiedAnchors[String(zone.sourceId || "")] || verifiedAnchors[`zone-${zone.sourceId}-${zone.session}-${zone.direction}-${zone.price}`] || null,
      result: "Unfilled",
      orderStatus: zone.status,
      pendingOrder: true,
      maxMove: "",
      maxDrawdown: "",
      profitLoss: "",
      notes: `${zone.status}: ${zone.label} — ${zone.reasons.join(" • ")}`,
      tradeImages: [],
      top: `Center ${fmtPrice(zone.price)} • Width ${fmt(zone.clusterWidth)} pts • ${zone.reasons.join(" • ")}`,
      sourceType: "AI Signal",
      signal_id: zone.sourceId || "",
      signalName: zone.label,
      rawSignal: {
        ...zone.payload,
        id: zone.sourceId,
        signal: zone.label,
        direction: zone.direction,
        price: zone.price,
        entry: zone.price,
        cluster_center: zone.clusterCenter,
        cluster_low: zone.clusterLow,
        cluster_high: zone.clusterHigh,
        cluster_width: zone.clusterWidth,
        stop_plans: zone.stopPlans,
        trigger_price: zone.triggerPrice,
        ai_grade: zone.grade,
        ai_score: zone.score,
        zone_score: zone.zoneScore || zone.score,
        precision_score: zone.precisionScore || 0,
        ai_status: zone.status,
        confluence_reasons: zone.reasons,
        evidence: zone.evidence || [],
        source_count: zone.sourceCount || zone.evidence?.length || 0,
        created_eastern: formatEastern(zone.created_at),
        updated_eastern: formatEastern(zone.updated_at || zone.created_at)
      }
    }))
  ];

  const outOfRangeAiAnchors = rankedAiLimitZones
    .filter((zone) => !isInLatestMarketRange(zone))
    .filter((zone) => !submittedZoneMatches(zone))
    .filter((zone) => !pulledZoneMatches(zone))
    .map((zone) => ({
      id: `out-of-range-${zone.sourceId}-${zone.session}-${zone.direction}-${zone.price}`,
      date: formatEastern(zone.created_at),
      updatedAt: formatEastern(zone.updated_at || zone.created_at),
      direction: zone.direction,
      entry: zone.price,
      clusterLow: zone.clusterLow,
      clusterHigh: zone.clusterHigh,
      clusterWidth: zone.clusterWidth,
      stopPlans: zone.stopPlans,
      grade: zone.grade,
      score: zone.score,
      precisionScore: zone.precisionScore,
      zoneScore: zone.zoneScore || zone.score,
      sourceCount: zone.sourceCount || zone.evidence?.length || 0,
      evidence: zone.evidence || [],
      verification: getAnchorVerification(zone) || verifiedAnchors[String(zone.sourceId || "")] || verifiedAnchors[`zone-${zone.sourceId}-${zone.session}-${zone.direction}-${zone.price}`] || null,
      result: "Unfilled",
      orderStatus: "OUT OF RANGE / WAITING",
      pendingOrder: true,
      maxMove: "",
      maxDrawdown: "",
      profitLoss: "",
      notes: `Waiting for price to return within ${maxOrderCardDistancePoints.toLocaleString()} pts. ${zone.boardDistanceMode === "alert" ? "Using old alert-led reading mode." : `Latest known price ${fmtPrice(latestKnownMarketPrice)}.`} Distance ${fmt(zone.boardDistance ?? zone.marketDistance ?? 0)} pts.`,
      tradeImages: [],
      top: `Waiting board - Center ${fmtPrice(zone.price)} - ${fmt(zone.boardDistance ?? zone.marketDistance ?? 0)} pts by ${zone.boardDistanceMode === "market" ? "market" : "alert"} distance - ${zone.reasons.join(" - ")}`,
      sourceType: "AI Signal",
      signal_id: zone.sourceId || "",
      signalName: zone.label,
      marketDistance: zone.marketDistance,
      boardDistance: zone.boardDistance,
      boardDistanceMode: zone.boardDistanceMode,
      latestKnownMarketPrice: zone.latestKnownMarketPrice,
      rawSignal: {
        ...zone.payload,
        id: zone.sourceId,
        signal: zone.label,
        direction: zone.direction,
        price: zone.price,
        entry: zone.price,
        ai_grade: zone.grade,
        ai_score: zone.score,
        zone_score: zone.zoneScore || zone.score,
        precision_score: zone.precisionScore || 0,
        ai_status: "OUT OF RANGE / WAITING",
        confluence_reasons: zone.reasons,
        evidence: zone.evidence || [],
        source_count: zone.sourceCount || zone.evidence?.length || 0,
        market_distance: zone.marketDistance,
        board_distance: zone.boardDistance,
        board_distance_mode: zone.boardDistanceMode,
        latest_known_price: zone.latestKnownMarketPrice
      }
    }));

  const activeAnchors = useMemo(() => {
    const best = new Map();
    rawActiveAnchors.forEach((anchor) => {
      const price = parsePrice(anchor.entry || anchor.price);
      const direction = String(anchor.direction || "BOTH").toUpperCase();
      const key = `${direction}|${price === null ? "NA" : Math.round(price * 4) / 4}`;
      const current = best.get(key);
      const currentScore = Number(current?.score || 0);
      const nextScore = Number(anchor?.score || 0);
      const currentSources = Number(current?.sourceCount || current?.evidence?.length || 0);
      const nextSources = Number(anchor?.sourceCount || anchor?.evidence?.length || 0);
      if (!current || nextScore > currentScore || (nextScore === currentScore && nextSources > currentSources)) {
        best.set(key, anchor);
      }
    });
    return Array.from(best.values()).sort((a, b) => (Number(b.score || 0) - Number(a.score || 0)) || ((Number(a.entry || a.price) || 0) - (Number(b.entry || b.price) || 0)));
  }, [rawActiveAnchors]);
  const aiAnchorsOnly = activeAnchors.filter((anchor) => anchor.sourceType === "AI Signal");
  const tradeAnchorLevels = aiAnchorsOnly.filter((anchor) => ["A+", "A"].includes(anchor.grade));
  const intermediateWatchlist = aiAnchorsOnly.filter((anchor) => ["B+", "B"].includes(anchor.grade));
  const watchLevels = aiAnchorsOnly.filter((anchor) => anchor.grade === "C");
  const filledManagingLevels = [
    ...manualManagingOrders,
    ...filledPinnedAnchors
  ]
    .filter((anchor) => !submittedRecordForAnchor(anchor))
    .reduce((acc, anchor) => {
      const key = anchorBaseKey(anchor);
      if (!acc.some((item) => anchorBaseKey(item) === key)) acc.push(anchor);
      return acc;
    }, [])
    .sort((a, b) => {
      const priceA = parsePrice(a.entry || a.price);
      const priceB = parsePrice(b.entry || b.price);
      if (priceA !== null && priceB !== null && priceA !== priceB) return priceA - priceB;
      if (priceA !== null && priceB === null) return -1;
      if (priceA === null && priceB !== null) return 1;
      return new Date(b.filledAt || b.updatedAt || b.date || 0).getTime() - new Date(a.filledAt || a.updatedAt || a.date || 0).getTime();
    });

  useEffect(() => {
    const anchorKeyFor = (anchor) => {
      const price = parsePrice(anchor.entry || anchor.price);
      const direction = String(anchor.direction || "BOTH").toUpperCase();
      return `${direction}|${price === null ? "NA" : Math.round(price * 4) / 4}`;
    };

    const notifyEligibleAnchors = activeAnchors.filter((anchor) => anchor.sourceType === "AI Signal");
    const currentAnchorMap = new Map(notifyEligibleAnchors.map((anchor) => [anchorKeyFor(anchor), anchor]));
    const stillTrackedAnchorMap = new Map([
      ...notifyEligibleAnchors,
      ...outOfRangeAiAnchors,
      ...rankedAiLimitZones.map((zone) => ({
        direction: zone.direction,
        entry: zone.price,
        price: zone.price,
        grade: zone.grade,
        score: zone.score,
        sourceCount: zone.sourceCount || zone.evidence?.length || 0
      }))
    ].map((anchor) => [anchorKeyFor(anchor), anchor]));
    const pendingRemovedMap = pendingRemovedAnchorMapRef.current instanceof Map ? pendingRemovedAnchorMapRef.current : new Map();
    const removalGraceMs = 3 * 60 * 1000;
    currentAnchorMap.forEach((_, anchorKey) => pendingRemovedMap.delete(anchorKey));
    stillTrackedAnchorMap.forEach((_, anchorKey) => pendingRemovedMap.delete(anchorKey));
    const priorAnchorMap = previousAnchorMapRef.current instanceof Map ? previousAnchorMapRef.current : null;
    const newNotices = [];

    if (!priorAnchorMap) {
      previousAnchorMapRef.current = currentAnchorMap;
      return;
    }

    currentAnchorMap.forEach((anchor, anchorKey) => {
      const oldAnchor = priorAnchorMap.get(anchorKey);
      const priceText = fmtPrice(anchor.entry || anchor.price);
      const directionText = String(anchor.direction || "BOTH").toUpperCase();
      const gradeText = anchor.grade || "Setup";
      const sources = anchor.sourceCount || anchor.evidence?.length || 0;

      if (!oldAnchor) {
        const key = `NEW-${gradeText}-${anchorKey}-${sources}`;
        if (!seenNotificationKeys[key]) {
          const title = ["A+", "A"].includes(gradeText) ? `New ${gradeText} ${directionText} setup` : `${gradeText} setup building`;
          const detail = `${directionText} ${priceText} • Grade ${gradeText} • Sources ${sources} • ${formatEastern(new Date())}`;
          newNotices.push({ key, kind: "TRADE_ANCHOR", title, detail, anchor, createdAt: new Date().toISOString(), voice: "play maker new set up" });
        }
      } else {
        const oldGrade = oldAnchor.grade || "";
        const oldSources = oldAnchor.sourceCount || oldAnchor.evidence?.length || 0;
        const oldPrice = fmtPrice(oldAnchor.entry || oldAnchor.price);
        const changed = oldGrade !== gradeText || oldSources !== sources || oldPrice !== priceText;
        if (changed) {
          const key = `ADJUSTED-${anchorKey}-${oldGrade}-${gradeText}-${oldSources}-${sources}`;
          if (!seenNotificationKeys[key]) {
            const detail = `${directionText} ${priceText} • Grade ${oldGrade || "--"} → ${gradeText} • Sources ${oldSources} → ${sources} • ${formatEastern(new Date())}`;
            newNotices.push({ key, kind: "ADJUSTED", title: "Playmaker Signal Adjustment", detail, anchor, createdAt: new Date().toISOString(), voice: "play maker set up adjustment" });
          }
        }
      }
    });

    priorAnchorMap.forEach((oldAnchor, anchorKey) => {
      if (currentAnchorMap.has(anchorKey)) return;
      if (stillTrackedAnchorMap.has(anchorKey)) return;
      if (submittedAnchorKeys[`${anchorKey}|`] || submittedAnchorKeys[anchorSubmitKey(oldAnchor)]) return;
      if (filledAnchorKeys[anchorKey] || filledAnchorKeys[`${anchorKey}|`]) return;
      const pendingRemoval = pendingRemovedMap.get(anchorKey);
      if (!pendingRemoval) {
        pendingRemovedMap.set(anchorKey, { anchor: oldAnchor, firstMissingAt: Date.now() });
        return;
      }
      if (Date.now() - Number(pendingRemoval.firstMissingAt || Date.now()) < removalGraceMs) return;
      const directionText = String(oldAnchor.direction || "BOTH").toUpperCase();
      const priceText = fmtPrice(oldAnchor.entry || oldAnchor.price);
      const gradeText = oldAnchor.grade || "Setup";
      const sources = oldAnchor.sourceCount || oldAnchor.evidence?.length || 0;
      const key = `REMOVED-${anchorKey}-${gradeText}-${sources}`;
      if (!seenNotificationKeys[key]) {
        const detail = `${directionText} ${priceText} • Grade ${gradeText} • Sources ${sources} • removed from board • ${formatEastern(new Date())}`;
        newNotices.push({ key, kind: "REMOVED", title: "Playmaker Signal Removed", detail, anchor: oldAnchor, createdAt: new Date().toISOString(), voice: "play maker set up removed" });
      }
      pendingRemovedMap.delete(anchorKey);
    });

    if (newNotices.length) {
      setNotificationLog((prev) => [...newNotices, ...prev].slice(0, 50));
      setSeenNotificationKeys((prev) => ({ ...prev, ...Object.fromEntries(newNotices.map((n) => [n.key, true])) }));
      newNotices.forEach((notice) => notifyPlaymaker(notice.title, notice.detail, notice.voice));
      newNotices
        .filter((notice) => notice.kind !== "REMOVED")
        .forEach((notice) => sendDiscordBoardNotice({ event: notice.kind, title: notice.title, detail: notice.detail, anchor: notice.anchor }));
    }

    pendingRemovedAnchorMapRef.current = pendingRemovedMap;
    const nextAnchorMap = new Map(currentAnchorMap);
    pendingRemovedMap.forEach((pendingRemoval, anchorKey) => {
      if (!nextAnchorMap.has(anchorKey) && pendingRemoval?.anchor) nextAnchorMap.set(anchorKey, pendingRemoval.anchor);
    });
    previousAnchorMapRef.current = nextAnchorMap;
  }, [activeAnchors, outOfRangeAiAnchors, rankedAiLimitZones, seenNotificationKeys, submittedAnchorKeys, filledAnchorKeys]);


  const learningStats = useMemo(() => {
    const closed = journal.filter((item) => isCompletedTradeResult(item));
    const bySource = {};
    closed.forEach((item) => {
      const sources = Array.isArray(item.formSnapshot?.evidence) ? item.formSnapshot.evidence : [];
      const sourceNames = sources.length ? sources.map((src) => src.sourceType || src.label || "Unknown") : String(item.top || "Manual").split(",").map((x) => x.trim()).filter(Boolean);
      sourceNames.forEach((name) => {
        if (!bySource[name]) bySource[name] = { name, trades: 0, wins: 0, losses: 0, be: 0, maxMove: 0, maxDrawdown: 0, bigMove200: 0 };
        bySource[name].trades += 1;
        const result = normalizeStatus(item.result);
        if (result === "win") bySource[name].wins += 1;
        if (result === "loss") bySource[name].losses += 1;
        if (result === "be") bySource[name].be += 1;
        if (n(item.maxMove) >= 200) bySource[name].bigMove200 += 1;
        bySource[name].maxMove += n(item.maxMove);
        bySource[name].maxDrawdown += n(item.maxDrawdown);
      });
    });
    return Object.values(bySource).map((row) => ({
      ...row,
      winRate: row.trades ? Math.round((row.wins / row.trades) * 100) : 0,
      avgMaxMove: row.trades ? row.maxMove / row.trades : 0,
      avgDrawdown: row.trades ? row.maxDrawdown / row.trades : 0
    })).sort((a, b) => b.trades - a.trades || b.winRate - a.winRate);
  }, [journal]);


  if (!user) {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md p-6 rounded-xl border border-yellow-500 bg-[#080808]">

        <h1 className="text-3xl font-bold text-[#ffcc19] mb-4">
          PlayMaker Login
        </h1>

        <input
          type="email"
          placeholder="Email"
          value={authEmail}
          onChange={(e)=>setAuthEmail(e.target.value)}
          className="w-full p-3 mb-3 rounded bg-zinc-900"
        />

        <input
          type="password"
          placeholder="Password"
          value={authPassword}
          onChange={(e)=>setAuthPassword(e.target.value)}
          className="w-full p-3 mb-4 rounded bg-zinc-900"
        />

        <div className="flex gap-3">

          <button
            onClick={() => {
              trackHomeClick("login_attempt", { pageArea: "login_form", buttonText: "Login" });
              signIn();
            }}
            className="flex-1 bg-[#ffcc19] text-black font-bold p-3 rounded"
          >
            Login
          </button>

          <button
            onClick={() => {
              trackHomeClick("register_attempt", { pageArea: "login_form", buttonText: "Register" });
              signUp();
            }}
            className="flex-1 border border-[#ffcc19] p-3 rounded"
          >
            Register
          </button>

        </div>

        <p className="mt-4 text-sm text-zinc-400">
          {authMessage}
        </p>

        <PlaymakerPromoTicker />
        <AutomaticSignalResults stats={automaticSignalStats} />

        <div className="mt-5 rounded-xl border border-[#2c2300] bg-black p-4 text-sm text-zinc-300">
          <div className="font-black text-[#ffcc19]">Need access?</div>
          <p className="mt-1">Purchase Playmaker, then register or log in with the same email.</p>
          <a
            href={WHOP_CHECKOUT_URL}
            target="_blank"
            rel="noreferrer"
            onClick={trackBuyAccessClick}
            className="mt-3 inline-flex w-full justify-center rounded-xl bg-[#ffcc19] px-5 py-3 font-black text-black"
          >
            Buy Playmaker Access
          </a>
          <a
            href={WHOP_TRIAL_CHECKOUT_URL}
            target="_blank"
            rel="noreferrer"
            onClick={trackTrialAccessClick}
            className="mt-3 inline-flex w-full justify-center rounded-xl border border-[#ffcc19] px-5 py-3 font-black text-[#ffcc19]"
          >
            3 Day Trial $30
          </a>
          <PlaymakerInfoTicker />
          <HighlightVideo />
          <SocialLinks />
          <PolicyLinks onOpen={setPolicyView} />
        </div>

      </div>
      <PolicyModal policyKey={policyView} onClose={() => setPolicyView(null)} />
    </div>
  );
}


  if (accessStatus === "checking") {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-[#ffcc19] bg-[#080808] p-6 text-center">
          <div className="text-2xl font-black text-[#ffcc19]">Checking Playmaker Access...</div>
          <p className="mt-3 text-sm text-zinc-400">{accessMessage}</p>
        </div>
      </div>
    );
  }

  if (accessStatus === "blocked") {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-[#ffcc19] bg-[#080808] p-6 text-center">
          <div className="text-3xl font-black text-[#ffcc19]">Playmaker Access Required</div>
          <p className="mt-3 text-zinc-300">{accessMessage}</p>
          <p className="mt-2 text-sm text-zinc-500">Use the same email you purchased with on Whop.</p>
          <PlaymakerPromoTicker />
          <AutomaticSignalResults stats={automaticSignalStats} />
          <a
            href={WHOP_CHECKOUT_URL}
            target="_blank"
            rel="noreferrer"
            onClick={trackBuyAccessClick}
            className="mt-5 inline-flex w-full justify-center rounded-xl bg-[#ffcc19] px-5 py-3 font-black text-black"
          >
            Buy Playmaker Access
          </a>
          <a
            href={WHOP_TRIAL_CHECKOUT_URL}
            target="_blank"
            rel="noreferrer"
            onClick={trackTrialAccessClick}
            className="mt-3 inline-flex w-full justify-center rounded-xl border border-[#ffcc19] px-5 py-3 font-black text-[#ffcc19]"
          >
            3 Day Trial $30
          </a>
          <PlaymakerInfoTicker />
          <HighlightVideo />
          <SocialLinks />
          <PolicyLinks onOpen={setPolicyView} />
          <button
            onClick={() => {
              trackHomeClick("paid_check_again", { pageArea: "access_blocked", buttonText: "I Paid Check Again", visitorState: "blocked" });
              window.location.reload();
            }}
            className="mt-3 w-full rounded-xl border border-[#ffcc19] px-5 py-3 font-black text-[#ffcc19]"
          >
            I Paid — Check Again
          </button>
          <button
            onClick={() => {
              trackHomeClick("sign_out_from_access", { pageArea: "access_blocked", buttonText: "Sign Out", visitorState: "blocked" });
              signOut();
            }}
            className="mt-3 w-full rounded-xl border border-zinc-700 px-5 py-3 font-black text-zinc-300"
          >
            Sign Out
          </button>
        </div>
        <PolicyModal policyKey={policyView} onClose={() => setPolicyView(null)} />
      </div>
    );
  }

  return (
    <WhopGate>
    <div className="min-h-screen bg-[#080808] text-white">
      <div className="relative mx-auto flex max-w-[1680px] flex-col gap-5 p-4 md:p-6 xl:flex-row xl:items-start">
        <aside className="z-20 rounded-3xl border border-[#2c2300] bg-black p-4 shadow-xl shadow-black/40 xl:sticky xl:top-6 xl:w-[260px] xl:shrink-0">
          <div className="mb-4 border-b border-zinc-800 pb-4">
            <div className="text-xs font-black uppercase tracking-[0.24em] text-[#ffcc19]">Playmaker</div>
            <div className="mt-2 text-2xl font-black">Navigation</div>
          </div>
          <nav className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-1" aria-label="Playmaker sections">
            {navTabs.filter((item) => !item.ownerOnly || ownerMode).map((item) => (
              <Tab key={item.id} id={item.id} tab={tab} setTab={setTab}>
                {item.label}
              </Tab>
            ))}
          </nav>
          <div className="mt-4 hidden rounded-2xl border border-zinc-800 bg-[#090909] p-3 text-xs text-zinc-400 xl:block">
            <div className="font-black text-[#ffcc19]">Current section</div>
            <div className="mt-1 text-sm font-black text-white">{navTabs.find((item) => item.id === tab)?.label || "Playmaker"}</div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
        <div className="grid gap-5 lg:grid-cols-[1fr_230px]">
          <div>
            <div className="mb-5 flex items-center gap-2 text-[#ffcc19] font-black tracking-[0.24em] text-sm"><span className="text-2xl tracking-normal">👑</span><span>THE PLAYMAKER</span></div>
            <h1 className="text-5xl md:text-6xl font-black leading-none">Setup Grader</h1>
            <p className="mt-3 text-xl text-zinc-300">Starting-level scoring, distance compression, weighted confluences, behavior review, and trade journal.</p>
            <div className="mx-auto max-w-xl">
              <AutomaticSignalResults stats={automaticSignalStats} />
            </div>
          </div>
          <div className="rounded-3xl border border-[#2c2300] bg-black p-4 shadow-xl shadow-black/50">
            <div className="flex items-start gap-5">
              <div className="text-5xl font-black text-[#00e68a]">{letter}</div>
              <div className="mt-2 rounded-full bg-[#00d27a] px-5 py-2 text-sm font-black text-black">{displayScore}/100</div>
            </div>
            <div className="mt-1 text-lg text-zinc-200">{text}</div>
            <div className="mt-4 h-2 rounded-full bg-zinc-900"><div className="h-full rounded-full bg-[#00d27a]" style={{width: `${displayScore}%`}} /></div>
            <div className="mt-4 rounded-xl border border-zinc-800 bg-[#090909] p-3 text-xs text-zinc-300">
              <div className="font-black text-[#ffcc19]">Logged in</div>
              <div className="mt-1 break-all">{user?.email || "No email"}</div>
              <button onClick={signOut} className="mt-3 rounded-lg border border-[#ffcc19] px-3 py-2 font-black text-[#ffcc19] hover:bg-[#171200]">Sign Out</button>
            </div>
          </div>
        </div>

        {tab === "procedure" && <Procedure />}

        {tab === "trade" && (
          <>



        {weeklyLevels.length > 0 && (
          <div className="mt-5 rounded-2xl border border-[#2c2300] bg-black px-3 py-2 shadow-lg shadow-black/20">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-[#ffcc19]">Weekly Levels</div>
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{weeklyLevels.length} saved</div>
            </div>
            <div className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
              {weeklyLevels.map((level) => {
                const key = weeklyLevelKey(level);
                const price = parsePrice(level.price);
                const entry = parsePrice(form.tradeEntryPrice);
                const awayPts = price !== null && entry !== null ? Math.abs(price - entry) : null;
                return (
                  <div key={key} className="rounded-lg border border-zinc-800 bg-[#090909] px-2 py-1 text-[11px] leading-tight">
                    <span className="font-black text-[#ffcc19]">{fmtPrice(level.price)}</span>
                    <span className="ml-1 text-zinc-500">{awayPts !== null ? `${fmt(awayPts)} pts` : ""}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-4 rounded-2xl border border-[#2c2300] bg-black p-3 shadow-lg shadow-black/20">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-[#ffcc19]">Notification Center</div>
              <p className="mt-1 text-xs text-zinc-500">Setup changes, filled/manage moves, and owner updates.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={requestDesktopNotifications} className="rounded-lg border border-[#00d27a] px-3 py-2 text-[11px] font-black text-[#00d27a]">Enable Alerts</button>
              <button onClick={() => setNotificationLog([])} className="rounded-lg border border-zinc-700 px-3 py-2 text-[11px] font-black text-zinc-300">Clear</button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {notificationLog.length === 0 && <div className="text-xs text-zinc-500">No new setup notifications yet.</div>}
            {notificationLog.slice(0, 6).map((notice) => (
              <div key={notice.key} className="rounded-xl border border-zinc-800 bg-[#090909] p-3 text-xs">
                <div className="font-black text-[#00d27a]">{notice.title}</div>
                <div className="mt-1 text-zinc-400">{notice.detail}</div>
                <div className="mt-1 text-zinc-600">{formatEastern(notice.createdAt)}</div>
              </div>
            ))}
          </div>
        </div>

        {(activeAnchors.length > 0 || filledManagingLevels.length > 0 || outOfRangeAiAnchors.length > 0 || pulledAnchors.length > 0) && (
          <div className="mt-6 rounded-3xl border border-[#ffcc19] bg-black p-5 shadow-xl shadow-yellow-950/20">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-black uppercase tracking-[0.22em] text-[#ffcc19]">👑 Crown Level Board</div>
                <p className="mt-1 text-sm text-zinc-400">Persistent AI levels, clustered sources, precision entries, and private result-learning for your account only.</p>
              </div>
              <button onClick={() => setTab("journal")} className="rounded-xl bg-[#ffcc19] px-4 py-2 font-black text-black">Review / Report</button>
            </div>

            <LevelSection title="👑 Trade Anchors" subtitle="A+ / A levels: strongest limit-order candidates." items={tradeAnchorLevels} selectedTrade={selectedTrade} onSelect={selectActiveAnchor} ownerMode={ownerMode} verifiedAnchors={verifiedAnchors} onVerify={verifyAnchor} onUnverify={removeAnchorVerification} onSubmitAnchor={submitAnchorToJournal} filledAnchorKeys={filledAnchorKeys} onMarkFilled={markAnchorFilled} onDismissAnchor={dismissAnchorFromBoard} />
            <LevelSection title="Intermediate Watchlist" subtitle="B+ / B levels: good clusters still building or needing discretion." items={intermediateWatchlist} selectedTrade={selectedTrade} onSelect={selectActiveAnchor} ownerMode={ownerMode} verifiedAnchors={verifiedAnchors} onVerify={verifyAnchor} onUnverify={removeAnchorVerification} onSubmitAnchor={submitAnchorToJournal} filledAnchorKeys={filledAnchorKeys} onMarkFilled={markAnchorFilled} onDismissAnchor={dismissAnchorFromBoard} />
            <LevelSection title="Watch Levels" subtitle="C levels: repeat prices and early confluence worth monitoring." items={watchLevels} selectedTrade={selectedTrade} onSelect={selectActiveAnchor} ownerMode={ownerMode} verifiedAnchors={verifiedAnchors} onVerify={verifyAnchor} onUnverify={removeAnchorVerification} onSubmitAnchor={submitAnchorToJournal} filledAnchorKeys={filledAnchorKeys} onMarkFilled={markAnchorFilled} onDismissAnchor={dismissAnchorFromBoard} />
            <LevelSection title="Filled / Managing" subtitle="Filled cards move here so the main board can keep scanning. Submit to journal when you are done managing the trade." items={filledManagingLevels} selectedTrade={selectedTrade} onSelect={selectActiveAnchor} ownerMode={ownerMode} verifiedAnchors={verifiedAnchors} onVerify={verifyAnchor} onUnverify={removeAnchorVerification} onSubmitAnchor={submitAnchorToJournal} filledAnchorKeys={filledAnchorKeys} onMarkFilled={markAnchorFilled} onDismissAnchor={dismissAnchorFromBoard} mode="filled" />
            <LevelSection title="Out of Range / Waiting" subtitle={`Good confluence more than ${maxOrderCardDistancePoints.toLocaleString()} pts from latest known price. It auto-returns when price comes back and the stack still qualifies.`} items={outOfRangeAiAnchors} selectedTrade={selectedTrade} onSelect={selectActiveAnchor} ownerMode={ownerMode} verifiedAnchors={verifiedAnchors} onVerify={verifyAnchor} onUnverify={removeAnchorVerification} onSubmitAnchor={submitAnchorToJournal} filledAnchorKeys={filledAnchorKeys} onMarkFilled={markAnchorFilled} onDismissAnchor={dismissAnchorFromBoard} />
            <LevelSection title="Pulled Orders" subtitle="Cards pulled off the main board. Restore them if the limit is still good, or journal/delete them later." items={pulledAnchors} selectedTrade={selectedTrade} onSelect={selectActiveAnchor} ownerMode={ownerMode} verifiedAnchors={verifiedAnchors} onVerify={verifyAnchor} onUnverify={removeAnchorVerification} onSubmitAnchor={submitAnchorToJournal} filledAnchorKeys={filledAnchorKeys} onMarkFilled={markAnchorFilled} onDismissAnchor={dismissAnchorFromBoard} onRestoreAnchor={restorePulledAnchor} onDeletePulledAnchor={deletePulledAnchor} mode="pulled" />
          </div>
        )}

                  </>
        )}

        {tab === "checklist" && (
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <Card className="lg:col-span-2">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black uppercase tracking-[0.2em] text-[#ffcc19]">Entry Confirmation / Limit Placement</div>
                  <div className="mt-3 grid gap-5 md:grid-cols-3">
                    <Field label="Trade Entry Price" value={form.tradeEntryPrice} onChange={(v) => set("tradeEntryPrice", v)} />
                    <Select label="Long / Short" value={form.direction} options={["Long", "Short"]} onChange={(v) => set("direction", v)} />
                    <Select label="Trend" value={form.trend} options={["With Trend", "Against Trend", "Neutral"]} onChange={(v) => set("trend", v)} />
                    <Select label="1H Bias" value={form.bias1H} options={["Bullish", "Bearish", "Indecisive"]} onChange={(v) => set("bias1H", v)} />
                    <Select label="4H Bias" value={form.bias4H} options={["Bullish", "Bearish", "Indecisive"]} onChange={(v) => set("bias4H", v)} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button onClick={submitOrder} className="rounded-xl bg-[#00d27a] px-5 py-3 font-black text-black">
                      Submit Order
                    </button>
                    <button onClick={exportSetup} className="rounded-xl bg-[#ffcc19] px-5 py-3 font-black text-black shadow-lg shadow-yellow-950/30">Export Setup Report</button>
                    <button onClick={printSetup} className="rounded-xl border border-[#ffcc19] bg-black px-5 py-3 font-black text-[#ffcc19] hover:bg-[#171200]">Print / Save PDF</button>
                  </div>
                  <div className="mt-4 text-sm text-zinc-400">
                    Starting Level: {startingLevel || "None selected"} - Top 3 within 5 pts: {report.topWithin5}/3 - Far levels: {report.farCount}
                  </div>
                </div>
                <div className="grid w-full gap-3 xl:w-[520px]">
                  {recommendations.map((r) => <Rec key={r.stop} r={r} />)}
                </div>
              </div>
              {weeklyLevels.length > 0 && (
                <div className="mt-5 rounded-2xl border border-zinc-800 bg-black px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-[#ffcc19]">Weekly Levels</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{weeklyLevels.length} saved</div>
                  </div>
                  <div className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
                    {weeklyLevels.map((level) => {
                      const key = weeklyLevelKey(level);
                      const price = parsePrice(level.price);
                      const entry = parsePrice(form.tradeEntryPrice);
                      const awayPts = price !== null && entry !== null ? Math.abs(price - entry) : null;
                      return (
                        <div key={key} className="rounded-lg border border-zinc-800 bg-[#090909] px-2 py-1 text-[11px] leading-tight">
                          <span className="font-black text-[#ffcc19]">{fmtPrice(level.price)}</span>
                          <span className="ml-1 text-zinc-500">{awayPts !== null ? `${fmt(awayPts)} pts` : ""}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>
            <Card className="lg:col-span-2">
              <Title>Manual Level Scanner</Title>
              <div className="mt-5 grid gap-4 md:grid-cols-5">
                <Field label="Price" value={manualScanner.price} onChange={(v) => setManualScanner((s) => ({ ...s, price: v }))} />
                <Select label="Direction" value={manualScanner.direction} options={["Long", "Short"]} onChange={(v) => setManualScanner((s) => ({ ...s, direction: v }))} />
                <Select label="4H Bias" value={manualScanner.bias4H} options={["Bullish", "Bearish"]} onChange={(v) => setManualScanner((s) => ({ ...s, bias4H: v }))} />
                <Select label="1H Bias" value={manualScanner.bias1H} options={["Bullish", "Bearish"]} onChange={(v) => setManualScanner((s) => ({ ...s, bias1H: v }))} />
                <button onClick={fetchManualLevelGrade} className="self-end rounded-xl bg-[#00d27a] px-5 py-3 font-black text-black">
                  Fetch Grade
                </button>
              </div>
              {manualScannerResult && (
                <div className="mt-5 rounded-2xl border border-zinc-800 bg-[#090909] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-black text-[#ffcc19]">{manualScannerResult.message}</div>
                      <div className="mt-1 text-sm text-zinc-400">
                        {manualScannerResult.direction} fetched {fmtPrice(manualScannerResult.fetchedPrice || manualScannerResult.price)} - 4H {manualScannerResult.bias4H} - 1H {manualScannerResult.bias1H}
                      </div>
                    </div>
                    <div className={`rounded-full px-3 py-2 text-xs font-black ${manualScannerResult.biasAligned === 2 ? "bg-[#00d27a] text-black" : manualScannerResult.biasAligned === 1 ? "bg-[#ffcc19] text-black" : "bg-red-950 text-red-300"}`}>
                      {manualScannerResult.biasAligned === 2 ? "BIAS ALIGNED" : manualScannerResult.biasAligned === 1 ? "MIXED BIAS" : "AGAINST BIAS"}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <Small label="Suggested Entry" value={fmtPrice(manualScannerResult.suggestedEntry || manualScannerResult.price)} />
                    <Small label="Away From Fetch" value={`${fmt(manualScannerResult.suggestedDistance || 0)} pts`} />
                    <Small label="Grade" value={grade(report.score)[0]} />
                    <Small label="Score" value={`${report.score}/100`} />
                  </div>
                  <div className="mt-4 grid gap-2 md:grid-cols-3">
                    {manualScannerResult.evidence.slice(0, 9).map((item, idx) => (
                      <div key={`${item.sourceType}-${item.label}-${idx}`} className="rounded-xl border border-zinc-800 bg-black p-3 text-xs">
                        <div className="font-black text-white">{item.sourceType}</div>
                        <div className="mt-1 text-zinc-400">{item.label}</div>
                        <div className="mt-1 text-[#00d27a]">{fmtPrice(item.parsedPrice)} - {fmt(item.distance)} pts away</div>
                      </div>
                    ))}
                    {manualScannerResult.evidence.length === 0 && (
                      <div className="text-sm text-zinc-500">No saved Playmaker confluence, weekly level, or crater box was found within 15 points.</div>
                    )}
                  </div>
                </div>
              )}
            </Card>
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

        {ownerMode && tab === "settings" && (
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <Card className="lg:col-span-2">
              <Title>Scanner Feed Audit</Title>
              <p className="mt-2 text-sm text-zinc-400">Owner-only scanner counts. Customers do not see this diagnostic box.</p>
              <div className="mt-4 grid gap-2 md:grid-cols-5">
                {feedAudit.map((row) => (
                  <div key={row.name} className={`rounded-xl border p-3 text-xs ${row.count > 0 ? "border-[#00d27a] bg-[#001a0f]" : "border-zinc-800 bg-[#090909]"}`}>
                    <div className="font-black text-white">{row.name}</div>
                    <div className={row.count > 0 ? "text-[#00d27a]" : "text-zinc-500"}>{row.count > 0 ? `${row.count} received/used` : "0 / not seen"}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="lg:col-span-2">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <Title>Owner Signal Tools</Title>
                  <p className="mt-2 text-sm text-zinc-400">Use this when fresh signals are coming in but the board looks empty because cards were pulled, filled, or submitted earlier.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={restorePulledAiCards} className="rounded-xl border border-[#00d27a] px-4 py-2 text-sm font-black text-[#00d27a] hover:bg-[#001f14]">Restore Pulled Cards</button>
                  <button onClick={restoreHiddenAiCards} className="rounded-xl bg-[#ffcc19] px-4 py-2 text-sm font-black text-black">Restore Hidden AI Cards</button>
                  <button onClick={fetchAiSignals} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-black text-zinc-200 hover:bg-zinc-900">Refresh Signal Feed</button>
                </div>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-zinc-800 bg-black p-4">
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-zinc-400">Latest Signal Rows</div>
                  <div className="mt-3 grid gap-2">
                    {latestSignalRows.length === 0 && <div className="text-sm text-zinc-500">No signal rows loaded yet.</div>}
                    {latestSignalRows.slice(0, 6).map((row) => (
                      <div key={row.id} className="rounded-xl border border-zinc-900 bg-[#090909] p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <b className="text-[#ffcc19]">{row.signalName}</b>
                          <span className="rounded-full border border-zinc-700 px-2 py-1 text-[10px] font-black text-zinc-300">{row.status}</span>
                        </div>
                        <div className="mt-1 text-zinc-300">{row.direction} {row.price !== null ? fmtPrice(row.price) : "--"} - {row.timeframe}</div>
                        <div className="mt-1 text-xs text-zinc-500">{formatEastern(row.createdAt)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-black p-4">
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-zinc-400">Board Gate Check</div>
                  <div className="mt-3 grid gap-2 text-sm text-zinc-300">
                    <div className="flex items-center justify-between rounded-xl bg-[#090909] px-3 py-2"><span>Loaded signal rows</span><b className="text-white">{aiSignals.length}</b></div>
                    <div className="flex items-center justify-between rounded-xl bg-[#090909] px-3 py-2"><span>Latest known price</span><b className="text-white">{latestKnownMarketPrice !== null ? fmtPrice(latestKnownMarketPrice) : "--"}</b></div>
                    <div className="flex items-center justify-between rounded-xl bg-[#090909] px-3 py-2"><span>Board distance mode</span><b className="text-white">Alert-led</b></div>
                    <div className="flex items-center justify-between rounded-xl bg-[#090909] px-3 py-2"><span>Built AI cards</span><b className="text-white">{aiAnchorsOnly.length}</b></div>
                    <div className="flex items-center justify-between rounded-xl bg-[#090909] px-3 py-2"><span>Out of range waiting</span><b className="text-white">{outOfRangeAiAnchors.length}</b></div>
                    <div className="flex items-center justify-between rounded-xl bg-[#090909] px-3 py-2"><span>Pulled cards hidden</span><b className="text-white">{Object.keys(pulledAnchorKeys).length}</b></div>
                    <div className="flex items-center justify-between rounded-xl bg-[#090909] px-3 py-2"><span>Submitted cards hidden</span><b className="text-white">{Object.keys(submittedAnchorKeys).length}</b></div>
                    <div className="rounded-xl border border-zinc-800 bg-[#090909] p-3 text-xs text-zinc-500">
                      Board holds 12 normal cards and can expand to 16 only for stronger stacked setups. Cards still pass score, source-stack, duplicate, and {maxOrderCardDistancePoints.toLocaleString()} point alert-led distance gates.
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <Title>AI Pillar Zones</Title>
              <p className="mt-2 text-zinc-400">Save multiple weekly levels and crater boxes. These are the foundation zones the Playmaker signal engine uses.</p>

              {aiLevelMessage && <div className="mt-4 rounded-xl border border-[#2c2300] bg-[#090909] p-3 text-sm text-[#ffcc19]">{aiLevelMessage}</div>}

              <div className="mt-5 rounded-2xl border border-zinc-800 bg-[#090909] p-4">
                <h3 className="text-lg font-black text-[#ffcc19]">Weekly Level</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Field label="Weekly Level Name" value={aiSettings.weeklyLevelName} onChange={(v) => setAiSettings((s) => ({ ...s, weeklyLevelName: v }))} />
                  <Field label="Weekly Level Price" value={aiSettings.weeklyLevelPrice} onChange={(v) => setAiSettings((s) => ({ ...s, weeklyLevelPrice: v }))} />
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button onClick={saveWeeklyLevel} className="rounded-xl bg-[#ffcc19] px-5 py-3 font-black text-black">
                    {editingWeeklyLevelId ? "Update Weekly Level" : "Save Weekly Level"}
                  </button>
                  {editingWeeklyLevelId && <button onClick={resetAiLevelInputs} className="rounded-xl border border-zinc-700 px-5 py-3 font-black text-zinc-200">Cancel Edit</button>}
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-zinc-800 bg-[#090909] p-4">
                <h3 className="text-lg font-black text-[#ffcc19]">Crater Box</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <Field label="Crater Box Name" value={aiSettings.craterBoxName} onChange={(v) => setAiSettings((s) => ({ ...s, craterBoxName: v }))} />
                  <Field label="Crater Top Price" value={aiSettings.volumeCraterTop} onChange={(v) => setAiSettings((s) => ({ ...s, volumeCraterTop: v }))} />
                  <Field label="Crater Bottom Price" value={aiSettings.volumeCraterBottom} onChange={(v) => setAiSettings((s) => ({ ...s, volumeCraterBottom: v }))} />
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <Small label="Crater Width" value={aiCraterSize ? `${fmt(aiCraterSize)} pts` : "--"} />
                  <Small label="Crater Mid" value={aiCraterMid ? fmtPrice(aiCraterMid) : "--"} />
                  <Small label="Crater Mid Away" value={aiCraterAway ? `${fmt(aiCraterAway)} pts` : "--"} />
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button onClick={saveCraterBox} className="rounded-xl bg-[#ffcc19] px-5 py-3 font-black text-black">
                    {editingCraterBoxId ? "Update Crater Box" : "Save Crater Box"}
                  </button>
                  {editingCraterBoxId && <button onClick={resetAiLevelInputs} className="rounded-xl border border-zinc-700 px-5 py-3 font-black text-zinc-200">Cancel Edit</button>}
                </div>
              </div>

              <div className="mt-5">
                <Select label="Use Indicator Auto Signals" value={aiSettings.autoUseIndicator} options={["Yes", "No"]} onChange={(v) => setAiSettings((s) => ({ ...s, autoUseIndicator: v }))} />
              </div>
            </Card>

            <Card>
              <Title>Saved AI Pillars</Title>
              <div className="mt-5">
                <h3 className="font-black text-[#ffcc19]">Weekly Levels</h3>
                <div className="mt-3 space-y-3">
                  {weeklyLevels.length === 0 && <div className="text-sm text-zinc-500">No weekly levels saved.</div>}
                  {weeklyLevels.map((level) => (
                    <div key={level.id} className="rounded-xl border border-zinc-800 bg-[#090909] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-black text-white">{level.name || "Weekly Level"}</div>
                          <div className="mt-1 text-sm text-zinc-400">Price: {fmtPrice(level.price)}</div>
                          <div className="mt-1 text-xs text-zinc-500">Away from entry: {form.tradeEntryPrice && level.price ? `${fmt(Math.abs(Number(level.price) - n(form.tradeEntryPrice)))} pts` : "--"}</div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => editWeeklyLevel(level)} className="rounded-lg border border-[#ffcc19] px-3 py-2 text-xs font-black text-[#ffcc19]">Edit</button>
                          <button onClick={() => deleteAiLevel(level)} className="rounded-lg border border-red-500 px-3 py-2 text-xs font-black text-red-400">Delete</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-7">
                <h3 className="font-black text-[#ffcc19]">Crater Boxes</h3>
                <div className="mt-3 space-y-3">
                  {craterBoxes.length === 0 && <div className="text-sm text-zinc-500">No crater boxes saved.</div>}
                  {craterBoxes.map((box) => {
                    const top = Number(box.top_price);
                    const bottom = Number(box.bottom_price);
                    const valid = Number.isFinite(top) && Number.isFinite(bottom) && top > 0 && bottom > 0 && top !== bottom;
                    const high = valid ? Math.max(top, bottom) : 0;
                    const low = valid ? Math.min(top, bottom) : 0;
                    const mid = valid ? (high + low) / 2 : 0;
                    const width = valid ? Math.abs(high - low) : 0;
                    const away = valid && form.tradeEntryPrice ? Math.abs(mid - n(form.tradeEntryPrice)) : 0;

                    return (
                      <div key={box.id} className={`rounded-xl border bg-[#090909] p-4 ${valid ? "border-zinc-800" : "border-red-500"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-black text-white">{box.name || "Crater Box"}</div>
                            {valid ? (
                              <>
                                <div className="mt-1 text-sm text-zinc-400">Top: {fmtPrice(high)} • Bottom: {fmtPrice(low)}</div>
                                <div className="mt-1 text-sm text-zinc-400">Mid: {fmtPrice(mid)} • Width: {fmt(width)} pts</div>
                                <div className="mt-1 text-xs text-zinc-500">Mid away from entry: {away ? `${fmt(away)} pts` : "--"}</div>
                              </>
                            ) : (
                              <div className="mt-1 text-sm text-red-400">Invalid crater values. Edit or delete this box.</div>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => editCraterBox(box)} className="rounded-lg border border-[#ffcc19] px-3 py-2 text-xs font-black text-[#ffcc19]">Edit</button>
                            <button onClick={() => deleteAiLevel(box)} className="rounded-lg border border-red-500 px-3 py-2 text-xs font-black text-red-400">Delete</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>

            <Card className="lg:col-span-2">
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
                        <td>{row.value === 0 ? 0 : (row.value || "--")}</td>
                        <td className={row.ready ? "font-black text-[#00d27a]" : "font-black text-[#ffcc19]"}>{row.status || (row.ready ? "Ready" : "Needed")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {ownerMode && (
            <Card className="lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Title>AI Signal Memory</Title>
                <button onClick={fetchAiSignals} className="rounded-xl bg-[#ffcc19] px-4 py-2 font-black text-black">{aiLoading ? "Fetching..." : "Fetch AI Entries"}</button>
              </div>
              {aiFetchMessage && <div className="mt-3 text-sm text-zinc-400">{aiFetchMessage}</div>}
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {aiSignals.length === 0 && <div className="text-zinc-500">No AI signals found yet.</div>}
                {aiSignals.map((signal) => (
                  <div key={signal.id || `${signal.signal}-${signal.created_at}`} className="rounded-xl border border-zinc-800 bg-[#090909] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <b className="text-[#ffcc19]">{signal.signal || "AI_SIGNAL"}</b>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${isRecentSignal(signal.created_at) ? "bg-[#00d27a] text-black" : "bg-zinc-800 text-zinc-400"}`}>{isRecentSignal(signal.created_at) ? "Recent" : "Historical"}</span>
                    </div>
                    <div className="mt-2 text-sm text-zinc-400">{signal.ticker || "NQ"} • {signal.price || "--"} • {signal.interval || "--"}</div>
                    <div className="mt-1 text-xs text-zinc-500">{signal.created_at ? new Date(signal.created_at).toLocaleString() : "No time"}</div>
                  </div>
                ))}
              </div>
            </Card>
            )}
          </div>
        )}

        {tab === "behavior" && <Behavior behavior={behavior} journal={journal} learningStats={learningStats} />}
        {tab === "breakdown" && <Breakdown report={report} recommendations={recommendations} tips={tips} />}
        {tab === "journal" && (
          <Journal
            journal={filteredJournal}
            totalJournalCount={journal.length}
            journalStats={journalStats}
            journalFilter={journalFilter}
            setJournalFilter={setJournalFilter}
            saveTrade={saveTrade}
            editTrade={editTrade}
            deleteJournalEntry={deleteJournalEntry}
            exportJournalCSV={exportJournalCSV}
            form={form}
            set={set}
            editingId={editingId}
            handleImageUpload={handleImageUpload}
          />
        )}
        </main>
      </div>
    </div>
    </WhopGate>
  );
}

function sourceGroupName(sourceType = "") {
  const text = String(sourceType);
  if (text.includes("STDV") || text.includes("Deviation")) return "STDV";
  if (text.includes("Volume Profile")) return "Volume Profile";
  if (text.includes("Crater") || text.includes("LVN")) return "Craters / LVN";
  if (text.includes("Weekly")) return "Weekly";
  if (text.includes("PlayMaker")) return "PlayMaker";
  if (text.includes("OTE") || text.includes("Retrace")) return "OTE";
  if (text.includes("Order") || text.includes("Rejection")) return "Structure";
  return "Other";
}

function EvidenceList({ evidence = [] }) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return <div className="mt-3 text-xs text-zinc-500">No source breakdown saved.</div>;
  }

  const groups = evidence.reduce((acc, item) => {
    const key = sourceGroupName(item.sourceType);
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <div className="mt-3 rounded-xl border border-zinc-800 bg-black/60 p-3">
      <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-[#ffcc19]">All Sources</div>
      <div className="space-y-2">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group}>
            <div className="text-[11px] font-black uppercase text-zinc-400">{group}</div>
            <div className="mt-1 space-y-1">
              {items.map((item, idx) => (
                <div key={`${group}-${idx}`} className="flex items-start justify-between gap-2 text-xs text-zinc-300">
                  <span>✓ {item.label || item.sourceType} @ {fmtPrice(item.price)}</span>
                  <span className="shrink-0 font-black text-[#00d27a]">+{Number(item.evidenceScore ?? item.score ?? 0).toFixed(0)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LevelCard({ anchor, selectedTrade, onSelect, ownerMode = false, verifiedAnchors = {}, onVerify, onUnverify, onSubmitAnchor, filledAnchorKeys = {}, onMarkFilled, onDismissAnchor, onRestoreAnchor, onDeletePulledAnchor, mode = "active" }) {
  const isAi = anchor.sourceType === "AI Signal";
  const isPulled = mode === "pulled" || anchor.pulled;
  const isFilledMode = mode === "filled" || anchor.filledLocked;
  const evidence = anchor.evidence || anchor.rawSignal?.evidence || [];
  const selected = selectedTrade?.id === anchor.id;
  const verificationKey = String(anchor.signal_id || anchor.sourceId || anchor.id || anchor.entry || "");
  const verificationBaseKey = `${String(anchor.direction || "BOTH").toUpperCase()}|${anchor.entry ? String(Math.round(Number(String(anchor.entry).replace(/,/g, "")) * 4) / 4) : "NA"}`;
  const verification = verifiedAnchors[verificationBaseKey] || verifiedAnchors[`${verificationBaseKey}|`] || verifiedAnchors[verificationKey] || anchor.verification || null;
  const verifiedLabel = verification?.label || (verification?.verified ? `Mr. DJ Harrison Verified ${String(anchor.direction || "Both").toUpperCase()}` : "");
  const filledKey = `${String(anchor.direction || "BOTH").toUpperCase()}|${anchor.entry ? String(Math.round(Number(String(anchor.entry).replace(/,/g, "")) * 4) / 4) : "NA"}`;
  const filledRecord = filledAnchorKeys[filledKey] || null;
  const cardRef = useRef(null);
  const [draftOwnerNote, setDraftOwnerNote] = useState(verification?.ownerNote || "");

  const downloadCardScreenshot = async () => {
    try {
      const direction = String(anchor.direction || "BOTH").toUpperCase();
      const entryValue = anchor.entry || anchor.price || "";
      const gradeText = String(anchor.grade || "SETUP").toUpperCase();
      const sourceCount = anchor.sourceCount || evidence.length || 0;
      const zoneScore = anchor.zoneScore || anchor.score || "--";
      const precisionScore = anchor.precisionScore || "--";
      const title = `${direction} SETUP`;
      const entryText = fmtPrice(entryValue);
      const clusterText = anchor.clusterWidth !== undefined
        ? `Cluster ${fmtPrice(anchor.clusterLow)} - ${fmtPrice(anchor.clusterHigh)} | Width ${fmt(anchor.clusterWidth)} pts`
        : (anchor.top || "PlayMaker setup card");
      const topEvidence = evidence.slice(0, 7).map((item) => `• ${item.label || item.sourceType} @ ${fmtPrice(item.price)}`);
      const stopLines = Array.isArray(anchor.stopPlans)
        ? anchor.stopPlans.slice(0, 3).map((plan) => `${plan.stop}pt: Limit ${fmtPrice(plan.limit)} | Stop ${fmtPrice(plan.stopArea)}${plan.valid === false ? " | Too tight" : ""}`)
        : [];
      const protectedEvidence = topEvidence.slice(0, 5).map((line, idx) => {
        const priceText = String(line).split("@").pop()?.trim() || "--";
        return `Protected confluence ${idx + 1} @ ${priceText}`;
      });
      const verificationText = verifiedLabel || "Not verified by Mr. DJ Harrison yet";
      const ownerNote = verification?.ownerNote || "";

      const canvas = document.createElement("canvas");
      const width = 1080;
      const height = 1350;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available in this browser.");
      ctx.scale(ratio, ratio);

      const drawRoundRect = (x, y, w, h, r) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      };

      const fillRoundRect = (x, y, w, h, r, fill, stroke = null) => {
        drawRoundRect(x, y, w, h, r);
        ctx.fillStyle = fill;
        ctx.fill();
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      };

      const wrapText = (txt, x, y, maxWidth, lineHeight, maxLines = 3, color = "#d4d4d8", font = "28px Arial") => {
        ctx.fillStyle = color;
        ctx.font = font;
        const words = String(txt || "").split(" ");
        let line = "";
        let lines = 0;
        for (let i = 0; i < words.length; i += 1) {
          const testLine = line ? `${line} ${words[i]}` : words[i];
          if (ctx.measureText(testLine).width > maxWidth && line) {
            ctx.fillText(line, x, y);
            y += lineHeight;
            lines += 1;
            line = words[i];
            if (lines >= maxLines - 1) {
              const remaining = [line, ...words.slice(i + 1)].join(" ");
              let clipped = remaining;
              while (ctx.measureText(`${clipped}...`).width > maxWidth && clipped.length > 0) {
                clipped = clipped.slice(0, -1);
              }
              ctx.fillText(`${clipped}...`, x, y);
              return y + lineHeight;
            }
          } else {
            line = testLine;
          }
        }
        if (line) ctx.fillText(line, x, y);
        return y + lineHeight;
      };

      ctx.fillStyle = "#080808";
      ctx.fillRect(0, 0, width, height);

      fillRoundRect(54, 54, 972, 1242, 34, "#090909", "#ffcc19");

      ctx.fillStyle = "#ffcc19";
      ctx.font = "900 34px Arial";
      ctx.fillText("👑 THE PLAYMAKER", 92, 124);

      fillRoundRect(780, 86, 180, 86, 24, "#ffcc19");
      ctx.fillStyle = "#080808";
      ctx.font = "900 52px Arial";
      ctx.textAlign = "center";
      ctx.fillText(gradeText, 870, 146);
      ctx.textAlign = "left";

      ctx.fillStyle = "#00d27a";
      ctx.font = "900 66px Arial";
      ctx.fillText(title, 92, 236);

      ctx.fillStyle = "#ffffff";
      ctx.font = "900 92px Arial";
      ctx.fillText(entryText, 92, 340);

      ctx.fillStyle = "#a1a1aa";
      ctx.font = "28px Arial";
      ctx.fillText(`Zone ${zoneScore}/100   |   Precision ${precisionScore}/100   |   Sources ${sourceCount}`, 92, 398);

      fillRoundRect(92, 442, 896, 132, 22, "#111111", "#2c2300");
      ctx.fillStyle = "#ffcc19";
      ctx.font = "900 28px Arial";
      ctx.fillText("ENTRY STACK", 122, 488);
      wrapText(clusterText, 122, 530, 830, 34, 2, "#e4e4e7", "28px Arial");

      fillRoundRect(92, 600, 896, ownerNote ? 128 : 84, 22, verification?.verified ? "#001a0f" : "#111111", verification?.verified ? "#00d27a" : "#27272a");
      ctx.fillStyle = verification?.verified ? "#00d27a" : "#a1a1aa";
      ctx.font = "900 26px Arial";
      ctx.fillText(verification?.verified ? "VERIFIED" : "UNVERIFIED", 122, 648);
      wrapText(verificationText, 282, 648, 670, 30, 1, "#ffffff", "24px Arial");
      if (ownerNote) {
        wrapText(`Note: ${ownerNote}`, 122, 690, 830, 30, 2, "#d4d4d8", "22px Arial");
      }

      let y = ownerNote ? 770 : 722;
      ctx.fillStyle = "#ffcc19";
      ctx.font = "900 30px Arial";
      ctx.fillText("STOP PLAN", 92, y);
      y += 42;

      if (stopLines.length) {
        stopLines.forEach((line) => {
          fillRoundRect(92, y - 30, 896, 48, 14, "#0f0f0f", "#27272a");
          ctx.fillStyle = "#e4e4e7";
          ctx.font = "24px Arial";
          ctx.fillText(line, 116, y);
          y += 64;
        });
      } else {
        ctx.fillStyle = "#a1a1aa";
        ctx.font = "24px Arial";
        ctx.fillText("No stop plan saved on this card.", 92, y);
        y += 60;
      }

      y += 20;
      ctx.fillStyle = "#ffcc19";
      ctx.font = "900 30px Arial";
      ctx.fillText("PROTECTED CONFLUENCES", 92, y);
      y += 48;

      if (protectedEvidence.length) {
        protectedEvidence.forEach((line) => {
          y = wrapText(line, 92, y, 896, 34, 2, "#d4d4d8", "24px Arial") + 8;
        });
      } else {
        ctx.fillStyle = "#a1a1aa";
        ctx.font = "24px Arial";
        ctx.fillText("No source breakdown saved.", 92, y);
        y += 38;
      }

      y = Math.min(y + 24, 1180);
      ctx.strokeStyle = "#2c2300";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(92, 1198);
      ctx.lineTo(988, 1198);
      ctx.stroke();

      ctx.fillStyle = "#a1a1aa";
      ctx.font = "22px Arial";
      ctx.fillText(`Created: ${anchor.date || "--"}${anchor.updatedAt ? ` | Updated: ${anchor.updatedAt}` : ""}`, 92, 1242);

      ctx.fillStyle = "#ffcc19";
      ctx.font = "900 24px Arial";
      ctx.fillText("PlayMaker Setup Grader", 92, 1278);

      const link = document.createElement("a");
      const price = String(entryValue || "setup").replace(/[^0-9.\-]/g, "");
      link.download = `playmaker-${direction}-${price || "setup"}-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (err) {
      console.error("Playmaker social card screenshot error:", err);
      alert(`Screenshot failed: ${err?.message || err}`);
    }
  };

  useEffect(() => {
    setDraftOwnerNote(verification?.ownerNote || "");
  }, [verification?.ownerNote, verificationKey, verificationBaseKey]);
  return (
    <div
      ref={cardRef}
      onClick={() => onSelect(anchor)}
      className={`cursor-pointer rounded-2xl border bg-[#090909] p-4 text-left transition hover:border-[#ffcc19] ${selected ? "border-[#ffcc19]" : "border-[#2c2300]"}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-full bg-[#ffcc19] px-3 py-1 text-xs font-black text-black">
          {isAi ? (anchor.grade === "A+" ? "👑 CROWN ANCHOR" : "AI LEVEL") : "MANUAL ORDER"}
        </span>
        {isAi && <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs font-black text-zinc-300">Sources {anchor.sourceCount || evidence.length || 0}</span>}
        {verifiedLabel && <span className="rounded-full border border-[#00d27a] bg-[#001a0f] px-3 py-1 text-xs font-black text-[#00d27a]">{verifiedLabel}</span>}
        {filledRecord && <span className="rounded-full border border-[#ffcc19] bg-[#171200] px-3 py-1 text-xs font-black text-[#ffcc19]">FILLED — JOURNAL NEEDED</span>}
      </div>

      <div className="text-xl font-black text-[#00d27a]">
        {String(anchor.direction || "Both").toUpperCase()} SETUP: {anchor.entry ? fmtPrice(anchor.entry) : "--"}
      </div>

      <div className="mt-1 text-sm text-zinc-400">
        Grade {anchor.grade} • Zone {anchor.zoneScore || anchor.score}/100{anchor.precisionScore ? ` • Precision ${anchor.precisionScore}/100` : ""}
      </div>

      {anchor.clusterWidth !== undefined && (
        <div className="mt-1 text-xs text-[#ffcc19]">
          Entry stack {fmtPrice(anchor.entry)} • Full cluster {fmtPrice(anchor.clusterLow)}–{fmtPrice(anchor.clusterHigh)} • Width {fmt(anchor.clusterWidth)} pts
        </div>
      )}

      {anchor.stopPlans && (
        <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-zinc-300">
          {anchor.stopPlans.map((plan) => (
            <div key={plan.stop} className={`rounded border px-2 py-1 ${plan.valid ? "border-[#00d27a]" : "border-zinc-700 text-zinc-500"}`}>
              <div className="font-black">{plan.stop}pt</div>
              <div>{plan.valid ? "OK" : "Too tight"}</div>
              <div className="mt-1 text-[9px]">L {fmtPrice(plan.limit)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 text-xs text-zinc-500">
        Created: {anchor.date || "--"}{anchor.updatedAt ? ` • Updated: ${anchor.updatedAt}` : ""}
      </div>

      {anchor.top && <div className="mt-2 text-xs text-zinc-500">{anchor.top}</div>}

      {isAi && verification?.ownerNote && (
        <div className="mt-3 rounded-xl border border-[#00d27a] bg-[#001a0f] p-3 text-xs text-[#00d27a]">
          <div className="font-black">Owner Signal Note</div>
          <div className="mt-1 text-zinc-100">{verification.ownerNote}</div>
        </div>
      )}

      {ownerMode && isAi && (
        <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-[#ffcc19]">Signal Note</div>
          <textarea
            value={draftOwnerNote}
            onChange={(e) => setDraftOwnerNote(e.target.value)}
            placeholder="Add why you like it, reject it, or what confirmation you need..."
            className="h-20 w-full rounded-xl border border-zinc-700 bg-black p-3 text-xs text-white outline-none focus:border-[#ffcc19]"
          />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onVerify?.(anchor, draftOwnerNote)} className="rounded-lg bg-[#00d27a] px-3 py-2 text-xs font-black text-black">{verifiedLabel ? "Update Verify Note" : "Verify Setup + Save Note"}</button>
            {verifiedLabel && <button onClick={() => onUnverify?.(anchor)} className="rounded-lg border border-red-500 px-3 py-2 text-xs font-black text-red-400">Remove Verify</button>}
          </div>
        </div>
      )}

      <div className="mt-3 grid gap-2" onClick={(e) => e.stopPropagation()}>
        {isPulled && (
          <>
            {ownerMode && (
              <>
            <button
              onClick={() => onRestoreAnchor?.(anchor)}
              className="w-full rounded-lg bg-[#00d27a] px-3 py-2 text-xs font-black text-black hover:bg-[#36ff9f]"
            >
              Restore To Board
            </button>
            <button
              onClick={() => onDeletePulledAnchor?.(anchor)}
              className="w-full rounded-lg border border-red-500 px-3 py-2 text-xs font-black text-red-400 hover:bg-red-950/30"
            >
              Delete From Pulled Orders
            </button>
              </>
            )}
            <button
              onClick={() => onSubmitAnchor?.(anchor, "local")}
              className="w-full rounded-lg bg-[#ffcc19] px-3 py-2 text-xs font-black text-black hover:bg-[#ffe16b]"
            >
              Save Local Journal
            </button>
            {ownerMode && (
              <button
                onClick={() => onSubmitAnchor?.(anchor, "global")}
                className="w-full rounded-lg border border-[#ffcc19] px-3 py-2 text-xs font-black text-[#ffcc19] hover:bg-[#171200]"
              >
                Submit Global Journal
              </button>
            )}
          </>
        )}
        {!isPulled && (
          <>
        {(ownerMode || !isAi) && !isFilledMode && (
        <button
          onClick={() => onMarkFilled?.(anchor)}
          className="w-full rounded-lg border border-[#00d27a] px-3 py-2 text-xs font-black text-[#00d27a] hover:bg-[#001a0f]"
        >
          Move To Filled / Managing
        </button>
        )}
        <button
          onClick={downloadCardScreenshot}
          className="w-full rounded-lg border border-[#ffcc19] px-3 py-2 text-xs font-black text-[#ffcc19] hover:bg-[#171200]"
        >
          Screenshot Card — Social Post
        </button>
        <button
          onClick={() => onSubmitAnchor?.(anchor, "local")}
          className="w-full rounded-lg bg-[#ffcc19] px-3 py-2 text-xs font-black text-black hover:bg-[#ffe16b]"
        >
          Save Local Journal
        </button>
        {ownerMode && (
          <button
            onClick={() => onSubmitAnchor?.(anchor, "global")}
            className="w-full rounded-lg border border-[#ffcc19] px-3 py-2 text-xs font-black text-[#ffcc19] hover:bg-[#171200]"
          >
            Submit Global Journal
          </button>
        )}
        {ownerMode && (
          <button
            onClick={() => onDismissAnchor?.(anchor)}
            className="w-full rounded-lg border border-red-500 px-3 py-2 text-xs font-black text-red-400 hover:bg-red-950/30"
          >
            Pull From Board
          </button>
        )}
          </>
        )}
      </div>

      {isAi && <EvidenceList evidence={evidence} />}
    </div>
  );
}

function LevelSection({ title, subtitle, items = [], selectedTrade, onSelect, ownerMode = false, verifiedAnchors = {}, onVerify, onUnverify, onSubmitAnchor, filledAnchorKeys = {}, onMarkFilled, onDismissAnchor, onRestoreAnchor, onDeletePulledAnchor, mode = "active" }) {
  if (!items.length) return null;
  return (
    <div className="mt-5">
      <div className="mb-3">
        <div className="text-lg font-black text-white">{title}</div>
        {subtitle && <div className="text-sm text-zinc-500">{subtitle}</div>}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {items.map((anchor) => (
          <LevelCard key={anchor.id} anchor={anchor} selectedTrade={selectedTrade} onSelect={onSelect} ownerMode={ownerMode} verifiedAnchors={verifiedAnchors} onVerify={onVerify} onUnverify={onUnverify} onSubmitAnchor={onSubmitAnchor} filledAnchorKeys={filledAnchorKeys} onMarkFilled={onMarkFilled} onDismissAnchor={onDismissAnchor} onRestoreAnchor={onRestoreAnchor} onDeletePulledAnchor={onDeletePulledAnchor} mode={mode} />
        ))}
      </div>
    </div>
  );
}

function Dash({ label, value }) {
  return <div className="rounded-2xl border border-[#2c2300] bg-black p-6 shadow-lg shadow-black/30"><div className="text-lg text-zinc-200">{label}</div><div className="mt-2 text-4xl font-black text-[#ffcc19]">{value}</div></div>;
}

function Procedure() {
  const afterFillRules = [
    "Once an order is filled, the main goal is to target 100 points, recent highs, or recent lows.",
    "If the trade is filled but has not shown its hand yet, read the candles before adding risk.",
    "Watch candle close color and whether candles are wicking out around the gator.",
    "For a bearish idea, if 3-4 closed candles are green, price may come back against the setup. Derisk.",
    "If holding 7 micros, take profit on half when the trade gives room.",
    "Favor taking partial profits over moving the stop too early.",
    "Do not aggressively move the stop until price has pushed through levels.",
    "Always use the fib to see where price is likely to react next."
  ];

  return (
    <div className="mt-7 grid gap-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-black uppercase tracking-[0.2em] text-[#ffcc19]">Playmaker Procedure</div>
            <Title>Procedure</Title>
            <p className="mt-2 max-w-3xl text-zinc-300">
              Follow these rules after a Playmaker order fills.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="text-2xl font-black text-[#ffcc19]">After Fill Management</h2>
        <div className="mt-4 space-y-3">
          {afterFillRules.map((rule) => (
            <div key={rule} className="rounded-xl border border-zinc-800 bg-[#090909] p-3 text-sm text-zinc-200">
              {rule}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Tab({ id, tab, setTab, children }) {
  const active = tab === id;
  return (
    <button
      onClick={() => setTab(id)}
      className={`min-h-12 rounded-2xl border px-4 py-3 text-left text-sm font-black transition ${
        active
          ? "border-[#ffcc19] bg-[#ffcc19] text-black shadow-lg shadow-yellow-950/30"
          : "border-zinc-800 bg-[#090909] text-zinc-400 hover:border-[#ffcc19] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

const playmakerInfoMessage = [
  "Welcome to Playmaker: automatic signals and manual setup grading in one workflow",
  "Playmaker automatic signals work alongside your manual setup grading",
  "Track high-of-day and low-of-day reactions before chasing the candle",
  "Review limit entries, stop plans, and confluence strength before execution",
  "Pulled orders stay parked when the idea is early but the level is still valid",
  "Local journal keeps your private notes; global journal shares member updates",
  "Trade with structure, protect risk, and let the setup prove itself"
].join("   |   ");

const playmakerPromoMessage = [
  "50% off your first month when you follow and like all Playmaker social pages",
  "New members get a 1-on-1 30 minute StreamYard tutorial with Mr. DJ Harrison"
].join("   |   ");

function PlaymakerPromoTicker() {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border-2 border-[#00d27a] bg-[#001a0f] py-4 text-base font-black uppercase tracking-[0.18em] text-[#00d27a] shadow-xl shadow-green-950/40">
      <div className="playmaker-ticker-track whitespace-nowrap">
        <span className="mx-8">{playmakerPromoMessage}</span>
        <span className="mx-8" aria-hidden="true">{playmakerPromoMessage}</span>
      </div>
    </div>
  );
}

function PlaymakerInfoTicker() {
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-[#2c2300] bg-black py-2 text-[11px] font-black uppercase tracking-[0.16em] text-[#ffcc19]">
      <div className="playmaker-ticker-track whitespace-nowrap">
        <span className="mx-8">{playmakerInfoMessage}</span>
        <span className="mx-8" aria-hidden="true">{playmakerInfoMessage}</span>
      </div>
    </div>
  );
}

function SocialLinks() {
  return (
    <div className="mt-4 border-t border-zinc-800 pt-4">
      <div className="text-xs font-black uppercase tracking-[0.16em] text-[#ffcc19]">Follow Playmaker</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {socialLinks.map((link) => (
          <a
            key={`${link.label}-${link.href}`}
            href={link.href}
            target="_blank"
            rel="me noreferrer"
            onClick={() => trackHomeClick(`social_${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, {
              pageArea: "social_links",
              linkUrl: link.href,
              buttonText: link.label
            })}
            className="rounded-xl border border-zinc-800 bg-[#090909] px-3 py-2 text-center text-xs font-black text-zinc-300 transition hover:border-[#ffcc19] hover:text-[#ffcc19]"
          >
            {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}

function HighlightVideo() {
  return (
    <div className="mt-4 border-t border-zinc-800 pt-4">
      <div className="text-xs font-black uppercase tracking-[0.16em] text-[#ffcc19]">Last Week's Highlights</div>
      <div className="mt-3 overflow-hidden rounded-xl border border-zinc-800 bg-[#090909]">
        <video
          className="aspect-video w-full"
          controls
          playsInline
          preload="metadata"
          src="/playmaker-demo.mp4"
          onPlay={() => trackHomeClick("highlight_video_play", { pageArea: "highlight_video", buttonText: "Play highlight video" })}
          onPause={() => trackHomeClick("highlight_video_pause", { pageArea: "highlight_video", buttonText: "Pause highlight video" })}
          onEnded={() => trackHomeClick("highlight_video_complete", { pageArea: "highlight_video", buttonText: "Complete highlight video" })}
        >
          Your browser does not support the Playmaker highlights video.
        </video>
      </div>
      <a
        href={YOUTUBE_DEMO_URL}
        target="_blank"
        rel="noreferrer"
        onClick={() => trackHomeClick("tutorial_video_youtube", {
          pageArea: "highlight_video",
          linkUrl: YOUTUBE_DEMO_URL,
          buttonText: "Tutorial Video"
        })}
        className="mt-3 inline-flex w-full justify-center rounded-xl border border-zinc-800 bg-[#090909] px-4 py-2 text-xs font-black text-zinc-300 transition hover:border-[#ffcc19] hover:text-[#ffcc19]"
      >
        Tutorial Video
      </a>
    </div>
  );
}

function PolicyLinks({ onOpen }) {
  const links = [
    { key: "privacy", label: "Privacy Policy" },
    { key: "terms", label: "Terms" },
    { key: "risk", label: "Risk Disclaimer" },
    { key: "contact", label: "Contact" }
  ];
  const publicPages = [
    { href: "/about.html", label: "About" },
    { href: "/how-it-works.html", label: "How It Works" },
    { href: "/trading-journal.html", label: "Trading Journal" },
    { href: "/nq-futures-trading-app.html", label: "NQ Futures App" },
    { href: "/futures-trading-signals.html", label: "Signals" },
    { href: "/high-of-day-low-of-day.html", label: "Reversals" },
    { href: "/manual-trade-grading.html", label: "Manual Grading" },
    { href: "/backlinks.html", label: "Official Links" }
  ];

  return (
    <div className="mt-4 border-t border-zinc-800 pt-4">
      <div className="mb-3 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs">
        {publicPages.map((link) => (
          <a
            key={link.href}
            href={link.href}
            onClick={() => trackHomeClick(`seo_${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, {
              pageArea: "public_page_links",
              linkUrl: link.href,
              buttonText: link.label
            })}
            className="font-black text-[#ffcc19] underline-offset-4 hover:underline"
          >
            {link.label}
          </a>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs">
        {links.map((link) => (
          <button
            key={link.key}
            type="button"
            onClick={() => {
              trackHomeClick(`policy_${link.key}`, { pageArea: "policy_links", buttonText: link.label });
              onOpen(link.key);
            }}
            className="font-bold text-zinc-400 underline-offset-4 hover:text-[#ffcc19] hover:underline"
          >
            {link.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PolicyModal({ policyKey, onClose }) {
  const policy = policyContent[policyKey];
  if (!policy) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#2c2300] bg-[#080808] p-5 text-left shadow-2xl shadow-black">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-[#ffcc19]">Playmaker</div>
            <h2 className="mt-2 text-2xl font-black text-white">{policy.title}</h2>
            <p className="mt-1 text-xs text-zinc-500">Last updated July 3, 2026</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-black text-zinc-300 hover:border-[#ffcc19] hover:text-[#ffcc19]"
          >
            Close
          </button>
        </div>
        <div className="mt-5 space-y-3 text-sm leading-6 text-zinc-300">
          {policy.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({ children, className = "", ...props }) {
  return <div {...props} className={`rounded-3xl border border-[#2c2300] bg-black p-6 shadow-xl shadow-black/30 ${className}`}>{children}</div>;
}

function Title({ children }) {
  return <h2 className="text-2xl font-black">{children}</h2>;
}

function Field({ label, value, onChange, disabled }) {
  return <label className="block"><span className="mb-2 block text-sm text-zinc-300">{label}</span><input disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-[#0b0b0b] px-4 py-3 text-white outline-none focus:border-[#ffcc19] disabled:opacity-40" /></label>;
}

function PointStepper({ label, value, onChange, step = 1 }) {
  const adjust = (amount) => {
    const next = Math.round((n(value, 0) + amount) * 100) / 100;
    onChange(String(next));
  };

  return (
    <label className="block">
      <span className="mb-2 block text-sm text-zinc-300">{label}</span>
      <div className="grid grid-cols-[44px_1fr_44px] overflow-hidden rounded-lg border border-zinc-700 bg-[#0b0b0b] focus-within:border-[#ffcc19]">
        <button type="button" onClick={() => adjust(-step)} className="border-r border-zinc-800 text-xl font-black text-[#ffcc19] hover:bg-[#171200]">-</button>
        <input value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 bg-transparent px-4 py-3 text-center text-white outline-none" />
        <button type="button" onClick={() => adjust(step)} className="border-l border-zinc-800 text-xl font-black text-[#00d27a] hover:bg-[#001a0f]">+</button>
      </div>
    </label>
  );
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
  const isInvalid = r.valid === false;
  return (
    <div className={`rounded-2xl border bg-[#090909] p-4 ${isInvalid ? "border-zinc-700 opacity-70" : "border-zinc-800"}`}>
      <div className="flex items-center justify-between">
        <div className="text-lg font-black text-[#ffcc19]">{r.stop}pt Stop</div>
        <div className={`rounded-full px-3 py-1 text-xs font-black ${isInvalid ? "bg-zinc-700 text-zinc-300" : "bg-[#00d27a] text-black"}`}>{r.confidence}</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Small label="Limit / Entry" value={fmt(r.limit)} />
        <Small label="Stop Area" value={fmt(r.stopArea)} />
      </div>
      <p className="mt-3 text-sm text-zinc-400">Based on: {r.match}</p>
      {r.note && <p className="mt-1 text-xs text-zinc-500">{r.note}</p>}
    </div>
  );
}

function Small({ label, value }) {
  return <div className="rounded-xl border border-zinc-800 bg-black p-3"><div className="text-xs text-zinc-500">{label}</div><div className="font-black">{value}</div></div>;
}

function AutomaticSignalResults({ stats }) {
  return <RollingSevenStats stats={stats?.rolling7} title="Automatic Signal Results" />;
}

function JournalPointsCounter({ stats }) {
  const totalPoints = Number(stats?.totalPoints) || 0;
  const pointsColor = totalPoints < 0 ? "text-[#ff4d4d]" : "text-[#00f09a]";
  return (
    <div className="mt-4 rounded-2xl border border-[#2c2300] bg-black p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#ffcc19]">Journal Points Counter</div>
          <div className="mt-1 text-3xl font-black">
            <span className={pointsColor}>{formatSignedPoints(totalPoints)}</span> NQ points
          </div>
        </div>
        <div className="text-right text-xs font-black text-zinc-300">
          W {stats.wins} / L {stats.losses} / BE {stats.be}<br />
          {stats.winRate}% win rate - {stats.closed} closed
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <Small label="Total Trades" value={stats.total} />
        <Small label="Unfilled" value={stats.unfilled} />
        <Small label="Avg Max Move" value={fmt(stats.avgMove)} />
        <Small label="Avg Drawdown" value={fmt(stats.avgDrawdown)} />
      </div>
      <RollingSevenStats stats={stats.rolling7} />
    </div>
  );
}

function RollingSevenStats({ stats, title = "Rolling 7 Days" }) {
  const data = stats || { trades: 0, wins: 0, losses: 0, be: 0, winRate: 0, points: 0 };
  const fallbackToday = new Date();
  fallbackToday.setHours(0, 0, 0, 0);
  const fallbackDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(fallbackToday);
    date.setDate(fallbackToday.getDate() - (6 - index));
    return { label: formatJournalDay(date), points: 0 };
  });
  const days = data.days?.length ? data.days : fallbackDays;
  const values = days.map((day) => Number(day.points) || 0);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  const chartPoints = values
    .map((value, index) => {
      const x = 8 + (index * 104) / Math.max(days.length - 1, 1);
      const y = 34 - ((value - min) / range) * 24;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const zeroY = 34 - ((0 - min) / range) * 24;
  const today = data.today || days[days.length - 1] || { label: "Today", points: 0 };
  const totalPointsColor = Number(data.points) < 0 ? "text-[#ff4d4d]" : "text-[#00f09a]";
  const todayPointsColor = Number(today.points) < 0 ? "text-[#ff4d4d]" : "text-[#00f09a]";
  const tickerDays = [...days, ...days];
  return (
    <div className="mt-3 rounded-xl border border-[#2c2300] bg-black p-3 text-white shadow-lg shadow-black/40">
      <div className="text-[10px] font-black uppercase tracking-[0.18em]">{title}</div>
      <div className="mt-1 flex items-center justify-between gap-3 text-[11px] font-black text-white">
        <span>{data.rangeLabel || "Last 7 days"}</span>
        <span className="text-right">{today.label}: <span className={todayPointsColor}>{formatSignedPoints(today.points)} NQ</span></span>
      </div>
      <div className="mt-2 overflow-hidden rounded-lg border border-zinc-800 bg-[#090909] py-1 text-[10px] font-black uppercase tracking-[0.14em]">
        <div className="playmaker-ticker-track whitespace-nowrap" style={{ animationDuration: "92s" }}>
          {tickerDays.map((day, index) => {
            const color = Number(day.points) < 0 ? "text-[#ff4d4d]" : "text-[#00f09a]";
            return (
              <span key={`${day.label}-${index}`} className="mr-8 inline-flex gap-2">
                <span className="text-white">{day.label}</span>
                <span className={color}>{formatSignedPoints(day.points)} NQ</span>
              </span>
            );
          })}
        </div>
      </div>
      <div className="mt-1 text-lg font-black"><span className={totalPointsColor}>{formatSignedPoints(data.points)}</span> NQ points</div>
      <svg viewBox="0 0 120 42" className="mt-2 h-12 w-full overflow-visible rounded-lg border border-zinc-800 bg-[#090909]">
        <line x1="6" x2="114" y1={zeroY} y2={zeroY} stroke="#3f3f46" strokeWidth="1" strokeDasharray="3 3" />
        <polyline points={chartPoints} fill="none" stroke="#ffcc19" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {values.map((value, index) => {
          const x = 8 + (index * 104) / Math.max(days.length - 1, 1);
          const y = 34 - ((value - min) / range) * 24;
          return <circle key={`${days[index]?.label || index}-${index}`} cx={x} cy={y} r="2.4" fill={value >= 0 ? "#00f09a" : "#ff4d4d"} />;
        })}
      </svg>
      <div className="mt-1 text-xs font-black">
        W {data.wins} / L {data.losses} / BE {data.be} • {data.winRate}% • {data.trades} trades
      </div>
    </div>
  );
}

function Breakdown({ report, recommendations, tips }) {
  return <div className="mt-6 grid gap-5 lg:grid-cols-2"><Card><Title>Adjusted Recommendations</Title><div className="mt-4 space-y-3">{recommendations.map((r) => <Rec key={r.stop} r={r} />)}</div></Card><Card><Title>Tips</Title><div className="mt-4 space-y-3">{tips.map((t, i) => <div key={i} className="rounded-xl border border-[#2c2300] bg-[#0b0b0b] p-4 text-zinc-200">{t}</div>)}</div></Card><Card className="lg:col-span-2"><Title>Score Breakdown</Title><div className="mt-4 grid gap-3 md:grid-cols-4"><Small label="Zone Score" value={`${report.zoneScore}/100`} /><Small label="Precision Grade Score" value={`${report.score}/100`} /><Small label="Top 3 Within 5" value={`${report.topWithin5}/3`} /><Small label="Far Levels 8+" value={report.farCount} /></div><div className="mt-4 rounded-xl border border-[#2c2300] bg-[#0b0b0b] p-4 text-sm text-zinc-300">Raw points still count the reaction zone. The grade is capped by entry precision: top-weighted confluences need to align within 3–5 points for A/A+.</div><div className="mt-4 grid gap-3 md:grid-cols-2">{report.rows.map((r) => <div key={r.key} className="rounded-xl border border-zinc-800 bg-[#090909] p-4"><div className="flex justify-between"><b>{r.name}</b><b className="text-[#ffcc19]">{r.score.toFixed(1)}</b></div><div className="mt-1 text-sm text-zinc-500">Base {r.base} • Away {r.pointsAway} • {r.note}</div></div>)}</div></Card></div>;
}

function Journal({ journal, totalJournalCount = 0, journalStats, journalFilter, setJournalFilter, saveTrade, editTrade, deleteJournalEntry, exportJournalCSV, form, set, editingId, handleImageUpload }) {
  const stats = journalStats || { total: 0, closed: 0, wins: 0, losses: 0, be: 0, unfilled: 0, winRate: 0, totalPL: 0, totalPoints: 0, avgPL: 0, avgMove: 0, avgDrawdown: 0, avgDiscount: 0 };
  const activePreset = journalFilter?.preset || "all";
  const setPreset = (preset) => {
    setJournalFilter((prev) => ({
      ...prev,
      preset,
      ...(preset === "custom" ? {} : { startDate: "", endDate: "" })
    }));
  };
  const setCustomDate = (key, value) => {
    setJournalFilter((prev) => ({
      ...prev,
      preset: "custom",
      [key]: value
    }));
  };
  const filterButtons = [
    ["all", "All"],
    ["today", "Today"],
    ["yesterday", "Yesterday"],
    ["last7", "7 Days"],
    ["last30", "30 Days"],
    ["custom", "Custom"]
  ];

  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-[420px_1fr]">
      <Card id="journal-report-form">
        <Title>{editingId ? "Edit Report" : "Report Result"}</Title>
        <div className="mt-5 grid gap-4">
          <Select label="Result" value={form.result} options={["Win", "Loss", "BE", "Unfilled"]} onChange={(v) => set("result", v)} />
          <PointStepper label="Max Move Points" value={form.maxMove} onChange={(v) => set("maxMove", v)} />
          <PointStepper label="Max Drawdown Points" value={form.maxDrawdown} onChange={(v) => set("maxDrawdown", v)} />
          <Field label="Profit / Loss $" value={form.profitLoss} onChange={(v) => set("profitLoss", v)} />
          <div className="grid gap-4 md:grid-cols-2">
            <PointStepper label="Discount Points" value={form.discountPoints || ""} onChange={(v) => set("discountPoints", v)} />
            <PointStepper label="Max Discount Points" value={form.maxDiscountPoints || ""} onChange={(v) => set("maxDiscountPoints", v)} />
          </div>
          <label>
            <span className="mb-2 block text-sm text-zinc-300">Notes</span>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className="h-28 w-full rounded-lg border border-zinc-700 bg-[#0b0b0b] p-4 text-white outline-none focus:border-[#ffcc19]" />
          </label>
          <label>
            <span className="mb-2 block text-sm text-zinc-300">Trade Pictures / Screenshots</span>
            <input type="file" multiple accept="image/*" onChange={handleImageUpload} className="w-full rounded-lg border border-zinc-700 bg-[#0b0b0b] px-4 py-3 text-white" />
          </label>
          {form.tradeImages?.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {form.tradeImages.map((img, i) => <img key={i} src={img} alt="trade" className="h-32 w-full rounded-xl object-cover border border-zinc-800" />)}
            </div>
          )}
          <button onClick={saveTrade} className="rounded-xl bg-[#ffcc19] py-3 font-black text-black">
            {editingId || form.result !== "Unfilled" ? "Save Result" : "Save To Journal"}
          </button>
        </div>
      </Card>

      <Card>
        <div className="mb-6 rounded-2xl border border-zinc-800 bg-[#090909] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-[#ffcc19]">Journal Report Filter</div>
              <div className="mt-1 text-sm text-zinc-400">
                Showing {journal.length} of {totalJournalCount} entries - {journalFilterLabel(journalFilter)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setJournalFilter({ preset: "all", startDate: "", endDate: "" })}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-black text-zinc-200 hover:border-[#ffcc19]"
            >
              Clear
            </button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {filterButtons.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPreset(value)}
                className={`rounded-xl border px-3 py-2 text-sm font-black ${activePreset === value ? "border-[#ffcc19] bg-[#ffcc19] text-black" : "border-zinc-700 bg-black text-zinc-300 hover:border-[#ffcc19]"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-zinc-400">Start Date</span>
              <input
                type="date"
                value={journalFilter?.startDate || ""}
                onChange={(e) => setCustomDate("startDate", e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-black px-4 py-3 text-white outline-none focus:border-[#ffcc19]"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-zinc-400">End Date</span>
              <input
                type="date"
                value={journalFilter?.endDate || ""}
                onChange={(e) => setCustomDate("endDate", e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-black px-4 py-3 text-white outline-none focus:border-[#ffcc19]"
              />
            </label>
          </div>
        </div>

        <Title>Journal Dashboard</Title>
        <JournalPointsCounter stats={stats} />
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Small label="Total Trades" value={stats.total} />
          <Small label="Closed" value={stats.closed} />
          <Small label="Win %" value={`${stats.winRate}%`} />
          <Small label="Total P/L" value={fmt(stats.totalPL)} />
          <Small label="Total Points" value={`${formatSignedPoints(stats.totalPoints)} NQ`} />
          <Small label="Wins" value={stats.wins} />
          <Small label="Losses" value={stats.losses} />
          <Small label="BE" value={stats.be} />
          <Small label="Unfilled" value={stats.unfilled} />
          <Small label="Avg P/L" value={fmt(stats.avgPL)} />
          <Small label="Avg Max Move" value={fmt(stats.avgMove)} />
          <Small label="Avg Drawdown" value={fmt(stats.avgDrawdown)} />
          <Small label="Avg Discount" value={fmt(stats.avgDiscount)} />
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <Title>Journal</Title>
          <button onClick={() => exportJournalCSV(journal)} className="rounded-xl bg-[#ffcc19] px-5 py-3 font-black text-black">Export Journal CSV</button>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-400">
              <tr>
                <th className="p-3">Date</th>
                <th>Entry</th>
                <th>Dir</th>
                <th>Grade</th>
                <th>Result</th>
                <th>Discount</th>
                <th>Top Confluence</th>
                <th>P/L</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {journal.map((j) => (
                <React.Fragment key={j.id}>
                  <tr className="border-t border-zinc-800">
                    <td className="p-3">{j.date}</td>
                    <td>{fmtPrice(j.entry)}</td>
                    <td>{j.direction}</td>
                    <td>{j.grade} {j.score}</td>
                    <td>{j.result}</td>
                    <td>{j.discountPoints || "--"}</td>
                    <td>{j.top}</td>
                    <td>{j.profitLoss}</td>
                    <td>
                      <div className="flex gap-3">
                        <button type="button" onClick={() => editTrade(j)} className="text-[#ffcc19] font-bold">Edit</button>
                        <button type="button" onClick={() => deleteJournalEntry?.(j)} className="text-red-400 font-bold">Delete</button>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan="9" className="px-3 pb-5">
                      {j.notes && <div className="mb-3 text-zinc-400">{j.notes}</div>}
                      {j.tradeImages?.length > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {j.tradeImages.map((img, idx) => <img key={idx} src={img} alt="journal" className="h-32 w-full rounded-xl object-cover border border-zinc-800" />)}
                        </div>
                      )}
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {journal.length === 0 && <div className="p-6 text-zinc-500">No saved trades yet.</div>}
        </div>
      </Card>
    </div>
  );
}

function Behavior({ behavior, journal, learningStats = [] }) {
  return <div className="mt-6 grid gap-5 lg:grid-cols-2"><Card><Title>Behavior Rating</Title><div className="mt-6 text-7xl font-black text-[#00d27a]">{behavior.score}/10</div><p className="mt-3 text-zinc-300">Based on saved results and notes. Notes mentioning chasing/late reduce behavior score. Notes mentioning patience/followed plan improve it.</p><div className="mt-5 grid grid-cols-4 gap-3"><Small label="Trades" value={behavior.total} /><Small label="Wins" value={behavior.wins} /><Small label="Losses" value={behavior.losses} /><Small label="BE" value={behavior.be} /></div></Card><Card><Title>Private AI Result Learning</Title><p className="mt-2 text-sm text-zinc-400">Only your logged-in account sees this. It calculates which source families and repeat-level combinations are working from your saved results.</p><div className="mt-4 space-y-3">{learningStats.slice(0,8).map((row) => <div key={row.name} className="rounded-xl border border-zinc-800 bg-[#090909] p-4"><div className="flex items-center justify-between gap-3"><b className="text-[#ffcc19]">{row.name}</b><span className="font-black text-[#00d27a]">{row.winRate}%</span></div><div className="mt-1 text-xs text-zinc-500">Trades {row.trades} • Wins {row.wins} • Losses {row.losses} • BE {row.be} • 200+ moves {row.bigMove200 || 0} • Avg move {fmt(row.avgMaxMove)} • Avg DD {fmt(row.avgDrawdown)}</div></div>)}{learningStats.length === 0 && <div className="text-zinc-500">Save completed trade results to populate AI learning stats.</div>}</div></Card><Card className="lg:col-span-2"><Title>Behavior Notes</Title><div className="mt-4 space-y-3">{journal.slice(0,5).map((j) => <div key={j.id} className="rounded-xl border border-zinc-800 bg-[#090909] p-4"><b>{j.result}</b><p className="mt-1 text-zinc-400">{j.notes || "No notes"}</p></div>)}{journal.length === 0 && <div className="text-zinc-500">Save journal results to populate behavior reports.</div>}</div></Card></div>;
}

