/** Wall clock for the sim's calendar features (daily contracts, streak, businesses). */
export function localDay(nowMs = Date.now()): number {
  return Math.floor((nowMs - new Date(nowMs).getTimezoneOffset() * 60000) / 86400000);
}

export const nowSeconds = (nowMs = Date.now()) => Math.floor(nowMs / 1000);
