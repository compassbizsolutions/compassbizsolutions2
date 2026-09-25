/**
 * Business-hours math in Eastern time (handles daylight saving via Intl).
 */
const { TIME_ZONE, OPEN_HOUR, CLOSE_HOUR, MORNING_SPREAD_MIN } = require("./inquiry-config");

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

// Wall-clock parts of `date` in Eastern time.
function localParts(date) {
  const p = {};
  for (const { type, value } of fmt.formatToParts(date)) p[type] = Number(value);
  return p;
}

// Offset (ms) between Eastern wall clock and UTC at `date`.
function offsetMs(date) {
  const p = localParts(date);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

// UTC Date for a given Eastern wall-clock time.
function fromLocal(year, month, day, hour, minute) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return new Date(guess.getTime() - offsetMs(guess));
}

function isOpen(date) {
  const h = localParts(date).hour;
  return h >= OPEN_HOUR && h < CLOSE_HOUR;
}

// Next opening time strictly after `date` (today's if before opening, else tomorrow's).
function nextOpening(date) {
  const p = localParts(date);
  const today = fromLocal(p.year, p.month, p.day, OPEN_HOUR, 0);
  if (today > date) return today;
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return fromLocal(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), OPEN_HOUR, 0);
}

/**
 * When a reply to a message received at `receivedAt` should go out.
 * receivedAt + delay if that lands in business hours; otherwise the next
 * opening plus an offset that keeps overnight messages in arrival order.
 */
function replySendTime(receivedAt, delayMin) {
  const due = new Date(receivedAt.getTime() + delayMin * 60000);
  if (isOpen(due)) return due;
  const opening = nextOpening(due);
  // Position within the closed window (0..1) keeps oldest-first ordering.
  const closedSince = new Date(opening.getTime() - (24 - (CLOSE_HOUR - OPEN_HOUR)) * 3600000);
  const frac = Math.min(1, Math.max(0, (due - closedSince) / (opening - closedSince)));
  const spreadMs = (frac * MORNING_SPREAD_MIN + Math.random() * 2) * 60000;
  return new Date(opening.getTime() + spreadMs);
}

module.exports = { isOpen, nextOpening, replySendTime, localParts };
