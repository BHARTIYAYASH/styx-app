import { z } from 'zod';

const MAX_BYTES = 1_048_576;
const workerName = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const targetSchema = z
  .object({
    targetId: z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
    accountId: z.string().regex(/^[a-f0-9]{32}$/),
    workerName,
    environment: z.enum(['prod', 'staging', 'preview', 'scm']),
  })
  .strict();

/**
 * A deliberately small, platform-independent spelling: absolute POSIX or uppercase drive + forward slashes,
 * ASCII path components and a .js/.mjs filename. No UNC, backslashes, dot segments, spaces, trailing dots or
 * Windows device names. This checks spelling only, never existence, ownership, symlinks or file contents.
 */
function artifactPath(value: string): boolean {
  if (!/^(?:\/|[A-Z]:\/)/.test(value)) return false;
  const parts = value.replace(/^(?:\/|[A-Z]:\/)/, '').split('/');
  return (
    /\.(?:js|mjs)$/.test(value) &&
    parts.every(
      (part) =>
        /^[A-Za-z0-9_-](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/.test(part) &&
        !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  );
}

function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxDay = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return year > 0 && maxDay !== undefined && day > 0 && day <= maxDay;
}

const artifactSchema = z
  .object({
    path: z.string().min(1).max(1024).refine(artifactPath),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().positive().max(MAX_BYTES),
  })
  .strict();
const inputSchema = z
  .object({
    target: targetSchema,
    argv: z.array(z.string().min(1).max(1024)).min(1).max(8),
    artifact: artifactSchema.optional(),
    compatibilityDate: z.string().refine(calendarDate).optional(),
  })
  .strict();

type TargetSnapshot = z.infer<typeof targetSchema>;
type ArtifactManifest = z.infer<typeof artifactSchema>;
type Budget = { timeoutMs: number; maxOutputBytes: number };

export type CloudflareOperationPlan =
  | {
      kind: 'list-versions' | 'list-deployments' | 'tail';
      target: TargetSnapshot;
      scope: 'read';
      output: 'json';
      budget: Budget;
    }
  | {
      kind: 'upload-version';
      target: TargetSnapshot;
      scope: 'deploy';
      /** Unverified metadata, not evidence that the file has been opened or hashed. */
      artifact: ArtifactManifest;
      compatibilityDate: string;
      budget: Budget;
    };

export type CloudflareOperationPlanResult =
  { ok: true; plan: CloudflareOperationPlan } | { ok: false; reason: string };

function listName(argv: string[]): string | null {
  let name: string | null = null;
  let json = false;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json' && !json) {
      json = true;
    } else if (arg === '--name' && name === null) {
      name = argv[i + 1] ?? null;
      i += 1;
      if (!workerName.safeParse(name).success) return null;
    } else if (arg?.startsWith('--name=') && name === null) {
      name = arg.slice('--name='.length);
      if (!workerName.safeParse(name).success) return null;
    } else {
      return null;
    }
  }
  return name;
}

/**
 * Pure, unregistered planning only. Success is NOT authorization, verified artifact integrity, or proof of
 * non-production isolation. No credentials, filesystem, network, command execution or grant issuance here.
 *
 * A future host must obtain this snapshot from its database, bind its revision plus grant/session identity to
 * the operation, and revalidate before dispatch. Upload additionally requires a human-confirmed non-production
 * Worker, immutable bytes independently hashed by the host, and review of inherited bindings/resources. The host
 * must enforce these budgets, audit/liveness/cancellation, and a controlled configuration with no repository
 * build hooks, config, bindings or migrations. This plan must never be forwarded to a generic CLI executor.
 */
export function planCloudflareOperation(input: unknown): CloudflareOperationPlanResult {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'Invalid Cloudflare operation input' };
  const { target, argv, artifact, compatibilityDate } = parsed.data;
  let kind: 'list-versions' | 'list-deployments' | 'tail' | null = null;
  let name: string | null = null;
  if ((argv[0] === 'versions' || argv[0] === 'deployments') && argv[1] === 'list') {
    kind = argv[0] === 'versions' ? 'list-versions' : 'list-deployments';
    name = listName(argv);
  } else if (argv.length === 4 && argv[0] === 'tail' && argv[2] === '--format' && argv[3] === 'json') {
    kind = 'tail';
    name = workerName.safeParse(argv[1]).success ? (argv[1] ?? null) : null;
  }
  if (kind !== null && name !== null) {
    if (name !== target.workerName) return { ok: false, reason: 'Command Worker does not match target' };
    if (artifact !== undefined || compatibilityDate !== undefined)
      return { ok: false, reason: 'Read operations do not accept upload inputs' };
    return {
      ok: true,
      plan: {
        kind,
        target,
        scope: 'read',
        output: 'json',
        budget: { timeoutMs: kind === 'tail' ? 30_000 : 20_000, maxOutputBytes: MAX_BYTES },
      },
    };
  }
  if (
    argv.length === 5 &&
    argv[0] === 'versions' &&
    argv[1] === 'upload' &&
    argv[3] === '--name' &&
    workerName.safeParse(argv[4]).success
  ) {
    if (argv[4] !== target.workerName) return { ok: false, reason: 'Command Worker does not match target' };
    if (target.environment !== 'staging' && target.environment !== 'preview')
      return { ok: false, reason: 'Upload requires a staging or preview target' };
    if (artifact === undefined || compatibilityDate === undefined)
      return { ok: false, reason: 'Upload requires an artifact manifest and compatibility date' };
    if (argv[2] !== artifact.path)
      return { ok: false, reason: 'Upload artifact path does not match manifest' };
    return {
      ok: true,
      plan: {
        kind: 'upload-version',
        target,
        scope: 'deploy',
        artifact,
        compatibilityDate,
        budget: { timeoutMs: 60_000, maxOutputBytes: MAX_BYTES },
      },
    };
  }
  return { ok: false, reason: 'Operation is not supported by this Cloudflare draft' };
}
