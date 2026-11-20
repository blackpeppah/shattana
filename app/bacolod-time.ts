const hour = 60 * 60 * 1000;
const bacolodOffset = 8 * hour;
const meetupDateFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', dateStyle: 'long',
});

export function bacolodDate(now = new Date()) {
  return new Date(now.getTime() + bacolodOffset).toISOString().slice(0, 10);
}

export function formatMeetupDate(date: string) {
  return meetupDateFormat.format(new Date(`${date}T00:00:00Z`));
}
