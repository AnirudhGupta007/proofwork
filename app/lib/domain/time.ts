export const assessmentDurationMin = 120;

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

export function msUntil(date: Date, now = new Date()) {
  return Math.max(0, date.getTime() - now.getTime());
}

export function formatTimer(totalMs: number) {
  const totalSeconds = Math.ceil(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}
