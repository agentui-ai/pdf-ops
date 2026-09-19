/**
 * Nine ways a PDF comes out wrong without anything throwing.
 *
 * Each case does the same job twice — the way it is written from memory
 * (`naive`) and the way this skill teaches (`skilled`) — and both are judged by
 * the same assertion, computed from the document's own measurements and from
 * the finished PDF bytes. Never by eye, never by a hardcoded expectation.
 *
 * Deterministic, offline, free: no LLM, no network, no fixtures on disk.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDFDocument } from "pdf-lib";
import { createDoc, Flow, unsupportedGlyphs, fitImage } from "../skills/pdf-ops/scripts/layout.mjs";

const PARA =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.";
const LINES = Array.from({ length: 90 }, (_, i) => `Line ${i + 1}: a row of content that has to go somewhere.`);

/** A 4:1 red PNG, 40x10, base64 — small enough to inline, real enough to measure. */
/** A real 40x10 PNG (4:1), generated with correct CRCs — a hand-typed one
 * fails CRC validation inside jsPDF, which is how this fixture started. */
const PNG_4x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAKCAIAAABJ+IsHAAAAGklEQVR42mO4o6Y2IIhh1OJRi0ctHrWYXAQAZbTOkHltU9cAAAAASUVORK5CYII=";

async function pageCount(doc) {
    const pdf = await PDFDocument.load(doc.output("arraybuffer"));
    return pdf.getPageCount();
}

/** Did any write land outside the printable box? */
function offBox(doc, draws, margin = 18) {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    return draws.filter((d) => d.x < margin - 0.01 || d.x + d.w > W - margin + 0.01 || d.y > H - margin + 0.01 || d.y - d.h < -0.01);
}

/** Record what plain jsPDF draws, so a naive layout can be judged by the same rule. */
function tracked(doc) {
    const draws = [];
    const original = doc.text.bind(doc);
    doc.text = (str, x, y, ...rest) => {
        const text = Array.isArray(str) ? str.join(" ") : String(str);
        const lh = (doc.getFontSize() * doc.getLineHeightFactor()) / doc.internal.scaleFactor;
        draws.push({ x, y, w: doc.getTextWidth(text), h: lh, text });
        return original(str, x, y, ...rest);
    };
    return draws;
}

