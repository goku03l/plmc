import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { env } from "./env.js";

const ROOT = resolve(env.uploadDir);
const RFQ_DIR = join(ROOT, "rfq");
const NODE_DIR = join(ROOT, "nodes");

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Save an incoming stream to disk under a given subdirectory, returning the stored name. */
async function saveUpload(dir: string, filename: string, data: Readable): Promise<string> {
  ensureDir(dir);
  // no extension allow/deny list — any file type is accepted, DWG/PDF/image/whatever
  const storedName = `${randomUUID()}${extname(filename).slice(0, 12)}`;
  await pipeline(data, createWriteStream(join(dir, storedName)));
  return storedName;
}

function filePathIn(dir: string, storedName: string): string {
  const p = resolve(dir, storedName);
  if (!p.startsWith(dir)) throw new Error("invalid path"); // guards against path traversal
  return p;
}

async function deleteUpload(dir: string, storedName: string) {
  try {
    await unlink(filePathIn(dir, storedName));
  } catch {
    /* already gone */
  }
}

export const saveRfqUpload = (filename: string, data: Readable) => saveUpload(RFQ_DIR, filename, data);
export const rfqFilePath = (storedName: string) => filePathIn(RFQ_DIR, storedName);
export const deleteRfqUpload = (storedName: string) => deleteUpload(RFQ_DIR, storedName);

/** Node/DMU documents — drawings, photos, PDFs, anything (PDM-style attachments). */
export const saveNodeUpload = (filename: string, data: Readable) => saveUpload(NODE_DIR, filename, data);
export const nodeFilePath = (storedName: string) => filePathIn(NODE_DIR, storedName);
export const deleteNodeUpload = (storedName: string) => deleteUpload(NODE_DIR, storedName);
