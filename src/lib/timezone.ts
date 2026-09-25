const etDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

export function toEasternDate(d: Date): string {
  return etDateFmt.format(d);
}

// Shift a YYYY-MM-DD date by whole days. Pure string arithmetic (no clock, no local TZ).
export function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
