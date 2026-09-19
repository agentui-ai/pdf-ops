/**
 * A document with a table in it — the thing most PDF requests actually are.
 *
 * The two mistakes this exists to prevent:
 *   1. Drawing the next block at a hardcoded y, so it lands on top of a table
 *      whose height depended on the data.  `doc.lastAutoTable.finalY` is where
 *      the table ENDED; everything after starts from there.
 *   2. A header or footer drawn once, so it appears on page 1 of a four-page
 *      table.  autoTable's `didDrawPage` fires per page — that is the hook.
 */
import autoTable from "jspdf-autotable";
import { createDoc, Flow, unsupportedGlyphs } from "./layout.mjs";

/**
 * @param {object} spec
 * @param {string} spec.title
 * @param {string} [spec.subtitle]
 * @param {{label:string,value:string}[]} [spec.meta]     right-aligned key/values under the title
 * @param {string[]} spec.columns
 * @param {(string|number)[][]} spec.rows
 * @param {number[]} [spec.numericColumns]                0-based; right-aligned
 * @param {{label:string,value:string}[]} [spec.totals]
 * @param {string} [spec.notes]
 * @param {boolean} [spec.pageNumbers=true]
 */
export function buildReport(spec) {
    const {
        title,
        subtitle,
        meta = [],
        columns,
        rows,
        numericColumns = [],
        totals = [],
        notes,
        pageNumbers = true,
    } = spec;

    const doc = createDoc();
    const flow = new Flow(doc, { margin: { top: 18, right: 15, bottom: 20, left: 15 } });

    flow.heading(title, { size: 18 });
    if (subtitle) flow.text(subtitle, { size: 10, color: [100, 116, 139] });
    flow.space(2);
    for (const { label, value } of meta) flow.keyValue(label, value, { size: 10 });
    flow.space(3);
    flow.rule();
    flow.space(3);

    const columnStyles = {};
    for (const i of numericColumns) columnStyles[i] = { halign: "right" };

    autoTable(doc, {
        head: [columns],
        body: rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c)))),
        startY: flow.y,
        margin: { left: flow.left, right: flow.margin.right, top: flow.top, bottom: flow.margin.bottom },
        styles: { fontSize: 9, cellPadding: 2, overflow: "linebreak" },
        headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles,
        // Fires once per page the table spans — the only correct place for a
        // running header or footer on a table that paginates itself.
        didDrawPage: () => {
            flow.page = doc.internal.getCurrentPageInfo().pageNumber;
        },
    });

    // Where the table actually ended, on whichever page it ended on.
    flow.page = doc.internal.getNumberOfPages();
    flow.y = doc.lastAutoTable.finalY;

    if (totals.length) {
        flow.space(4);
        flow.ensure(totals.length * flow.lineHeight() + 4);
        for (const { label, value } of totals) flow.keyValue(label, value, { size: 11 });
    }

    if (notes) {
        flow.space(6);
        flow.heading("Notes", { size: 11 });
        flow.text(notes, { size: 9, color: [71, 85, 105] });
    }

    if (pageNumbers) flow.footerPageNumbers();
    return { doc, flow };
}

/** Everything in the document that the built-in fonts cannot render. */
export function auditGlyphs(spec) {
    const strings = [
        spec.title,
        spec.subtitle,
        spec.notes,
        ...(spec.meta || []).flatMap((m) => [m.label, m.value]),
        ...(spec.totals || []).flatMap((t) => [t.label, t.value]),
        ...(spec.columns || []),
        ...(spec.rows || []).flat(),
    ];
    const bad = new Set();
    for (const s of strings) for (const ch of unsupportedGlyphs(s)) bad.add(ch);
    return [...bad];
}
