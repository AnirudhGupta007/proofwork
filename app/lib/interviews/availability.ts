export type AvailabilityInput = {
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
  timezone?: string;
};

const dayNameToIndex: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6
};

function parseTime(value: string) {
  const match = value.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) throw new Error(`Invalid time "${value}". Use HH:MM, for example 10:00 or 14:30.`);
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const ampm = match[3];
  if (minutes < 0 || minutes > 59 || hours < 0 || hours > 23) throw new Error(`Invalid time "${value}".`);
  if (ampm === "pm" && hours < 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export function parseAvailabilityText(text: string, timezone = "Asia/Kolkata"): AvailabilityInput[] {
  const entries = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([A-Za-z]+)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i);
      if (!match) throw new Error(`Invalid availability line "${line}". Use "Mon 10:00-17:00".`);
      const dayOfWeek = dayNameToIndex[match[1].toLowerCase()];
      if (dayOfWeek === undefined) throw new Error(`Invalid day in "${line}".`);
      const startMinutes = parseTime(match[2]);
      const endMinutes = parseTime(match[3]);
      if (endMinutes <= startMinutes) throw new Error(`End time must be after start time in "${line}".`);
      return { dayOfWeek, startMinutes, endMinutes, timezone };
    });

  if (entries.length === 0) throw new Error("Add at least one availability window.");
  return entries;
}
