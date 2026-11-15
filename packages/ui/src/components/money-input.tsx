'use client';

import * as React from 'react';
import { cn } from '../lib/utils';

export interface MoneyInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'type'
> {
  /** decimal string, e.g. '870710.00'; '' when empty */
  value: string;
  onChange: (value: string) => void;
  /** ISO code shown after the amount */
  currency?: string;
  /** decimals allowed while typing (currency minor units; rates use 6) */
  maxDecimals?: number;
}

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/** Keeps digits and a single decimal separator; never parses to a JS number (Principle V). */
export function sanitizeDecimal(raw: string, maxDecimals: number): string {
  const latin = raw
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) & 0x0f))
    .replace(/[٫,]/g, (c) => (c === '٫' ? '.' : ''));
  let out = '';
  let seenDot = false;
  let decimals = 0;
  for (const ch of latin) {
    if (ch >= '0' && ch <= '9') {
      if (seenDot) {
        if (decimals >= maxDecimals) continue;
        decimals++;
      }
      out += ch;
    } else if (ch === '.' && !seenDot && maxDecimals > 0) {
      seenDot = true;
      out += out === '' ? '0.' : '.';
    }
  }
  return out.replace(/^0+(?=\d)/, '');
}

const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, currency, maxDecimals = 2, className, ...props }, ref) => (
    <div className="relative">
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(sanitizeDecimal(e.target.value, maxDecimals))}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-end text-sm tabular-nums ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive',
          currency && 'pe-14',
          className
        )}
        {...props}
      />
      {currency ? (
        <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs font-medium text-muted-foreground">
          {currency}
        </span>
      ) : null}
    </div>
  )
);
MoneyInput.displayName = 'MoneyInput';

export { MoneyInput };
