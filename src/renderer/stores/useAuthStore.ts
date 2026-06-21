import { create } from 'zustand';

export interface AuthState {
  status: 'idle' | 'connecting' | 'logged_in' | 'gc_connecting' | 'gc_ready' | 'error';
  steamId: string | null;
  accountName: string | null;
  errorMessage: string | null;
  needSteamGuard: boolean;
  lastCodeWrong: boolean;

  // Actions
  setStatus: (status: AuthState['status']) => void;
  setSteamId: (id: string | null) => void;
  setAccountName: (name: string | null) => void;
  setError: (msg: string | null) => void;
  setSteamGuard: (needed: boolean, lastWrong?: boolean) => void;
  reset: () => void;
}

const initial = {
  status: 'idle' as const,
  steamId: null,
  accountName: null,
  errorMessage: null,
  needSteamGuard: false,
  lastCodeWrong: false,
};

export const useAuthStore = create<AuthState>((set) => ({
  ...initial,

  setStatus: (status) => set({ status, errorMessage: status === 'error' ? undefined : null }),
  setSteamId: (steamId) => set({ steamId }),
  setAccountName: (accountName) => set({ accountName }),
  setError: (errorMessage) => set({ errorMessage, status: 'error' }),
  setSteamGuard: (needSteamGuard, lastCodeWrong = false) =>
    set({ needSteamGuard, lastCodeWrong }),
  reset: () => set(initial),
}));
