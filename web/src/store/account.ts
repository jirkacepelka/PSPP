/*
 * State of the optional online account and of the cloud save indicator.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { create } from 'zustand';
import type { CloudUser, Usage } from '../lib/cloud';

/** idle: nothing to save · saving · saved · offline (will retry) · tooLarge / quota: skipped, kept in the browser */
export type CloudSync = 'idle' | 'saving' | 'saved' | 'offline' | 'tooLarge' | 'quota';

interface AccountState {
  user: CloudUser | null;
  usage: Usage | null;
  sync: CloudSync;
  set: (patch: Partial<Pick<AccountState, 'user' | 'usage' | 'sync'>>) => void;
}

export const useAccount = create<AccountState>((set) => ({
  user: null,
  usage: null,
  sync: 'idle',
  set: (patch) => set(patch),
}));
