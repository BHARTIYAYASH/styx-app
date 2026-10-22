import type { PermissionMode } from '@styx/core';
import { styxMcpServerInherit, type AgentLaunch, type AgentLaunchContext } from './types';

/** Goose's smart approval is not an edit-only mode; use explicit approvals for both Auto and Accept edits. */
export const GOOSE_MODES: Readonly<Record<PermissionMode, string>> = {
  default: 'approve',
  acceptEdits: 'approve',
  auto: 'approve',
  plan: 'chat',
  dontAsk: 'chat',
  bypassPermissions: 'auto',
};

/**
 * Checked against Goose 1.55.0 (2026-10-22): `acp --help`, `session --help` and the ACP mode definitions.
 * ACP carries the Styx MCP server in `session/new`; older builds use `session --with-extension` in a terminal.
 * The developer extension supplies file and shell tools. GOOSE_MODE overrides Goose's automatic-approval default
 * for this process only, and GOOSE_MODEL selects a model on the user's configured provider. No config is written.
 * UNVERIFIED: the interactive terminal fallback was checked against help, not a live model.
 */
export async function gooseLaunch(ctx: AgentLaunchContext): Promise<AgentLaunch> {
  const env: Record<string, string> = { GOOSE_MODE: GOOSE_MODES[ctx.permissionMode] };
  if (ctx.model) env['GOOSE_MODEL'] = ctx.model;
  if (ctx.runner === 'stream' && ctx.capabilities['acp'] === true)
    return {
      command: ctx.binary,
      args: ['acp', '--with-builtin', 'developer'],
      env,
      typeFirstMessage: false,
      stream: { kind: 'acp' },
      cleanup: async () => undefined,
    };

  const mcp = styxMcpServerInherit(ctx);
  // Goose's split_command_args preserves backslashes and apostrophes inside double quotes on every platform.
  // The broker token stays in the inherited environment, never in argv or a worktree file.
  const words = [mcp.command, ...mcp.args];
  if (mcp.command.includes('=') || words.some((word) => word.includes('"')))
    throw new Error('Update Goose to a version with ACP to use this Styx path in the terminal.');
  const extension = words.map((word) => `"${word}"`).join(' ');
  return {
    command: ctx.binary,
    args: ['session', '--with-builtin', 'developer', '--with-extension', extension],
    env,
    typeFirstMessage: true,
    cleanup: async () => undefined,
  };
}
