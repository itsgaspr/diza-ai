export function hourInZone(now: number, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  }).format(new Date(now));
  const value = Number(hour);
  return value === 24 ? 0 : value;
}

export function isQuietHour(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function startOfLocalDay(now: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  const hour = pick("hour") === 24 ? 0 : pick("hour");
  const minute = pick("minute");
  const second = pick("second");
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = asUtc - now;
  return Date.UTC(year, month - 1, day, 0, 0, 0) - offset;
}
