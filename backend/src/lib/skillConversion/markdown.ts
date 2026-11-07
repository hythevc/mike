// SPDX-License-Identifier: AGPL-3.0-only
//
// Text normalisation, a small deterministic Markdown block reader, and a
// deterministic Markdown-to-DOCX renderer. The converter must not add a
// dependency, so this reads the subset of Markdown the skills use (headings,
// paragraphs, lists, fenced code, block quotes, tables and links) without
// `marked`, and builds the Word asset with `jszip` so every byte is under our
// control and identical inputs give identical output.

import JSZip from "jszip";

/** A fixed Date so every emitted ZIP entry carries the same DOS timestamp. */
export type FixedDate = Date;

// Characters that must never survive into a shipped workflow: zero-width
// joiners and spaces, bidirectional and other format controls, and the
// Unicode tag block that can hide instructions from a human reader.
const DANGEROUS_CHARACTERS =
  /[​-‏‪-‮⁠-⁤⁦-⁯﻿\u{e0000}-\u{e007f}]/u;

/** Report the first dangerous character in `text`, or null when there is none. */
export function findDangerousCharacter(
  text: string,
): { index: number; codePoint: string } | null {
  const match = DANGEROUS_CHARACTERS.exec(text);
  if (!match) return null;
  return {
    index: match.index,
    codePoint: `U+${match[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
  };
}

/**
 * Normalise body or reference text as it is stored: strip a leading BOM,
 * convert CRLF to LF, delete HTML comments, and apply Unicode NFC. The result
 * still ends with a single trailing newline removed by the caller when needed.
 */
export function normalizeMarkdown(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .normalize("NFC");
}

/**
 * The upstream `display_slug` rule: lower-case, every run of characters
 * outside [a-z0-9] becomes a single '-', and leading and trailing '-' are
 * trimmed.
 */
export function displaySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string };

/**
 * Read the Markdown into blocks. Only the structure the renderer needs; the
 * reader is intentionally small and total, so the same text always yields the
 * same blocks.
 */
export function readMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = normalizeMarkdown(markdown).split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  const flushParagraph = (buffer: string[]) => {
    const text = buffer.join(" ").trim();
    if (text) blocks.push({ kind: "paragraph", text });
  };
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(/^(```+|~~~+)(.*)$/);
    if (fence) {
      const marker = fence[1][0];
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith(marker.repeat(3))) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence (or end of input)
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2].trim().replace(/\s+#+\s*$/, ""),
      });
      index += 1;
      continue;
    }
    const listItem = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (listItem) {
      const ordered = /\d/.test(listItem[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (!match) break;
        items.push(match[2].trim());
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", text: quote.join(" ").trim() });
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s|^\s*([-*+]|\d+[.)])\s|^(```+|~~~+)|^>/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    flushParagraph(paragraph);
  }
  return blocks;
}

/**
 * Flatten inline Markdown to plain text for the Word asset: links become
 * `text (url)`, images are dropped, and emphasis and inline-code markers are
 * removed. There are no hyperlink relationships in the output.
 */
export function flattenInline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
      const target = url.trim().split(/\s+/)[0];
      return target ? `${label} (${target})` : label;
    })
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/__([^_]+)__/g, "$1");
}

function paragraphXml(style: string | null, runs: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}${runs}</w:p>`;
}

function runXml(text: string, monospace = false): string {
  const rPr = monospace
    ? '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr>'
    : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function blocksToBodyXml(blocks: MarkdownBlock[], leadParagraph: string): string {
  const parts: string[] = [];
  parts.push(paragraphXml("Provenance", runXml(leadParagraph)));
  for (const block of blocks) {
    if (block.kind === "heading") {
      const level = Math.min(block.level, 6);
      parts.push(paragraphXml(`Heading${level}`, runXml(flattenInline(block.text))));
    } else if (block.kind === "paragraph") {
      parts.push(paragraphXml(null, runXml(flattenInline(block.text))));
    } else if (block.kind === "quote") {
      parts.push(paragraphXml("Quote", runXml(flattenInline(block.text))));
    } else if (block.kind === "code") {
      for (const codeLine of block.text.split("\n")) {
        parts.push(paragraphXml("Code", runXml(codeLine, true)));
      }
    } else {
      for (const [itemIndex, item] of block.items.entries()) {
        const marker = block.ordered ? `${itemIndex + 1}. ` : "• ";
        parts.push(
          paragraphXml("ListParagraph", runXml(`${marker}${flattenInline(item)}`)),
        );
      }
    }
  }
  return parts.join("");
}

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  "</Types>";

const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  "</Relationships>";

const DOCUMENT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  "</Relationships>";

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  ["Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6"]
    .map(
      (id, i) =>
        `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="heading ${i + 1}"/></w:style>`,
    )
    .join("") +
  '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Provenance"><w:name w:val="Provenance"/></w:style>' +
  "</w:styles>";

function coreXml(title: string, isoDate: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"' +
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:modified>` +
    "</cp:coreProperties>"
  );
}

export type DocxBuildOptions = {
  /** The asset title, used as the document's title property. */
  title: string;
  /** The first paragraph, carrying source and modification provenance. */
  provenanceParagraph: string;
  /** The fixed timestamp written into every ZIP entry and the core props. */
  date: FixedDate;
};

/**
 * Render Markdown to a deterministic .docx. STORE (no compression), a fixed
 * date on every entry, stable part order and no random identifiers make the
 * bytes a pure function of the inputs.
 */
export async function renderMarkdownToDocx(
  markdown: string,
  options: DocxBuildOptions,
): Promise<Buffer> {
  const blocks = readMarkdownBlocks(markdown);
  const body = blocksToBodyXml(blocks, options.provenanceParagraph);
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body +
    '<w:sectPr/></w:body></w:document>';
  const isoDate = options.date.toISOString().replace(/\.\d{3}Z$/, "Z");
  const zip = new JSZip();
  const add = (name: string, content: string) =>
    zip.file(name, content, { date: options.date, unixPermissions: 0o644 });
  // A stable part order; [Content_Types].xml first so the archive opens as the
  // Office Open XML package the parser checks.
  add("[Content_Types].xml", CONTENT_TYPES_XML);
  add("_rels/.rels", ROOT_RELS_XML);
  add("docProps/core.xml", coreXml(options.title, isoDate));
  add("word/document.xml", documentXml);
  add("word/_rels/document.xml.rels", DOCUMENT_RELS_XML);
  add("word/styles.xml", STYLES_XML);
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "STORE",
    platform: "UNIX",
  });
}
