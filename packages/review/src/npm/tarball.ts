import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

/** Limits for reading a tarball. Going over one is refused, not truncated. */
export interface TarLimits {
  maxUnpackedBytes: number;
  maxFiles: number;
  maxFileBytes: number;
}

/** 20 MB unpacked, 5,000 files, 5 MB per file. */
export const DEFAULT_TAR_LIMITS: TarLimits = {
  maxUnpackedBytes: 20 * 1024 * 1024,
  maxFiles: 5_000,
  maxFileBytes: 5 * 1024 * 1024,
};

/** The files of a tarball, and every entry that was skipped with the reason. */
export interface TarContents {
  /** Paths relative to the package root (the leading `package/` folder is removed). */
  files: Map<string, Uint8Array>;
  /** Entries we refused to read: links, special files, unsafe paths, oversized files. */
  skipped: { path: string; reason: string }[];
}

const BLOCK = 512;

/**
 * Reads an npm tarball in memory. Nothing is ever written to disk or executed.
 * Links, unsafe paths and oversized files are skipped and reported, not followed.
 */
export function readTarGz(gz: Uint8Array, limits: TarLimits = DEFAULT_TAR_LIMITS): TarContents {
  // maxOutputLength stops a small gzip that expands into gigabytes.
  const tar = gunzipSync(gz, { maxOutputLength: limits.maxUnpackedBytes + 1024 * 1024 });
  const files = new Map<string, Uint8Array>();
  const skipped: TarContents['skipped'] = [];
  let offset = 0;
  let nextName: string | undefined;
  let total = 0;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every(b => b === 0)) break;
    const size = parseSize(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + BLOCK;
    const data = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'x') {
      nextName = parsePax(data).get('path') ?? nextName;
      continue;
    }
    if (type === 'L') {
      nextName = cString(data);
      continue;
    }
    if (type === 'g') continue;

    const prefix = cString(header.subarray(345, 500));
    const rawName =
      nextName ?? (prefix ? `${prefix}/${cString(header.subarray(0, 100))}` : cString(header.subarray(0, 100)));
    nextName = undefined;
    const path = safePath(rawName);

    if (type === '5') continue;
    if (!path) {
      skipped.push({ path: rawName, reason: 'unsafe path' });
      continue;
    }
    if (type !== '0' && type !== '\0' && type !== '7') {
      skipped.push({ path, reason: type === '1' || type === '2' ? 'link' : `entry type ${type}` });
      continue;
    }
    if (size > limits.maxFileBytes) {
      skipped.push({ path, reason: `file is ${size} bytes` });
      continue;
    }
    if (files.size >= limits.maxFiles) throw new Error(`tarball has more than ${limits.maxFiles} files`);
    total += size;
    if (total > limits.maxUnpackedBytes)
      throw new Error(`tarball unpacks to more than ${limits.maxUnpackedBytes} bytes`);
    files.set(path, new Uint8Array(data));
  }
  return { files, skipped };
}

function parseSize(field: Uint8Array): number {
  if ((field[0] ?? 0) & 0x80) return Number.POSITIVE_INFINITY; // base-256: far beyond any limit we accept
  const text = cString(field).trim();
  return text ? Number.parseInt(text, 8) : 0;
}

function cString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return Buffer.from(end === -1 ? bytes : bytes.subarray(0, end)).toString('utf8');
}

function parsePax(data: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const text = Buffer.from(data).toString('utf8');
  let i = 0;
  while (i < text.length) {
    const space = text.indexOf(' ', i);
    if (space === -1) break;
    const length = Number.parseInt(text.slice(i, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(space + 1, i + length - 1);
    const eq = record.indexOf('=');
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1));
    i += length;
  }
  return out;
}

/** Drops the top folder (usually `package/`) and rejects absolute paths and `..`. */
function safePath(raw: string): string | undefined {
  if (raw.startsWith('/') || raw.includes('\\') || raw.includes('\0')) return undefined;
  const parts = raw.split('/').filter(p => p !== '' && p !== '.');
  if (parts.some(p => p === '..')) return undefined;
  const rest = parts.slice(1).join('/');
  return rest ? posix.normalize(rest) : undefined;
}

/** Checks an npm `dist.integrity` value such as `sha512-...` against the bytes we downloaded. */
export function verifyIntegrity(bytes: Uint8Array, integrity: string): boolean {
  return integrity.split(/\s+/).some(entry => {
    const [algorithm, expected] = entry.split('-', 2) as [string, string | undefined];
    if (!expected || !['sha512', 'sha384', 'sha256', 'sha1'].includes(algorithm)) return false;
    return createHash(algorithm).update(bytes).digest('base64') === expected;
  });
}

/** The `sha512-...` integrity string for some bytes. */
export function integrityOf(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/** Builds a gzipped ustar archive. Used by fixtures and tests to make fake packages. */
export function createTarGz(files: Record<string, string | Uint8Array>, root = 'package'): Uint8Array {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? Buffer.from(content) : Buffer.from(content);
    const header = Buffer.alloc(BLOCK);
    header.write(`${root}/${name}`.slice(0, 100), 0);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.write('        ', 148);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK));
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(blocks));
}
