# PDF fonts

Static TTF files embedded by `@react-pdf/renderer` in printed PRs and reports (research R13, R19).
The web UI loads the same families through `next/font/google`; these files are only for PDFs.

| File                                          | Family                     | Source                                                      |
| --------------------------------------------- | -------------------------- | ----------------------------------------------------------- |
| `IBMPlexSansArabic-{Regular,Medium,Bold}.ttf` | IBM Plex Sans Arabic 1.101 | github.com/google/fonts `ofl/ibmplexsansarabic`             |
| `IBMPlexSans-{Regular,Medium,Bold}.ttf`       | IBM Plex Sans 3.006        | github.com/IBM/plex `packages/plex-sans/fonts/complete/ttf` |

Both families are licensed under the SIL Open Font License 1.1 (`OFL.txt`).
