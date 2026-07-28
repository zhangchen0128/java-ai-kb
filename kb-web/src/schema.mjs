import { z } from 'zod';

// Source level enum
const SourceLevel = z.enum(['L0','L1','L2','L3','L4','L5','L6']);
const EntryStatus = z.enum(['draft','verified','outdated']);
const EntryLevel = z.enum(['beginner','intermediate','advanced','reference']);
const ContentType = z.enum(['overview','concept','practice','production','case-study','reference']);
const CodeStatus = z.enum(['tested','not-applicable','illustrative']);
const RelationType = z.enum(['prerequisite','related','derived','contrast','version-of','replaces']);
const JavaSymbol = z.string().regex(
  /^[A-Za-z_$][A-Za-z0-9_$]*(?:#[A-Za-z_$][A-Za-z0-9_$]*)?$/,
);
const MainJavaPath = z.string().regex(
  /^labs\/lab-[a-z0-9-]+\/src\/main\/.+\.java$/,
);
const TestJavaPath = z.string().regex(
  /^labs\/lab-[a-z0-9-]+\/src\/test\/.+\.java$/,
);
const CodeArtifact = pathSchema => z.object({
  file: pathSchema,
  symbols: z.array(JavaSymbol).min(1),
});
const CodeBlockEvidence = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  sources: z.array(CodeArtifact(MainJavaPath)).min(1),
  tests: z.array(CodeArtifact(TestJavaPath)).min(1),
});
const CodeEvidence = z.object({
  scope: z.literal('article-core'),
  source_files: z.array(MainJavaPath).min(1),
  test_files: z.array(TestJavaPath).min(1),
  blocks: z.array(CodeBlockEvidence).min(1).optional(),
}).superRefine((value, ctx) => {
  const ids = value.blocks?.map(block => block.id) || [];
  for (const id of new Set(ids.filter((item, index) => ids.indexOf(item) !== index))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['blocks'],
      message: `duplicate code block evidence id: ${id}`,
    });
  }
  for (const [index, block] of (value.blocks || []).entries()) {
    for (const artifact of block.sources) {
      if (!value.source_files.includes(artifact.file)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['blocks', index, 'sources'],
          message: `block source must be listed in source_files: ${artifact.file}`,
        });
      }
    }
    for (const artifact of block.tests) {
      if (!value.test_files.includes(artifact.file)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['blocks', index, 'tests'],
          message: `block test must be listed in test_files: ${artifact.file}`,
        });
      }
    }
  }
});
const PerformanceEvidence = z.discriminatedUnion('status', [
  z.object({ status: z.literal('illustrative') }),
  z.object({
    status: z.literal('reproducible'),
    hardware: z.string().min(3),
    software: z.string().min(3),
    data_size: z.string().min(1),
    parameters: z.string().min(1),
    script: z.string().min(1),
    runs: z.number().int().positive(),
    percentiles: z.array(z.enum(['P50','P95','P99'])).min(1),
    measured_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    raw_results: z.string().min(1),
  }),
]);

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

const Verification = z.object({
  reviewed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  version_anchor: z.string().min(3).max(200),
  code_status: CodeStatus,
  lab: z.string().regex(/^lab-[a-z0-9-]+$/).optional(),
  evidence: CodeEvidence.optional(),
  performance: PerformanceEvidence.optional(),
}).superRefine((value, ctx) => {
  if (value.code_status === 'tested' && !value.lab) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lab'],
      message: 'tested code requires a lab',
    });
  }
  if (value.code_status === 'tested' && !value.evidence) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidence'],
      message: 'tested code requires concrete source and test evidence',
    });
  }
  if (value.code_status === 'not-applicable' && value.lab) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lab'],
      message: 'not-applicable code must not declare a lab',
    });
  }
});

// Full frontmatter schema
export const FrontmatterSchema = z.object({
  domain: z.string().regex(/^\d{2}-.+$/),
  title: z.string().min(1).max(200),
  status: EntryStatus,
  level: EntryLevel,
  content_type: ContentType,
  verification: Verification.optional(),
  sources: z.array(Source).min(1),
  relations: Relations,
  tags: z.array(z.string().min(1).max(50)).min(1),
  created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).superRefine((data, ctx) => {
  if (data.updated < data.created) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['updated'],
      message: 'updated must be >= created',
    });
  }

  // L6 source → must be draft; verified needs L0-L3
  const hasL6 = data.sources.some(s => s.level === 'L6');
  if (hasL6 && data.status !== 'draft') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: 'L6 sources require draft status',
    });
  }

  if (data.status === 'verified') {
    const hasHigher = data.sources.some(s => ['L0','L1','L2','L3'].includes(s.level));
    if (!hasHigher) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sources'],
        message: 'verified requires at least one L0-L3 source',
      });
    }
    if (!data.verification) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verification'],
        message: 'verified entries require verification metadata',
      });
    } else if (data.verification.code_status === 'illustrative') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verification', 'code_status'],
        message: 'verified entries cannot use illustrative code status',
      });
    }
  }
});

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

export {
  SourceLevel,
  EntryStatus,
  EntryLevel,
  ContentType,
  CodeStatus,
  CodeBlockEvidence,
  CodeEvidence,
  PerformanceEvidence,
  RelationType,
  Verification,
};
