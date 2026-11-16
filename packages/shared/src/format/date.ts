// The single date formatter (research R15, FR-051). Calendar dates are ISO `YYYY-MM-DD` strings
// and are formatted by slicing — never parsed into a `Date`, so no timezone can shift them.
// Display format is DD/MM/YYYY with Latin digits in both languages. ESLint forbids
// toLocaleDateString / Intl.DateTimeFormat everywhere except this file.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const DISPLAY_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day <= daysInMonth;
}

/** '2026-11-10' (or an ISO timestamp) → '10/11/2026'; '' for empty input. */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const match = ISO_DATE.exec(isoDate);
  if (!match) {
    throw new RangeError(`Not an ISO date: "${isoDate}"`);
  }
  const [, year, month, day] = match as unknown as [string, string, string, string];
  if (!isValidDate(Number(year), Number(month), Number(day))) {
    throw new RangeError(`Invalid date: "${isoDate}"`);
  }
  return `${day}/${month}/${year}`;
}

/** Arabic-Indic (٠–٩) and Extended Arabic-Indic (۰–۹) digits → Latin. */
function toLatinDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (d) => String((d.charCodeAt(0) & 0x0f) % 10));
}

/** '10/11/2026' → '2026-11-10'; null when the text is not a real DD/MM/YYYY date. */
export function parseDisplayDate(text: string): string | null {
  const match = DISPLAY_DATE.exec(toLatinDigits(text.trim()));
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!isValidDate(year, month, day)) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateTimeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      numberingSystem: 'latn',
    });
    dateTimeFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** An instant shown in the organization's timezone as 'DD/MM/YYYY HH:mm'; '' for empty input. */
export function formatDateTime(
  instant: string | Date | null | undefined,
  timeZone: string
): string {
  if (instant === null || instant === undefined || instant === '') return '';
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid instant: "${String(instant)}"`);
  }
  const parts: Record<string, string> = {};
  for (const part of dateTimeFormatter(timeZone).formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/** The calendar date of an instant in the organization's timezone, as ISO 'YYYY-MM-DD'. */
export function calendarDateInTimeZone(instant: string | Date, timeZone: string): string {
  const shown = formatDateTime(instant, timeZone);
  return `${shown.slice(6, 10)}-${shown.slice(3, 5)}-${shown.slice(0, 2)}`;
}

/** true for IANA zone names the runtime knows, e.g. 'Africa/Khartoum'. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(timeZone)) return false;
  try {
    dateTimeFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** ISO date `days` calendar days after (or, negative, before) `isoDate`: '2026-11-10', -30 → '2026-10-11'. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}
