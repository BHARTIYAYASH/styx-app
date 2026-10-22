// @vitest-environment jsdom
import { fixtures } from '@styx/core';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoginTerminal, disposeLoginTerminal } from '../modals/login-terminal';
import { getTerminal, detachTerminal, type TerminalEntry } from './terminal-registry';
import { TerminalPane } from './TerminalPane';

vi.mock('../modals/login-terminal', () => ({
  createLoginTerminal: vi.fn(),
  disposeLoginTerminal: vi.fn(),
}));
vi.mock('./terminal-registry', () => ({
  getTerminal: vi.fn(),
  detachTerminal: vi.fn(),
  fitTerminal: vi.fn(),
  setTerminalScreenReader: vi.fn(),
  attachTerminal: (entry: TerminalEntry, parent: HTMLElement) => parent.append(entry.host),
}));

const entry = (): TerminalEntry => ({ host: document.createElement('div') }) as TerminalEntry;
const props = {
  sessionId: fixtures.ids.session.claude,
  worktreeId: fixtures.ids.worktree.fixCheckout,
  branch: 'agent/amp-1',
  screenReader: false,
  columnHeight: () => 800,
};

describe('TerminalPane process selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createLoginTerminal).mockImplementation(entry);
    vi.mocked(getTerminal).mockImplementation(entry);
  });
  afterEach(cleanup);

  it('attaches an existing terminal agent, reattaches after a new pid, and disposes its listeners', () => {
    const { rerender, unmount } = render(
      <TerminalPane {...props} agentTerminal={{ id: props.sessionId, pid: 10 }} />,
    );
    expect(createLoginTerminal).toHaveBeenCalledWith(props.sessionId, { screenReader: false });
    expect(getTerminal).not.toHaveBeenCalled();
    rerender(<TerminalPane {...props} agentTerminal={{ id: props.sessionId, pid: 20 }} />);
    expect(disposeLoginTerminal).toHaveBeenCalledTimes(1);
    expect(createLoginTerminal).toHaveBeenCalledTimes(2);
    unmount();
    expect(disposeLoginTerminal).toHaveBeenCalledTimes(2);
    expect(detachTerminal).not.toHaveBeenCalled();
  });

  it('keeps ordinary worktree terminals on the existing cached shell path', () => {
    const { unmount } = render(<TerminalPane {...props} />);
    expect(getTerminal).toHaveBeenCalledWith(props.sessionId, props.worktreeId, { screenReader: false });
    expect(createLoginTerminal).not.toHaveBeenCalled();
    unmount();
    expect(detachTerminal).toHaveBeenCalledTimes(1);
    expect(disposeLoginTerminal).not.toHaveBeenCalled();
  });
});
