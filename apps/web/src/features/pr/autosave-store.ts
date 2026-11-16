'use client';

// Local copy of unsaved PR form values (research R10): mirrored to localStorage per user and PR so
// a crashed or closed tab between two autosaves loses nothing. Cleared once the server has the
// same content (after a save or a submit).
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PrFormValues } from './form-model';

export interface LocalDraft {
  values: PrFormValues;
  /** server version the edits were made on */
  baseVersion: number;
  savedAt: number;
}

interface AutosaveState {
  drafts: Record<string, LocalDraft>;
  put(key: string, draft: LocalDraft): void;
  clear(key: string): void;
}

export const draftKey = (userId: string, prId: string) => `${userId}:${prId}`;

/** localStorage can throw (private mode, quota); the form keeps working without it. */
const safeStorage = createJSONStorage(() => ({
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // ignore
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // ignore
    }
  },
}));

export const useAutosaveStore = create<AutosaveState>()(
  persist(
    (set) => ({
      drafts: {},
      put: (key, draft) => set((s) => ({ drafts: { ...s.drafts, [key]: draft } })),
      clear: (key) =>
        set((s) => {
          if (!(key in s.drafts)) return s;
          const { [key]: _removed, ...rest } = s.drafts;
          return { drafts: rest };
        }),
    }),
    { name: 'ngo-pr-drafts', storage: safeStorage, version: 1 }
  )
);
