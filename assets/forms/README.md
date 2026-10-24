# Official forms

These PDFs are the unmodified government originals. They are filled at runtime by
`src/server/documents/fill-w4.ts` and `fill-i9.ts` using `pdf-lib`.

| File | Form | Edition | Source | Retrieved |
| --- | --- | --- | --- | --- |
| `fw4.pdf` | IRS Form W-4, Employee's Withholding Certificate | 2026 (5 pages, created 12/8/25) | https://www.irs.gov/pub/irs-pdf/fw4.pdf | 2026-10-24 |
| `i-9.pdf` | USCIS Form I-9, Employment Eligibility Verification | Edition 01/20/25, expires 05/31/2027 (4 pages) | https://www.uscis.gov/sites/default/files/document/forms/i-9.pdf | 2026-10-24 |

Both forms are US federal government works and are not subject to copyright.

## Handling notes

- Both files carry an XFA layer. The filler deletes the `/XFA` key from the AcroForm so
  viewers render the AcroForm widgets we fill instead of the dynamic XFA form.
- The W-4 has no signature field. The signature and date are drawn at fixed coordinates.
- The I-9 "Document Title 1" field has two widgets (page 3 and page 4). The page-4
  widget is detached before filling.
- Field names containing dots break `pdf-lib`, so extra signature fields that we add are
  named `sig_worker`, `sig_employer` and `<key>_date`.
- When USCIS or the IRS publish a new edition, replace the file, update this table and
  re-run `pnpm vitest run src/server/documents`. The tests assert the field names we fill.

# Fonts

`assets/fonts/DancingScript.ttf` is Dancing Script (SIL Open Font License 1.1, license text
in `assets/fonts/OFL-DancingScript.txt`), from https://github.com/google/fonts/tree/main/ofl/dancingscript.
It renders the typed-name signature in PDFs and in the signing UI preview.
