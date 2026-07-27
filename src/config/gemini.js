// Model tiering lives here so a change is one line (vision §3).
// Default amended July 2026 (plan §6.2): real-world use of 3.6-flash on actual
// thrift items replaced the staged V0 model check.
export const GEMINI_MODEL = 'gemini-3.6-flash';

// Budget fallback for quota exhaustion, not quality. Named, not yet wired.
export const GEMINI_FALLBACK = 'gemini-3-flash-preview';

// The pencil floor's canonical $46.50 example assumes gp=8, shipping=12 —
// not calcProfit's 5.00 default, which stays for the listing/draft paths.
export const DEFAULT_SHIPPING = 12;
