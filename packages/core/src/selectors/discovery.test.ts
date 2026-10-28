import { describe, expect, it } from 'vitest';
import { demoClis, demoIdes, errorFixture } from '../fixtures/demo';
import {
  cliAccountLabel,
  cliAuthLabel,
  cliConnectionLabel,
  cliConnectionState,
  cliAlternatives,
  cliCandidateLabel,
  cliIsManual,
  cliLocationLabel,
  cliSearchedDirs,
  cliSourceOf,
  cliVersionLabel,
  ideImportsLabel,
  ideVersionLabel,
  modelCatalogueFor,
  modelCatalogueOf,
} from './discovery';

describe('onboarding discovery labels', () => {
  it('IDE rows match the prototype ideDefs', () => {
    expect(demoIdes().map((i) => [i.product, ideVersionLabel(i), ideImportsLabel(i)])).toEqual([
      ['VS Code', '1.98 · /Applications', '14 recents'],
      ['Cursor', '1.4', '6 recents'],
      ['JetBrains (WebStorm)', '2026.2', '3 recents'],
      ['Neovim', '0.11 · /opt/homebrew', 'recents via shada'],
    ]);
    expect(ideVersionLabel({ version: null, location: null })).toBe('not found on PATH');
    expect(
      ideImportsLabel({ imported: { recents: 0, keybindings: false, theme: true }, recentsSource: null }),
    ).toBe('—');
    expect(
      ideImportsLabel({
        imported: { recents: 0, keybindings: false, theme: false },
        recentsSource: 'state-db',
      }),
    ).toBe('—');
  });

  it('CLI rows match the prototype obClis, including the missing-codex error state', () => {
    expect(demoClis().map((c) => [cliVersionLabel(c), cliAuthLabel(c)])).toEqual([
      ['claude 2.4.1', 'signed in'],
      ['codex 0.9.3', 'signed in'],
      ['gemini 1.2.0', 'Sign in →'],
      ['cursor-agent 0.5.2', 'signed in'],
      ['zsh 5.9', '—'],
    ]);
    const codex = errorFixture().clis.find((c) => c.agent === 'codex');
    expect(codex && [cliVersionLabel(codex), cliAuthLabel(codex)]).toEqual([
      'not found on PATH',
      'Install →',
    ]);
    expect(cliAuthLabel({ found: true, authState: 'unknown' })).toBe('Sign in →');
    expect(cliVersionLabel({ agent: 'gemini', found: true, version: null, binary: null })).toBe('gemini');
    expect(cliVersionLabel({ agent: 'gemini', found: true, version: '1.0', binary: '' })).toBe('gemini 1.0');
  });
});

describe('agent connection state (Settings › Agents)', () => {
  it('demo rows: claude/codex connected, gemini signed out, cursor unverified, shell ready', () => {
    expect(demoClis().map((c) => [c.agent, cliConnectionState(c), cliAccountLabel(c)])).toEqual([
      ['claude', 'connected', 'nic@acme.dev'],
      ['codex', 'connected', 'ChatGPT'],
      ['gemini', 'signed-out', '—'],
      ['cursor', 'unverified', 'nic@acme.dev'],
      ['shell', 'shell', '—'],
    ]);
  });

  it.each([
    [
      'shell wins over everything',
      { agent: 'shell', found: false, authState: 'n/a', verifiedAt: null },
      'shell',
    ],
    [
      'not found → missing',
      { agent: 'codex', found: false, authState: 'signed-in', verifiedAt: 1 },
      'missing',
    ],
    [
      'signed-out → signed-out',
      { agent: 'gemini', found: true, authState: 'signed-out', verifiedAt: 1 },
      'signed-out',
    ],
    [
      'unknown → signed-out',
      { agent: 'cursor', found: true, authState: 'unknown', verifiedAt: null },
      'signed-out',
    ],
    [
      'n/a on a real CLI → signed-out',
      { agent: 'claude', found: true, authState: 'n/a', verifiedAt: 1 },
      'signed-out',
    ],
    [
      'signed-in, never verified → unverified',
      { agent: 'claude', found: true, authState: 'signed-in', verifiedAt: null },
      'unverified',
    ],
    [
      'signed-in and verified → connected',
      { agent: 'claude', found: true, authState: 'signed-in', verifiedAt: 1 },
      'connected',
    ],
  ] as const)('%s', (_name, cli, expected) => {
    expect(cliConnectionState(cli)).toBe(expected);
  });

  it('labels every state with the verbatim agentsPage copy', () => {
    expect(
      (['connected', 'unverified', 'signed-out', 'missing', 'shell'] as const).map(cliConnectionLabel),
    ).toEqual(['connected', 'not verified', 'signed out', 'not installed', 'ready']);
  });
});

