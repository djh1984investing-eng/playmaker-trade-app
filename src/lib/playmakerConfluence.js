export const maxConfluenceDistancePoints = 15;
export const maxOrderCardDistancePoints = 2000;

const TICK_SIZE = 0.25;

export const roundToTick = (price) => {
  const parsed = Number(price);
  if (!Number.isFinite(parsed)) return price;
  return Math.round(parsed / TICK_SIZE) * TICK_SIZE;
};

export const n = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const isYes = (value) => value === "Yes";
export const fmt = (value) => Number(value).toFixed(2);

export const parsePrice = (value) => {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

export const fmtPrice = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "--";
};

export const firstDefined = (...values) =>
  values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");

export const objectFromMaybeJson = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_err) {
    return {};
  }
};

export const levelKeyFromName = (name) => {
  const text = String(name ?? "").trim();
  if (!text) return "";
  if (["ce", "mid", "mean", "0", "0.0", "0.00"].includes(text.toLowerCase())) return "ce";
  const sign = text.startsWith("-") ? "neg" : "pos";
  const clean = text.replace("+", "").replace("-", "").replace(".", "_").replace(/[^0-9_]/g, "");
  return clean ? `${sign}_${clean}` : "";
};

export const getNestedLevelValue = (payload, label) => {
  const levels = payload?.levels && typeof payload.levels === "object" ? payload.levels : {};
  const key = levelKeyFromName(label);
  const text = String(label);
  const numeric = text.replace("+", "").replace("-", "");
  const sign = text.startsWith("-") ? "neg" : "pos";
  const alt = numeric.replace(".", "_");
  return firstDefined(
    payload?.[key], levels?.[key],
    payload?.[`stdv_${key}`], levels?.[`stdv_${key}`],
    payload?.[`session_${key}`], levels?.[`session_${key}`],
    payload?.[`ext_${key}`], levels?.[`ext_${key}`],
    payload?.[`ext_${sign}_${alt}`], levels?.[`ext_${sign}_${alt}`],
    payload?.[`fib_${alt}`], levels?.[`fib_${alt}`],
    payload?.[`ote_${alt}`], levels?.[`ote_${alt}`],
    payload?.[`plus_${alt}`], levels?.[`plus_${alt}`],
    payload?.[`minus_${alt}`], levels?.[`minus_${alt}`],
    payload?.[text], levels?.[text]
  );
};

export const isGenericPriceAlertSignal = (signal) => {
  const payload = {
    ...objectFromMaybeJson(signal?.payload),
    ...objectFromMaybeJson(signal?.raw_json),
    ...objectFromMaybeJson(signal?.raw),
    ...signal
  };
  const text = String(firstDefined(payload.signal, payload.setup, payload.source, payload.alert_name, signal?.signal, "") || "").toUpperCase();
  const structured = ["CONFLUENCE", "SESSION_DEVIATION", "VOLUME_PROFILE", "ORDER_BLOCK", "REJECTION_BLOCK", "RETRACE", "RETRACEMENT", "EXTENSION", "PLAYMAKER"].some((token) => text.includes(token));
  return !structured && (text.includes("PRICE_ALERT") || text.includes("PRICE ALERT") || text === "ALERT" || text === "ALERT()" || text.includes("CROSSING"));
};

