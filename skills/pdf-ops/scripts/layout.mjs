/**
 * The part of jsPDF nobody ships and everybody needs: a cursor that knows where
 * the page ends.
 *
 * jsPDF draws exactly where you tell it and never complains. Text wider than the
 * page is not wrapped, it is drawn off the edge. Text below the last line is not
 * pushed to a new page, it is drawn into the margin and then into nothing. The
 * PDF opens fine. The content is simply missing, and the only person who finds
 * out is the one holding the printout.
 *
 * Every number here comes from the document itself (`getTextWidth`,
 * `getFontSize`, `pageSize`) rather than from an assumption about A4 or 12pt —
 * the default is A4 in **millimetres at 16pt**, which is not what most code
 * assumes.
 */
import { jsPDF } from "jspdf";

export const MM = {
    a4: { w: 210, h: 297 },
    letter: { w: 215.9, h: 279.4 },
};

/** A doc with sane defaults, in mm, so every number below is a millimetre. */
export function createDoc({ format = "a4", orientation = "portrait", fontSize = 11 } = {}) {
    const doc = new jsPDF({ unit: "mm", format, orientation });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    return doc;
}

/**
 * A top-to-bottom cursor with margins and automatic page breaks.
 *
 * `draws` records every write with its page and its measured box. It exists so
 * you can ASSERT that nothing landed off-page — see benchmark/. A layout you
 * cannot test is a layout you are eyeballing in a PDF viewer forever.
 */
export class Flow {
    constructor(doc, { margin = 18, onNewPage = null } = {}) {
        const m = typeof margin === "number" ? { top: margin, right: margin, bottom: margin, left: margin } : margin;
        this.doc = doc;
        this.margin = m;
        this.pageW = doc.internal.pageSize.getWidth();
        this.pageH = doc.internal.pageSize.getHeight();
        this.left = m.left;
        this.right = this.pageW - m.right;
        this.width = this.right - this.left;
        this.top = m.top;
        this.bottom = this.pageH - m.bottom;
        this.y = this.top;
        this.page = 1;
        this.onNewPage = onNewPage;
        this.draws = [];
        if (onNewPage) onNewPage(this, 1);
    }

    /** Line height for the current font size, in mm. 1.15 is jsPDF's own factor. */
    lineHeight(size = this.doc.getFontSize()) {
        return (size * this.doc.getLineHeightFactor()) / this.doc.internal.scaleFactor;
    }

    newPage() {
        this.doc.addPage();
        this.page += 1;
        this.y = this.top;
        if (this.onNewPage) this.onNewPage(this, this.page);
        return this;
    }

    /** Break to a new page unless `mm` of vertical room remains. */
    ensure(mm) {
        if (this.y + mm > this.bottom) this.newPage();
        return this;
    }

    space(mm) {
        this.y += mm;
        return this;
    }

    rule(color = [203, 213, 225]) {
        this.ensure(2);
        this.doc.setDrawColor(...color);
        this.doc.setLineWidth(0.2);
        this.doc.line(this.left, this.y, this.right, this.y);
        this.y += 2;
        return this;
    }

    /**
     * Wrapped, paginated text. Returns the lines actually drawn.
     *
     * `align: "right"` and `"center"` are computed from the measured width, not
     * from jsPDF's align option, because that option moves the anchor and it is
     * easy to end up with right-aligned text hanging off the right margin.
     */
    text(str, { size, style = "normal", color = [15, 23, 42], align = "left", indent = 0, width } = {}) {
        const doc = this.doc;
        const prevSize = doc.getFontSize();
        if (size) doc.setFontSize(size);
        doc.setFont("helvetica", style);
        doc.setTextColor(...color);

        const boxW = (width ?? this.width) - indent;
        const lines = doc.splitTextToSize(String(str ?? ""), boxW);
        const lh = this.lineHeight();

        for (const line of lines) {
            this.ensure(lh);
            // y is the BASELINE, not the top of the glyph. Adding the line
            // height before drawing is what keeps the first line inside the
            // top margin instead of half above it.
            this.y += lh;
            const w = doc.getTextWidth(line);
            const x =
                align === "right"
                    ? this.right - w
                    : align === "center"
                      ? this.left + (this.width - w) / 2
                      : this.left + indent;
            doc.text(line, x, this.y);
            this.draws.push({ page: this.page, x, y: this.y, w, h: lh, text: line });
        }
        doc.setFontSize(prevSize);
        return lines;
    }

    heading(str, { size = 15 } = {}) {
        this.ensure(this.lineHeight(size) + 3);
        this.text(str, { size, style: "bold" });
        this.space(1.5);
        return this;
    }

    /** "Label            value" on one line, value right-aligned. */
    keyValue(label, value, { size } = {}) {
        const lh = this.lineHeight(size ?? this.doc.getFontSize());
        this.ensure(lh);
        const before = this.y;
        this.text(label, { size });
        this.y = before;
        this.text(String(value), { size, align: "right" });
        return this;
    }

    /** Stamp "Page i of n" on every page. Call it LAST — n is only known then. */
    footerPageNumbers({ size = 8, color = [100, 116, 139], label = (i, n) => `Page ${i} of ${n}` } = {}) {
        const doc = this.doc;
        const total = doc.internal.getNumberOfPages();
        const prev = doc.getFontSize();
        doc.setFontSize(size);
        doc.setTextColor(...color);
        for (let i = 1; i <= total; i++) {
            doc.setPage(i);
            const t = label(i, total);
            doc.text(t, this.right - doc.getTextWidth(t), this.pageH - this.margin.bottom / 2);
        }
        doc.setPage(total);
        doc.setFontSize(prev);
        return this;
    }
}

/**
 * Which characters the built-in fonts cannot render.
 *
 * jsPDF's standard fonts are WinAnsi (cp1252). Anything outside it does not
 * throw and does not warn — it is drawn as the wrong glyph or as nothing, and
 * `getTextWidth` returns a fallback width, so even measuring it looks fine.
 * A Japanese name, a Greek symbol or a CJK address silently becomes garbage.
 *
 * Run this over user-supplied strings before you ship the PDF. The fix is a
 * real font: `doc.addFileToVFS("NotoSans.ttf", base64); doc.addFont(...)`.
 */
const WINANSI_EXTRA = new Set([
    0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
    0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
    0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function unsupportedGlyphs(str) {
    const bad = new Set();
    for (const ch of String(str ?? "")) {
        const code = ch.codePointAt(0);
        if (code === 0x0a || code === 0x09) continue;
        if (code <= 0xff) continue;          // Latin-1 range: fine
        if (WINANSI_EXTRA.has(code)) continue; // the cp1252 additions: also fine
        bad.add(ch);
    }
    return [...bad];
}

/**
 * Fit an image inside a box without distorting it.
 *
 * `addImage(data, fmt, x, y, w, h)` stretches to exactly w x h. Passing a square
 * box to a 16:9 logo squashes it, and nobody reviewing the PDF can say why it
 * looks cheap.
 */
export function fitImage(doc, dataUrl, { x, y, maxW, maxH }) {
    const props = doc.getImageProperties(dataUrl);
    const ratio = Math.min(maxW / props.width, maxH / props.height);
    const w = props.width * ratio;
    const h = props.height * ratio;
    return { x, y, w, h, draw: () => doc.addImage(dataUrl, props.fileType, x, y, w, h) };
}