describe('model catalogue (discrepancy #83)', () => {
  const row = {
    id: 'gpt-6-astra',
    label: 'GPT-6 Astra',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    defaultEffort: 'low',
    isDefault: true,
  };

  it('reads `capabilities.models` with schema defaults; anything else is an empty catalogue', () => {
    expect(modelCatalogueOf({ capabilities: { models: [row] } })).toEqual([
      { ...row, description: null, hidden: false },
    ]);
    expect(modelCatalogueOf({ capabilities: {} })).toEqual([]);
    expect(modelCatalogueOf({ capabilities: { models: [{ id: 'x' }] } })).toEqual([]);
    expect(modelCatalogueOf(null)).toEqual([]);
    expect(modelCatalogueOf(undefined)).toEqual([]);
  });

  it('finds the catalogue of the CLI detected for an agent', () => {
    const codex = demoClis().find((c) => c.agent === 'codex');
    if (codex === undefined) throw new Error('fixture');
    const discovery = {
      ides: [],
      clis: demoClis().map((c) =>
        c.agent === 'codex' ? { ...c, capabilities: { ...c.capabilities, models: [row] } } : c,
      ),
    };
    expect(modelCatalogueFor({ discovery }, 'codex').map((m) => m.label)).toEqual(['GPT-6 Astra']);
    expect(modelCatalogueFor({ discovery }, 'claude')).toEqual([]);
    expect(modelCatalogueFor({ discovery: { ides: [], clis: [] } }, 'codex')).toEqual([]);
  });
});

describe('cliSearchedDirs (#98)', () => {
  it('reads the folders detection scanned off the row; a row without them (older or never scanned) reads []', () => {
    const codex = demoClis().find((c) => c.agent === 'codex');
    if (codex === undefined) throw new Error('fixture');
    expect(cliSearchedDirs(codex)).toEqual([]);
    expect(
      cliSearchedDirs({
        capabilities: { ...codex.capabilities, searched: ['/Users/nic/.local/bin', '/opt/homebrew/bin'] },
      }),
    ).toEqual(['/Users/nic/.local/bin', '/opt/homebrew/bin']);
    expect(cliSearchedDirs({ capabilities: { searched: 'nope' } })).toEqual([]);
  });
});

describe('detected CLI sources and alternatives', () => {
  it('labels a selected binary and its source, including older detections with no source', () => {
    const cli = { agent: 'claude' as const, found: true, version: '2.4.1', binary: '/usr/bin/claude', capabilities: { source: 'path' } };
    expect(cliSourceOf(cli)).toBe('path');
    expect(cliIsManual(cli)).toBe(false);
    expect(cliLocationLabel(cli)).toContain('claude 2.4.1 · ');
    expect(cliIsManual({ capabilities: { source: 'manual' } })).toBe(true);
    expect(cliSourceOf({ capabilities: { source: 'old-value' } })).toBeNull();
    expect(cliLocationLabel({ ...cli, capabilities: {} })).toBe('claude 2.4.1');
    expect(cliLocationLabel({ ...cli, found: false })).toBe('not found on PATH');
  });

  it('reads valid binary choices and labels both known and missing binary details', () => {
    const withChoices = { capabilities: { alternatives: [
      { binary: 'C:\\Tools\\claude.exe', version: '2.4.1', source: 'manual' },
      { binary: '/', version: null, source: 'path' },
    ] } };
    const choices = cliAlternatives(withChoices);
    expect(choices).toHaveLength(2);
    const [first, second] = choices;
    if (first === undefined || second === undefined) throw new Error('fixture');
    expect(cliCandidateLabel('claude', first)).toContain('claude.exe 2.4.1 · ');
    expect(cliCandidateLabel('claude', second)).toContain('claude · ');
    expect(cliAlternatives({ capabilities: {} })).toEqual([]);
    expect(cliAlternatives({ capabilities: { alternatives: [{ binary: 4 }] } })).toEqual([]);
  });
});
