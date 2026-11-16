/** Currency names from the `currency` table (data-model §1), used for amount-in-words. */
export interface CurrencyNames {
  code: string;
  minorUnits: number;
  nameArSingular: string;
  nameArDual: string;
  nameArPlural: string;
  nameEnSingular: string;
  nameEnPlural: string;
  minorNameArSingular: string;
  minorNameArDual: string;
  minorNameArPlural: string;
  minorNameEnSingular: string;
  minorNameEnPlural: string;
}

/** Largest whole amount spelled out: 999 trillion + 999 … (fits a JS safe integer). */
export const MAX_WHOLE = 999_999_999_999_999;
