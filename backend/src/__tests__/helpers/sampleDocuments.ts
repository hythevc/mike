// SPDX-License-Identifier: AGPL-3.0-only
//
// Small but well-formed document files for tests. The workflow catalog sync
// refuses an asset whose content does not match its type, so a catalog
// fixture needs a real Office Open XML package or PDF, not a few bytes under
// a document's name. The dates are fixed, so the same call always gives the
// same bytes and content hash.

import JSZip from "jszip";

const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

const RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

/**
 * A one-paragraph Word document. With `macros`, it is what a .docm holds (a
 * macro-enabled main part and a VBA project), whatever it is later named.
 */
export async function sampleDocx(
  options: { text?: string; macros?: boolean } = {},
): Promise<Buffer> {
  const mainType = options.macros
    ? "application/vnd.ms-word.document.macroEnabled.main+xml"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
  const vbaDefault = options.macros
    ? '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>'
    : "";
  const zip = new JSZip();
  const add = (name: string, contents: string | Buffer) =>
    zip.file(name, contents, { date: FIXED_DATE });
  add(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${vbaDefault}<Override PartName="/word/document.xml" ContentType="${mainType}"/></Types>`,
  );
  add("_rels/.rels", RELATIONSHIPS);
  add(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${options.text ?? "Sample template"}</w:t></w:r></w:p></w:body></w:document>`,
  );
  if (options.macros) {
    // A compound-file header is enough for a part that is never opened.
    add(
      "word/vbaProject.bin",
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    );
  }
  return Buffer.from(
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
  );
}

/** A one-page PDF with no content stream. */
export function samplePdf(): Buffer {
  return Buffer.from(
    [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj",
      "trailer << /Root 1 0 R >>",
      "%%EOF",
      "",
    ].join("\n"),
    "latin1",
  );
}
