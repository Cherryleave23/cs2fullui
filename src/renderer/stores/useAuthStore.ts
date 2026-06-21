import { create } from 'zustand';

export interface AccountInfo {
  steamId: string;
  accountName: string;
  nickname: string;
  isActive: boolean;
  lastLoginAt: string | null;
  hasToken: boolean;
}

export interface AuthState {
  status: 'idle' | 'connecting' | 'logged_in' | 'gc_ready' | 'error';
  steamId: string | null;
  accountName: string | null;
  nickname: string | null;
  errorMessage: string | null;
  needSteamGuard: boolean;
  lastCodeWrong: boolean;
  accounts: AccountInfo[];
  inventoryCount: number;

  // Actions
  setStatus: (status: AuthState['status']) => void;
  setSteamId: (id: string | null) => void;
  setAccountName: (name: string | null) => void;
  setNickname: (name: string | null) => void;
  setError: (msg: string | null) => void;
  setSteamGuard: (needed: boolean, lastWrong?: boolean) => void;
  setAccounts: (accounts: AccountInfo[]) => void;
  setInventoryCount: (count: number) => void;
  reset: () => void;
}

const initial = {
  status: 'idle' as const,
  steamId: null,
  accountName: null,
  nickname: null,
  errorMessage: null,
  needSteamGuard: false,
  lastCodeWrong: false,
  accounts: [] as AccountInfo[],
  inventoryCount: 0,
};

export const useAuthStore = create<AuthState>((set) => ({
  ...initial,

  setStatus: (status) => set({ status, errorMessage: status === 'error' ? undefined : null }),
  setSteamId: (steamId) => set({ steamId }),
  setAccountName: (accountName) => set({ accountName }),
  setNickname: (nickname) => set({ nickname }),
  setError: (errorMessage) => set({ errorMessage, status: 'error' }),
  setSteamGuard: (needSteamGuard, lastCodeWrong = false) =>
    set({ needSteamGuard, lastCodeWrong }),
  setAccounts: (accounts) => set({ accounts }),
  setInventoryCount: (inventoryCount) => set({ inventoryCount }),
  reset: () => set(initial),
}));