export const CASES = [
    {
        name: "text-runs-off-the-page",
        trap: "`doc.text()` does not wrap. A long paragraph is drawn straight off the right edge.",
        async naive() {
            const doc = createDoc();
            const draws = tracked(doc);
            doc.text(PARA, 18, 30);
            return { measure: offBox(doc, draws).length };
        },
        async skilled() {
            const doc = createDoc();
            const flow = new Flow(doc, { margin: 18 });
            flow.text(PARA);
            return { measure: offBox(doc, flow.draws).length };
        },
        expect: { measure: 0 },
    },

    {
        name: "content-past-the-last-line",
        trap: "Advancing y in a loop writes below the page. jsPDF draws it into nothing — the PDF opens fine and the content is gone.",
        async naive() {
            const doc = createDoc();
            const draws = tracked(doc);
            let y = 20;
            for (const line of LINES) {
                doc.text(line, 18, y);
                y += 6;
            }
            return { measure: offBox(doc, draws).length };
        },
        async skilled() {
            const doc = createDoc();
            const flow = new Flow(doc, { margin: 18 });
            for (const line of LINES) flow.text(line);
            return { measure: offBox(doc, flow.draws).length };
        },
        expect: { measure: 0 },
    },

    {
        name: "blank-trailing-page",
        trap: "`addPage()` at the end of a loop leaves an empty last page that every reader notices.",
        async naive() {
            const doc = createDoc();
            for (let i = 0; i < 3; i++) {
                doc.text(`Section ${i + 1}`, 18, 30);
                doc.addPage();
            }
            return { pages: await pageCount(doc), sections: 3 };
        },
        async skilled() {
            const doc = createDoc();
            for (let i = 0; i < 3; i++) {
                if (i > 0) doc.addPage();
                doc.text(`Section ${i + 1}`, 18, 30);
            }
            return { pages: await pageCount(doc), sections: 3 };
        },
        expect: { pages: 3, sections: 3 },
    },

    {
        name: "units-are-millimetres",
        trap: "A default jsPDF page is 210 x 297 MILLIMETRES, not pixels or points. Pixel coordinates land far off the page.",
        async naive() {
            const doc = createDoc();
            const draws = tracked(doc);
            doc.text("Right-hand column", 420, 60); // "half of 840px wide"
            return { measure: offBox(doc, draws).length };
        },
        async skilled() {
            const doc = createDoc();
            const flow = new Flow(doc, { margin: 18 });
            flow.text("Right-hand column", { align: "right" });
            return { measure: offBox(doc, flow.draws).length };
        },
        expect: { measure: 0 },
    },

    {
        name: "default-font-size-is-16",
        trap: "jsPDF starts at 16pt, not 12. Wrapping computed against an assumed 12pt overflows the column it was supposed to fit.",
        async naive() {
            const doc = new jsPDF({ unit: "mm", format: "a4" }); // no setFontSize
            const draws = tracked(doc);
            // Wrap width worked out for 12pt text, applied to a 16pt document.
            const assumed = new jsPDF({ unit: "mm", format: "a4" });
            assumed.setFontSize(12);
            const lines = assumed.splitTextToSize(PARA, 174);
            let y = 20;
            for (const l of lines) {
                doc.text(l, 18, y);
                y += 7;
            }
            return { measure: offBox(doc, draws).length };
        },
        async skilled() {
            const doc = createDoc(); // sets an explicit size
            const flow = new Flow(doc, { margin: 18 });
            flow.text(PARA); // measured with the doc it draws with
            return { measure: offBox(doc, flow.draws).length };
        },
        expect: { measure: 0 },
    },

    {
        name: "unsupported-glyphs-render-as-garbage",
        trap: "The built-in fonts are WinAnsi. A CJK or Greek character does not throw and even measures a width — it just renders wrong.",
        async naive() {
            const doc = createDoc();
            doc.text("請求書 Λογαριασμός café", 18, 30); // no complaint, wrong output
            return { flagged: [] };
        },
        async skilled() {
            const bad = unsupportedGlyphs("請求書 Λογαριασμός café");
            return { flagged: bad.length > 0 ? ["found"] : [] };
        },
        expect: { flagged: ["found"] },
    },

    {
        name: "content-after-a-table",
        trap: "A table's height depends on its data. A hardcoded y for what follows lands on top of it.",
        async naive() {
            const doc = createDoc();
            autoTable(doc, { head: [["Item", "Amount"]], body: Array.from({ length: 22 }, (_, i) => [`Row ${i}`, String(i)]) });
            const y = 120; // "the table is about 90mm tall"
            return { overlaps: y < doc.lastAutoTable.finalY ? 1 : 0 };
        },
        async skilled() {
            const doc = createDoc();
            autoTable(doc, { head: [["Item", "Amount"]], body: Array.from({ length: 22 }, (_, i) => [`Row ${i}`, String(i)]) });
            const y = doc.lastAutoTable.finalY + 8;
            return { overlaps: y < doc.lastAutoTable.finalY ? 1 : 0 };
        },
        expect: { overlaps: 0 },
    },

    {
        name: "image-aspect-ratio",
        trap: "`addImage(data, fmt, x, y, w, h)` stretches to exactly w x h. A square box squashes a wide logo.",
        async naive() {
            const doc = createDoc();
            const w = 40, h = 40; // "fit it in a 40mm box"
            const props = doc.getImageProperties(PNG_4x1);
            const wanted = props.width / props.height;
            return { distortion: +Math.abs(w / h - wanted).toFixed(2) };
        },
        async skilled() {
            const doc = createDoc();
            const box = fitImage(doc, PNG_4x1, { x: 18, y: 18, maxW: 40, maxH: 40 });
            const props = doc.getImageProperties(PNG_4x1);
            const wanted = props.width / props.height;
            return { distortion: +Math.abs(box.w / box.h - wanted).toFixed(2) };
        },
        expect: { distortion: 0 },
    },

    {
        name: "page-numbers-need-the-total",
        trap: '"Page 1 of 1" on every page: the total is only known once the document is finished, so stamping during the loop is always wrong.',
        async naive() {
            const doc = createDoc();
            const stamps = [];
            for (let i = 0; i < 3; i++) {
                if (i > 0) doc.addPage();
                stamps.push(`Page ${i + 1} of ${doc.internal.getNumberOfPages()}`);
            }
            return { stamps };
        },
        async skilled() {
            const doc = createDoc();
            const flow = new Flow(doc, { margin: 18 });
            for (let i = 0; i < 3; i++) {
                if (i > 0) flow.newPage();
                flow.text(`Section ${i + 1}`);
            }
            const total = doc.internal.getNumberOfPages();
            return { stamps: Array.from({ length: total }, (_, i) => `Page ${i + 1} of ${total}`) };
        },
        expect: { stamps: ["Page 1 of 3", "Page 2 of 3", "Page 3 of 3"] },
    },
];
