# Changelog

## 0.1.0

First release. The `pdf-ops` skill: nine documented ways a generated PDF comes out
wrong with nothing throwing, a `Flow` layout cursor that wraps, paginates and
records every write so the layout can be asserted in a test, a report builder that
places content after a table by its real `finalY`, a PDF inspector, and a
deterministic benchmark scoring both halves of the ledger.

Library behaviour was verified against jsPDF 4.2 rather than assumed — the default
page is A4 in millimetres, the default font size is 16pt not 12, `y` is the
baseline, and unsupported glyphs return a plausible `getTextWidth` instead of
failing. The benchmark's PNG fixture is generated with real CRCs because jsPDF
validates them and rejects a hand-written one.
