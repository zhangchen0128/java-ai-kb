import { z } from 'zod';

// Source level enum
const SourceLevel = z.enum(['L0','L1','L2','L3','L4','L5','L6']);
const EntryStatus = z.enum(['draft','verified','outdated']);
const EntryLevel = z.enum(['beginner','intermediate','advanced','reference']);
const RelationType = z.enum(['prerequisite','related','derived','contrast','version-of','replaces']);

// Source object
const Source = z.object({
  level: SourceLevel,
  url: z.string().url().regex(/^https?:\/\//).optional(),
  description: z.string().min(1).max(200),
});

// Relations object
const Relations = z.object({
  prerequisite: z.array(z.string()).nullable().optional(),
  related: z.array(z.string()).nullable().optional(),
  derived: z.array(z.string()).nullable().optional(),
  contrast: z.array(z.string()).nullable().optional(),
  'version-of': z.array(z.string()).nullable().optional(),
  replaces: z.array(z.string()).nullable().optional(),
}).optional().nullable();

// Full frontmatter schema
export const FrontmatterSchema = z.object({
  domain: z.string().regex(/^\d{2}-.+$/),
  title: z.string().min(1).max(200),
  status: EntryStatus,
  level: EntryLevel,
  sources: z.array(Source).min(1),
  relations: Relations,
  tags: z.array(z.string().min(1).max(50)).min(1),
  created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine(data => data.updated >= data.created, {
  message: 'updated must be >= created',
}).refine(data => {
  // L6 source → must be draft; verified needs L0-L3
  const hasL6 = data.sources.some(s => s.level === 'L6');
  if (hasL6 && data.status !== 'draft') return false;
  if (data.status === 'verified') {
    const hasHigher = data.sources.some(s => ['L0','L1','L2','L3'].includes(s.level));
    if (!hasHigher) return false;
  }
  return true;
}, { message: 'L6 sources require draft status; verified requires at least one L0-L3 source' });

// Valid URL protocols for source links
export function isValidSourceUrl(url) {
  if (!url) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

// Valid relation targets (must be existing entries or domain references)
export function isValidRelationTarget(target, knownEntries, knownDomains) {
  // Domain reference like "02-java-platform"
  if (/^\d{2}-[a-z-]+$/.test(target)) {
    return knownDomains.has(target);
  }
  // Entry reference (filename without .md)
  return knownEntries.has(target);
}

export { SourceLevel, EntryStatus, EntryLevel, RelationType };
