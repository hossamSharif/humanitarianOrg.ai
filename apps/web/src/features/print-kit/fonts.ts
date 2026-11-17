// Print kit fonts (research R13, R19, 002 D9): IBM Plex Sans Arabic and IBM Plex Sans TTFs from
// src/fonts, embedded by @react-pdf/renderer. In the browser each file is a static asset URL
// (webpack `new URL(..., import.meta.url)`); Node scripts (the R13 spike) pass their own resolver.
import { Font } from '@react-pdf/renderer';

export const PDF_FONT_AR = 'IBM Plex Sans Arabic';
export const PDF_FONT_EN = 'IBM Plex Sans';

export type PdfFontFile =
  | 'IBMPlexSansArabic-Regular.ttf'
  | 'IBMPlexSansArabic-Medium.ttf'
  | 'IBMPlexSansArabic-Bold.ttf'
  | 'IBMPlexSans-Regular.ttf'
  | 'IBMPlexSans-Medium.ttf'
  | 'IBMPlexSans-Bold.ttf';

// literal URLs so the bundler emits each file
const ASSET_URLS: Record<PdfFontFile, () => string> = {
  'IBMPlexSansArabic-Regular.ttf': () =>
    new URL('../../fonts/IBMPlexSansArabic-Regular.ttf', import.meta.url).href,
  'IBMPlexSansArabic-Medium.ttf': () =>
    new URL('../../fonts/IBMPlexSansArabic-Medium.ttf', import.meta.url).href,
  'IBMPlexSansArabic-Bold.ttf': () =>
    new URL('../../fonts/IBMPlexSansArabic-Bold.ttf', import.meta.url).href,
  'IBMPlexSans-Regular.ttf': () =>
    new URL('../../fonts/IBMPlexSans-Regular.ttf', import.meta.url).href,
  'IBMPlexSans-Medium.ttf': () =>
    new URL('../../fonts/IBMPlexSans-Medium.ttf', import.meta.url).href,
  'IBMPlexSans-Bold.ttf': () => new URL('../../fonts/IBMPlexSans-Bold.ttf', import.meta.url).href,
};

let registered = false;

/** Registers both families once; `resolve` maps a font file name to a URL or file path. */
export function registerPdfFonts(resolve: (file: PdfFontFile) => string = (f) => ASSET_URLS[f]()) {
  if (registered) return;
  registered = true;
  Font.register({
    family: PDF_FONT_AR,
    fonts: [
      { src: resolve('IBMPlexSansArabic-Regular.ttf'), fontWeight: 400 },
      { src: resolve('IBMPlexSansArabic-Medium.ttf'), fontWeight: 500 },
      { src: resolve('IBMPlexSansArabic-Bold.ttf'), fontWeight: 700 },
    ],
  });
  Font.register({
    family: PDF_FONT_EN,
    fonts: [
      { src: resolve('IBMPlexSans-Regular.ttf'), fontWeight: 400 },
      { src: resolve('IBMPlexSans-Medium.ttf'), fontWeight: 500 },
      { src: resolve('IBMPlexSans-Bold.ttf'), fontWeight: 700 },
    ],
  });
  // codes and descriptions must never be hyphenated or split mid-word
  Font.registerHyphenationCallback((word) => [word]);
}
