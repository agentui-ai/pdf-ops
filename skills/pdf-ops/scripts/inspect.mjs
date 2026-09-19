#!/usr/bin/env node
/**
 * Check the PDF you just produced, instead of opening it and squinting.
 *
 *   node inspect.mjs out.pdf [--json]
 *
 * A PDF never reports that content fell off the page — it just renders a page
 * with nothing on part of it. These two checks catch that before a human does:
 * `offPageDraws` against a Flow while you build, and this CLI against the file.
 */
import { PDFDocument } from "pdf-lib";
import fs from "node:fs/promises";

const PT_PER_MM = 72 / 25.4;
const KNOWN = [
    { name: "A4 portrait", w: 210, h: 297 },
    { name: "A4 landscape", w: 297, h: 210 },
    { name: "Letter portrait", w: 215.9, h: 279.4 },
    { name: "Letter landscape", w: 279.4, h: 215.9 },
];

/**
 * Every write a Flow made that is outside its own text box.
 *
 * This is the assertion worth keeping in a test: it is computed from the
 * document's own measurements, so it stays true when the font, the page size
 * or the content changes.
 */
export function offPageDraws(flow, tolerance = 0.01) {
    return flow.draws.filter(
        (d) =>
            d.x < flow.left - tolerance ||
            d.x + d.w > flow.right + tolerance ||
            d.y > flow.bottom + tolerance ||
            d.y - d.h < -tolerance
    );
}

export async function inspectPdf(fileOrBytes) {
    const bytes = typeof fileOrBytes === "string" ? await fs.readFile(fileOrBytes) : fileOrBytes;
    const pdf = await PDFDocument.load(bytes);
    const pages = pdf.getPages().map((p, i) => {
        const wmm = p.getWidth() / PT_PER_MM;
        const hmm = p.getHeight() / PT_PER_MM;
        const match = KNOWN.find((k) => Math.abs(k.w - wmm) < 1.5 && Math.abs(k.h - hmm) < 1.5);
        return {
            page: i + 1,
            widthPt: +p.getWidth().toFixed(1),
            heightPt: +p.getHeight().toFixed(1),
            widthMm: +wmm.toFixed(1),
            heightMm: +hmm.toFixed(1),
            format: match ? match.name : "custom",
        };
    });
    const sizes = new Set(pages.map((p) => `${p.widthPt}x${p.heightPt}`));
    return {
        pageCount: pages.length,
        pages,
        uniformSize: sizes.size <= 1,
        title: pdf.getTitle() ?? null,
        author: pdf.getAuthor() ?? null,
        subject: pdf.getSubject() ?? null,
        keywords: pdf.getKeywords() ?? null,
        // Deliberately not creator/producer: pdf-lib substitutes its OWN name
        // for both on load rather than reading the file, so a jsPDF document
        // whose bytes say "/Producer (jsPDF 4.2.1)" reads back as pdf-lib.
        // Reporting that would be worse than reporting nothing.
    };
}

function render(r, file) {
    const L = [`${file}`, ""];
    L.push(`${r.pageCount} page(s)${r.uniformSize ? "" : "  ** mixed page sizes **"}`);
    L.push("");
    L.push("PAGE   SIZE (mm)        SIZE (pt)        FORMAT");
    for (const p of r.pages) {
        L.push(
            `${String(p.page).padStart(4)}   ${`${p.widthMm} x ${p.heightMm}`.padEnd(16)} ${`${p.widthPt} x ${p.heightPt}`.padEnd(16)} ${p.format}`
        );
    }
    L.push("");
    L.push("METADATA");
    for (const k of ["title", "author", "subject", "keywords"]) {
        L.push(`  ${k.padEnd(9)} ${r[k] ?? "— not set"}`);
    }
    if (!r.title) {
        L.push("");
        L.push("  No title: the browser tab and the print dialog will show the filename.");
        L.push("  doc.setProperties({ title, author, subject }) before output().");
    }
    return L.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
    if (!file) {
        process.stderr.write("usage: node inspect.mjs <file.pdf> [--json]\n");
        process.exit(2);
    }
    const r = await inspectPdf(file);
    process.stdout.write(process.argv.includes("--json") ? JSON.stringify(r, null, 2) + "\n" : render(r, file));
}
