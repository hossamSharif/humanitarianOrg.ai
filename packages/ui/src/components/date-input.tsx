'use client';

import { formatDate, parseDisplayDate } from '@ngo/shared';
import * as React from 'react';
import { cn } from '../lib/utils';

export interface DateInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'type'
> {
  /** ISO YYYY-MM-DD, or null when empty */
  value: string | null | undefined;
  /** Emits ISO YYYY-MM-DD, or null while the text is empty or not a valid date */
  onChange: (value: string | null) => void;
  /** Called with false while the typed text is not a valid DD/MM/YYYY date */
  onValidityChange?: (valid: boolean) => void;
}

/**
 * DD/MM/YYYY text input (FR-051, research R15). Never uses the browser's locale date picker, so
 * the format is the same in Arabic and English and on every device.
 */
const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, onValidityChange, onBlur, className, ...props }, ref) => {
    const [text, setText] = React.useState(() => formatDate(value));
    const [invalid, setInvalid] = React.useState(false);

    // Follow external value changes (form reset, server data) unless the user is mid-edit.
    const lastEmitted = React.useRef(value ?? null);
    React.useEffect(() => {
      if ((value ?? null) !== lastEmitted.current) {
        lastEmitted.current = value ?? null;
        setText(formatDate(value));
        setInvalid(false);
      }
    }, [value]);

    const update = (next: string) => {
      setText(next);
      const iso = next.trim() === '' ? null : parseDisplayDate(next);
      const valid = next.trim() === '' || iso !== null;
      setInvalid(!valid);
      onValidityChange?.(valid);
      if ((iso ?? null) !== lastEmitted.current) {
        lastEmitted.current = iso;
        onChange(iso);
      }
    };

    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        maxLength={10}
        value={text}
        aria-invalid={invalid || props['aria-invalid'] ? true : undefined}
        onChange={(e) => update(e.target.value)}
        onBlur={(e) => {
          // normalise 2/1/2026 → 02/01/2026
          const iso = parseDisplayDate(text);
          if (iso) setText(formatDate(iso));
          onBlur?.(e);
        }}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive',
          className
        )}
        {...props}
      />
    );
  }
);
DateInput.displayName = 'DateInput';

export { DateInput };
