import type { Scope } from './types';

const DELETE_COMMANDS: readonly (readonly string[])[] = [
  ['delete'],
  ['d1', 'delete'],
  ['d1', 'time-travel', 'restore'],
  ['r2', 'bucket', 'delete'],
  ['r2', 'object', 'delete'],
  ['kv', 'namespace', 'delete'],
  ['kv', 'key', 'delete'],
  ['kv', 'bulk', 'delete'],
  ['secret', 'delete'],
  ['versions', 'secret', 'delete'],
  ['pages', 'project', 'delete'],
  ['pages', 'deployment', 'delete'],
];

const DEPLOY_COMMANDS: readonly (readonly string[])[] = [
  ['deploy'],
  ['publish'],
  ['rollback'],
  ['versions', 'upload'],
  ['versions', 'deploy'],
  ['triggers', 'deploy'],
  ['pages', 'deploy'],
  ['pages', 'publish'],
];

const STANDALONE_INFO_FLAGS = new Set(['--help', '-h', '--version', '-v']);
const SHELL_SYNTAX = /[\u0000-\u001f\u007f;&|<>`$\\()]/;
// Deliberately excludes route URLs, flags, whitespace, and config paths. The draft accepts Worker names only.
const WORKER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function startsWithCommand(argv: string[], command: readonly string[]): boolean {
  return command.every((word, index) => argv[index] === word);
}

/** Only an explicit Worker name and one optional JSON flag; no global options or positional extras. */
function isNamedList(argv: string[]): boolean {
  let name: string | undefined;
  let json = false;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json' && !json) {
      json = true;
    } else if (arg === '--name' && name === undefined) {
      name = argv[index + 1];
      if (name === undefined || !WORKER_NAME.test(name)) return false;
      index += 1;
    } else if (arg?.startsWith('--name=') && name === undefined) {
      name = arg.slice('--name='.length);
      if (!WORKER_NAME.test(name)) return false;
    } else {
      return false;
    }
  }
  return name !== undefined;
}

/**
 * Review-only Wrangler classification. This is not an execution allowlist: the draft adapter never issues a
 * credential. Inspect command words in place, never scan option values for read verbs or help flags. Global
 * overrides and unreviewed commands fail closed, including config-driven local work and authentication changes.
 */
export function cloudflareScopeOfCommand(argv: string[]): Scope[] {
  if (argv.some((arg) => arg === '' || SHELL_SYNTAX.test(arg))) return ['write'];
  // Mutating heads win over appended help flags. Upload is still a remote mutation even without traffic changes.
  if (DELETE_COMMANDS.some((command) => startsWithCommand(argv, command))) return ['delete'];
  if (DEPLOY_COMMANDS.some((command) => startsWithCommand(argv, command))) return ['deploy'];
  if (argv.length === 1 && STANDALONE_INFO_FLAGS.has(argv[0] ?? '')) return ['read'];

  if (argv[0] === 'whoami' && (argv.length === 1 || (argv.length === 2 && argv[1] === '--json'))) {
    return ['read'];
  }
  if ((argv[0] === 'versions' || argv[0] === 'deployments') && argv[1] === 'list' && isNamedList(argv)) {
    return ['read'];
  }
  if (
    argv.length === 4 &&
    argv[0] === 'tail' &&
    WORKER_NAME.test(argv[1] ?? '') &&
    argv[2] === '--format' &&
    argv[3] === 'json'
  ) {
    return ['read'];
  }
  return ['write'];
}
