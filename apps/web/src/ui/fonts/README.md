# fonts

`inter-latin-digits.woff2` is the Latin subset of Inter (variable, weights 100-900) as served by Google Fonts.
Inter is SIL OFL 1.1 (https://github.com/rsms/inter). It is registered in `app/layout.tsx` with
`unicode-range: U+0030-0039`, so it is used ONLY for the digits 0-9 and sits first in `--font-pixel`.
Pixelify Sans keeps rendering words; its digits are never used because its "5" looks like an "S".
