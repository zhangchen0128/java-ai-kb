import { readFileSync } from 'fs';
import YAML from 'yaml';
import { FrontmatterSchema } from './schema.mjs';

/**
 * Parse a markdown file with YAML frontmatter.
 * Returns { meta, body, errors } — errors is empty if valid.
 */
export function parseMarkdown(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const errors = [];

  // Extract frontmatter
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) {
    errors.push(`Missing YAML frontmatter in ${filePath}`);
    return { meta: {}, body: raw, errors };
  }

  let meta = {};
  try {
    meta = YAML.parse(m[1]);
  } catch (e) {
    errors.push(`YAML parse error in ${filePath}: ${e.message}`);
    return { meta, body: m[2], errors };
  }

  // Validate with Zod
  const result = FrontmatterSchema.safeParse(meta);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      errors.push(`[${filePath}] ${path}: ${issue.message}`);
    }
    return { meta, body: m[2], errors };
  }

  return { meta: result.data, body: m[2], errors };
}

/**
 * Parse frontmatter from raw string (for build pipeline use).
 */
export function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw, errors: ['Missing frontmatter'] };

  let meta = {};
  try {
    meta = YAML.parse(m[1]);
  } catch (e) {
    return { meta, body: m[2], errors: [`YAML error: ${e.message}`] };
  }

  const result = FrontmatterSchema.safeParse(meta);
  if (!result.success) {
    return { meta, body: m[2], errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
  }

  return { meta: result.data, body: m[2], errors: [] };
}
