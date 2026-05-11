const etDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

export function toEasternDate(d: Date): string {
  return etDateFmt.format(d);
}
