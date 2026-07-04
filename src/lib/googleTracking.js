const GOOGLE_ADS_ID = import.meta.env.VITE_GOOGLE_ADS_ID || "AW-18068394381";
const GOOGLE_ADS_CONVERSION_LABEL = import.meta.env.VITE_GOOGLE_ADS_CONVERSION_LABEL || "2Ku8CNzH4bocEI2j16dD";

export function trackBuyAccessClick() {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;

  window.gtag("event", "conversion", {
    send_to: `${GOOGLE_ADS_ID}/${GOOGLE_ADS_CONVERSION_LABEL}`
  });
}
