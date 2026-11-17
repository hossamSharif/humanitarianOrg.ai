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

// ---------------------------------------------------------------------------------------------
// Wall-clock date + time in a time zone (002: sourcing deadlines are typed and shown in the
// organization's time zone, never the browser's)
// ---------------------------------------------------------------------------------------------

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** ISO date (YYYY-MM-DD) and HH:mm on the wall clock of `timeZone` → ISO instant (UTC). */
export function zonedDateTimeToIso(isoDate: string, time: string, timeZone: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // a second pass settles a daylight-saving boundary
  let instant = wall - zoneOffsetMs(wall, timeZone);
  instant = wall - zoneOffsetMs(instant, timeZone);
  return new Date(instant).toISOString();
}

/** ISO instant → its wall-clock date (YYYY-MM-DD) and time (HH:mm) in `timeZone`. */
export function isoToZonedDateTime(
  instant: string,
  timeZone: string
): { date: string; time: string } {
  const ms = Date.parse(instant);
  const local = new Date(ms + zoneOffsetMs(ms, timeZone));
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
  };
}
