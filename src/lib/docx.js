/**
 * Minimal .docx -> plain text extractor, dependency-free.
 *
 * Why this exists: Claude's document input accepts PDF, not .docx, and no
 * mature docx-parsing library runs cleanly in the Cloudflare Pages Functions
 * (Workers) runtime without a bundler/npm step, which this project deliberately
 * doesn't have (see docs/SETUP.md — zero build step is the point). A .docx file
 * is a plain ZIP archive holding word/document.xml, and Workers ships the
 * Compression Streams API (DecompressionStream) natively, so a small
 * ZIP-central-directory reader plus inflate is enough — no external code.
 *
 * This is not a general-purpose ZIP reader: it reads just enough of the format
 * to find one named entry (word/document.xml) and return its bytes.
 */

const EOCD_SIG = 0x06054b50;
const CDFH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

function findEndOfCentralDirectory(bytes) {
  // The EOCD record is near the end of the file; scan backward for its signature
  // rather than assuming a fixed offset, since the optional comment field varies.
  const maxScan = Math.min(bytes.length, 65557); // 22-byte EOCD + max 65535-byte comment
  const start = bytes.length - maxScan;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = bytes.length - 22; i >= Math.max(0, start); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  throw new Error("Not a valid .docx/zip file (no End Of Central Directory record found).");
}

async function inflateIfNeeded(compressed, method) {
  if (method === 0) return compressed; // stored, no compression
  if (method === 8) {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([compressed]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }
  throw new Error(`Unsupported zip compression method: ${method}`);
}

async function readZipEntry(bytes, entryName) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const cdEntryCount = view.getUint16(eocdOffset + 10, true);
  let cdOffset = view.getUint32(eocdOffset + 16, true);

  const decoder = new TextDecoder("utf-8");

  for (let i = 0; i < cdEntryCount; i++) {
    if (view.getUint32(cdOffset, true) !== CDFH_SIG) break;
    const compMethod = view.getUint16(cdOffset + 10, true);
    const compSize = view.getUint32(cdOffset + 20, true);
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);
    const nameBytes = bytes.slice(cdOffset + 46, cdOffset + 46 + nameLen);
    const name = decoder.decode(nameBytes);

    if (name === entryName) {
      const lfhView = new DataView(bytes.buffer, bytes.byteOffset + localHeaderOffset, 30);
      if (lfhView.getUint32(0, true) !== LFH_SIG) {
        throw new Error("Corrupt .docx: local file header signature mismatch.");
      }
      const lfhNameLen = lfhView.getUint16(26, true);
      const lfhExtraLen = lfhView.getUint16(28, true);
      const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
      const compressed = bytes.slice(dataStart, dataStart + compSize);
      return inflateIfNeeded(compressed, compMethod);
    }

    cdOffset += 46 + nameLen + extraLen + commentLen;
  }

  throw new Error(`"${entryName}" not found inside the uploaded .docx file.`);
}

const ENTITY_MAP = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXmlEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, code) => {
    if (code[0] === "#") {
      const cp = code[1] === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITY_MAP[code] ?? m;
  });
}

/**
 * Extract visible text from word/document.xml. Word wraps every run of text in
 * <w:t>...</w:t>; paragraphs end with </w:p>. This is not a full OOXML parser —
 * it does not handle tables, headers/footers, or tracked-changes markup
 * specially — but CVs are simple documents and this covers the text a
 * candidate actually wrote.
 */
function extractTextFromDocumentXml(xml) {
  const paragraphs = xml.split(/<\/w:p>/);
  const lines = [];
  for (const para of paragraphs) {
    const runs = [...para.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => decodeXmlEntities(m[1]));
    const line = runs.join("");
    if (line.trim()) lines.push(line.trim());
  }
  return lines.join("\n");
}

/** Entry point: base64-encoded .docx bytes -> plain text. */
export async function extractDocxText(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const xmlBytes = await readZipEntry(bytes, "word/document.xml");
  const xml = new TextDecoder("utf-8").decode(xmlBytes);
  const text = extractTextFromDocumentXml(xml);

  if (!text.trim()) {
    throw new Error("Could not read any text from this .docx file — it may be empty, corrupted, or built unusually.");
  }
  return text;
}
