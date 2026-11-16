// Type-level regression check, compiled by `tsc --noEmit` and never imported.
// syncAll once passed syncProvider straight to Array.map, so each provider got its array
// index as the lookback in days (0, 1, 2...). syncProvider's options object makes that a
// type error; if the signature goes back to a positional number, this directive goes unused
// and tsc fails.
import { syncProvider } from "./sync";

// @ts-expect-error passing syncProvider to map would hand it the array index as options
export const _bareMap = ["anthropic"].map(syncProvider);
