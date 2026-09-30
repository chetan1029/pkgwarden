import { createHash } from 'node:crypto';
import { type AnyTool, defineTool } from '@pkgwarden/engine';
import { z } from 'zod';
import type { HttpClient } from '../http/client.js';
import { readTarGz, verifyIntegrity } from '../npm/tarball.js';
import { previousVersion, registryPath } from '../npm/util.js';
import { Downloads, type FileEntry, type Manifest, PackumentSummary, TarballContents } from './outputs.js';
import { NpmDownloads, RegistryManifest, RegistryPackument, RegistryPerson } from './responses.js';

const HOUR = 3_600_000;

function personName(p: unknown): string | undefined {
  const parsed = RegistryPerson.safeParse(p);
  if (!parsed.success) return undefined;
  return typeof parsed.data === 'string' ? parsed.data.replace(/\s*<.*$/, '') : parsed.data.name;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && key in value) return String((value as Record<string, unknown>)[key]);
  return undefined;
}

/** Registry manifests are messy (licences as objects, people as strings). This makes them boring. */
function toManifest(raw: unknown): Manifest | undefined {
  const parsed = RegistryManifest.safeParse(raw);
  if (!parsed.success) return undefined;
  const m = parsed.data;
  return {
    version: m.version,
    license: stringField(m.license, 'type'),
    scripts: stringRecord(m.scripts),
    dependencies: stringRecord(m.dependencies),
    maintainers: (m.maintainers ?? []).map(personName).filter((n): n is string => Boolean(n)),
    publisher: personName(m._npmUser),
    repository: stringField(m.repository, 'url'),
    deprecated: typeof m.deprecated === 'string' && m.deprecated ? m.deprecated : undefined,
    tarball: m.dist.tarball,
    integrity: m.dist.integrity,
    unpackedSize: m.dist.unpackedSize,
    fileCount: m.dist.fileCount,
    hasProvenance: m.dist.attestations !== undefined && m.dist.attestations !== null,
  };
}

/** Tools that read the npm registry, the downloads API and package tarballs. Nothing here runs package code. */
export function npmTools(http: HttpClient): AnyTool[] {
  const packument = defineTool({
    id: 'npm.packument',
    description:
      'Registry metadata for an npm package: versions and publish times, and the manifests of the requested version and the one before it.',
    input: z.object({ name: z.string().min(1), version: z.string().optional(), from: z.string().optional() }),
    output: PackumentSummary,
    cache: { kind: 'ttl', ttlMs: HOUR },
    async run(input, ctx) {
      const res = await http.json(`https://registry.npmjs.org/${registryPath(input.name)}`, {}, ctx.signal);
      if (res.status === 404)
        return { name: input.name, found: false, distTags: {}, versionCount: 0, versionTimes: {} };
      if (res.status !== 200) throw new Error(`the npm registry answered ${res.status} for ${input.name}`);
      const p = RegistryPackument.parse(res.body);
      const resolve = (v: string | undefined) => (v === undefined ? p['dist-tags'].latest : (p['dist-tags'][v] ?? v));
      const toVersion = resolve(input.version);
      const fromVersion = input.from ? resolve(input.from) : toVersion ? previousVersion(p.time, toVersion) : undefined;
      const versionTimes = Object.fromEntries(
        Object.entries(p.time).filter(([v]) => v !== 'created' && v !== 'modified' && v in p.versions)
      );
      return {
        name: p.name,
        found: toVersion !== undefined && toVersion in p.versions,
        distTags: p['dist-tags'],
        created: p.time.created,
        lastPublished: Object.values(versionTimes).sort().at(-1),
        versionCount: Object.keys(p.versions).length,
        versionTimes,
        to: toVersion ? toManifest(p.versions[toVersion]) : undefined,
        from: fromVersion ? toManifest(p.versions[fromVersion]) : undefined,
      };
    },
  });

  const downloads = defineTool({
    id: 'npm.downloads',
    description: 'Weekly download count for an npm package.',
    input: z.object({ name: z.string().min(1) }),
    output: Downloads,
    cache: { kind: 'ttl', ttlMs: 24 * HOUR },
    async run(input, ctx) {
      const res = await http.json(`https://api.npmjs.org/downloads/point/last-week/${input.name}`, {}, ctx.signal);
      if (res.status === 404) return { weekly: null };
      if (res.status !== 200) throw new Error(`the downloads API answered ${res.status} for ${input.name}`);
      return { weekly: NpmDownloads.parse(res.body).downloads };
    },
  });

  const tarball = defineTool({
    id: 'npm.tarball',
    description: 'Downloads a package tarball, checks its integrity hash and lists its files. Code is never run.',
    input: z.object({ url: z.url(), integrity: z.string().optional() }),
    output: TarballContents,
    // A tarball with a known integrity hash can never change, so it is cached forever under that hash.
    cache: { kind: 'immutable' },
    cacheKey: input => input.integrity ?? input.url,
    async run(input, ctx) {
      const res = await http.bytes(input.url, ctx.signal);
      if (res.status !== 200) throw new Error(`the tarball download answered ${res.status}`);
      if (input.integrity && !verifyIntegrity(res.body, input.integrity)) {
        throw new Error('integrity mismatch: the tarball does not match the hash the registry published');
      }
      const { files, skipped } = readTarGz(res.body);
      const out: Record<string, FileEntry> = {};
      let totalBytes = 0;
      for (const [path, bytes] of files) {
        totalBytes += bytes.byteLength;
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const isText = bytes.byteLength <= 1024 * 1024 && !bytes.subarray(0, 8000).includes(0);
        out[path] = {
          size: bytes.byteLength,
          sha256,
          ...(isText ? { text: Buffer.from(bytes).toString('utf8') } : {}),
        };
      }
      return {
        integrity: input.integrity ?? `sha256-${createHash('sha256').update(res.body).digest('base64')}`,
        verified: Boolean(input.integrity),
        totalBytes,
        files: out,
        skipped,
      };
    },
  });

  return [packument, downloads, tarball];
}
