const hour = 60 * 60 * 1000;
const day = 24 * hour;
const bacolodOffset = 8 * hour;
const dateFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', month: 'short', day: 'numeric',
});

export function afterHours(now: Date) {
  const local = new Date(now.getTime() + bacolodOffset);
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const friday = localMidnight + ((5 - local.getUTCDay() + 7) % 7) * day;
  const start = friday + 21 * hour - bacolodOffset;
  const tonight = local.getUTCDay() === 5 && now.getTime() >= start;
  return { date: dateFormat.format(start), tonight };
}