export const uniqueEvidenceByPriceAndLabel = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const price = parsePrice(item?.price);
    if (price === null) return false;
    const key = `${item.sourceType}|${item.label}|${Math.round(price * 4) / 4}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const parseYesNo = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  if (["yes", "true", "1", "y", "on", "bullish", "long", "buy"].includes(text)) return "Yes";
  if (["no", "false", "0", "n", "off", "bearish", "short", "sell"].includes(text)) return "No";
  return null;
};

export const normalizeRetrace = (value) => {
  const parsed = parsePrice(value);
  if (parsed === null) return "None";
  const abs = Math.abs(parsed);
  const choices = [0.5, 0.618, 0.705, 0.786];
  const closest = choices.reduce((best, current) => Math.abs(current - abs) < Math.abs(best - abs) ? current : best, choices[0]);
  return closest === 0.5 ? "0.50" : String(closest);
};

export const normalizeSTDV = (value) => {
  const parsed = parsePrice(value);
  if (parsed === null) return "0";
  return String(parsed);
};

export const normalizeStatus = (value) => String(value ?? "").trim().toLowerCase();

export function grade(score) {
  if (score >= 92) return ["A+", "Elite Setup"];
  if (score >= 84) return ["A", "High Probability"];
  if (score >= 74) return ["B+", "Strong Setup"];
  if (score >= 65) return ["B", "Tradable Setup"];
  if (score >= 55) return ["C", "Needs Confirmation"];
  return ["D", "Wait / Low Quality"];
}

export function dirSide(direction) {
  return direction === "Long" ? -1 : 1;
}

export const levelMergeTolerance = 15;

export const arrayFromMaybe = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch (_err) {}
    return text.split(",").map((part) => part.trim()).filter(Boolean);
  }
  return [value];
};

export const getSignalPayload = (signal) => ({
  ...objectFromMaybeJson(signal?.payload),
  ...objectFromMaybeJson(signal?.raw_json),
  ...objectFromMaybeJson(signal?.raw),
  ...signal
});

export const scoreDistance = (distance, tight, medium, wide) => {
  if (!Number.isFinite(distance)) return 0;
  if (distance <= tight) return 1;
  if (distance <= medium) return 0.72;
  if (distance <= wide) return 0.42;
  return 0;
};

export const getLevelKey = (price) => {
  const parsed = parsePrice(price);
  if (parsed === null) return "na";
  return String(Math.round(parsed / 5) * 5);
};

export const uniqueSortedPrices = (items) => {
  const seen = new Set();
  return items
    .map((item) => parsePrice(item.price))
    .filter((price) => price !== null && price > 0)
    .sort((a, b) => a - b)
    .filter((price) => {
      const key = String(Math.round(price * 4) / 4);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const clusterPrecisionFromWidth = (width) => {
  const w = Math.abs(n(width));
  if (w <= 5) return 100;
  if (w <= 10) return 90;
  if (w <= 15) return 80;
  if (w <= 20) return 70;
  if (w <= 30) return 55;
  return 40;
};

export const clusterStatusFromWidth = (width) => {
  const w = Math.abs(n(width));
  if (w <= 5) return "PINPOINT LIMIT CLUSTER";
  if (w <= 10) return "TIGHT LIMIT CLUSTER";
  if (w <= 20) return "TRADABLE LIMIT CLUSTER";
  if (w <= 30) return "WIDE WATCHLIST CLUSTER";
  return "TOO WIDE / SPLIT ZONE";
};

export const entryCenterWeight = (item) => {
  const source = String(item?.sourceType || "");
  const label = String(item?.label || "");
  if (source.includes("POC")) return 10;
  if (source.includes("LVN") || source.includes("Crater")) return 9;
  if (source.includes("OTE") || label.includes("0.618") || label.includes("0.705") || label.includes("0.786")) return 8;
  if (label.includes("CE") || source.includes("Order Block") || source.includes("Rejection Block")) return 7;
  if (source.includes("PlayMaker")) return 6;
  if (source.includes("STDV") || source.includes("Deviation")) return 4;
  if (source.includes("Weekly")) return 3;
  return 2;
};

export const findBestEntryStack = (evidence = [], fallbackCenter = 0) => {
  const usable = evidence
    .map((item) => ({ ...item, price: parsePrice(item.price), weight: entryCenterWeight(item) + Math.min(8, n(item.evidenceScore ?? item.score) / 8) }))
    .filter((item) => item.price !== null && item.price > 0);

  if (!usable.length) {
    return { center: fallbackCenter, low: fallbackCenter, high: fallbackCenter, width: 0, count: 0, labels: [] };
  }

  let best = null;
  usable.forEach((anchor) => {
    const stack = usable.filter((item) => Math.abs(item.price - anchor.price) <= 6);
    const score = stack.reduce((sum, item) => sum + item.weight, 0) + stack.length * 2;
    if (!best || score > best.score || (score === best.score && stack.length > best.stack.length)) {
      best = { stack, score };
    }
  });

  const stack = best?.stack?.length ? best.stack : usable;
  const totalWeight = stack.reduce((sum, item) => sum + item.weight, 0) || 1;
  const center = stack.reduce((sum, item) => sum + item.price * item.weight, 0) / totalWeight;
  const prices = stack.map((item) => item.price).sort((a, b) => a - b);

  return {
    center,
    low: prices[0],
    high: prices[prices.length - 1],
    width: Math.max(0, prices[prices.length - 1] - prices[0]),
    count: stack.length,
    labels: stack.slice(0, 6).map((item) => item.label || item.sourceType)
  };
};

export const buildStopPlansForCluster = (direction, low, high, zoneCenter, stackCenter, precisionLow, precisionHigh) => {
  const zoneWidth = Math.max(0, high - low);
  const precisionWidth = Math.max(0, (precisionHigh ?? stackCenter) - (precisionLow ?? stackCenter));
  const buffer = 2;
  const dir = String(direction || "").toLowerCase();
  const isShort = dir.includes("short");
  const entryCore = Number.isFinite(stackCenter) ? stackCenter : zoneCenter;
  const protectiveEntry = isShort ? Math.max(entryCore, zoneCenter) : Math.min(entryCore, zoneCenter);

  return [7, 10, 15].map((stop) => {
    const needed = precisionWidth / 2 + buffer;
    const valid = stop >= needed;
    const rawLimit = stop <= 7
      ? entryCore
      : stop <= 10
        ? (entryCore * 0.75 + zoneCenter * 0.25)
        : protectiveEntry;
    const limit = roundToTick(rawLimit);
    const stopArea = roundToTick(isShort ? limit + stop : limit - stop);
    return {
      stop,
      limit,
      stopArea,
      valid,
      neededStop: needed,
      confidence: valid ? (stop <= 7 ? "Pinpoint stack" : stop <= 10 ? "Balanced stack" : "Protected stack") : "Too Tight",
      note: valid
        ? `Entry centered from strongest confluence stack, not full zone. Stack width ${fmt(precisionWidth)} pts / full zone ${fmt(zoneWidth)} pts.`
        : `This stop is tight for the strongest stack. Stack needs about ${fmt(needed)} pts before buffer.`
    };
  });
};

export const deviationAbsFromLabel = (label) => {
  const match = String(label || "").match(/[-+]?\d+(?:\.\d+)?/);
  return match ? Math.abs(Number(match[0])) : 0;
};

export const deviationEvidenceScore = (label) => {
  const value = deviationAbsFromLabel(label);
  if (value >= 6) return 52;
  if (value >= 5.5) return 48;
  if (value >= 5) return 44;
  if (value >= 4.5) return 40;
  if (value >= 4) return 36;
  if (value >= 3.5) return 31;
  if (value >= 3) return 26;
  if (value >= 2.5) return 16;
  if (value >= 2) return 12;
  if (value >= 1.5) return 9;
  if (value >= 1) return 6;
  if (value >= 0.705) return 4;
  if (value >= 0.5) return 3;
  return 0;
};

export const timeframeFromPayload = (payload, fallback = "") => {
  const raw = String(firstDefined(payload.timeframe, payload.interval, payload.tf, fallback) || "").toUpperCase();
  if (raw === "D" || raw.includes("DAILY") || raw.includes("1D")) return "D";
  if (raw.includes("240") || raw.includes("4H")) return "4H";
  if (raw.includes("60") || raw.includes("1H")) return "1H";
  if (raw.includes("15")) return "15m";
  if (raw.includes("5")) return "5m";
  return "";
};

export const structureEvidenceScore = (payload, fallback, type) => {
  const tf = timeframeFromPayload(payload, fallback);
  const isRB = String(type || "").toUpperCase().includes("REJECTION");
  if (tf === "4H") return isRB ? 18 : 20;
  if (tf === "1H") return isRB ? 13 : 15;
  if (tf === "15m") return isRB ? 5 : 6;
  if (tf === "5m") return 0;
  return isRB ? 8 : 9;
};

export const craterQualityScore = (crater) => {
  if (!crater) return 0;
  const width = n(crater.width);
  const widthScore = width >= 120 ? 28 : width >= 80 ? 24 : width >= 50 ? 18 : width >= 25 ? 12 : 7;
  const locationScore = crater.inside ? 18 : 16 * scoreDistance(crater.distance, 3, 7, 15);
  return widthScore + locationScore;
};
