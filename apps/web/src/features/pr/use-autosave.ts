'use client';

// Draft autosave (FR-024, research R10): every change is mirrored to the local store at once and
// sent as `PATCH /prs/:id` after 2 s without typing, unless the content equals what was last
// saved. Saves run one at a time with the version the previous save returned; a
// VERSION_CONFLICT stops autosaving until the user reloads.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { ApiRequestError } from '@/lib/api-client';
import { useSavePrDraft } from './api';
import { draftKey, useAutosaveStore } from './autosave-store';
import { documentHash, toDraftBody, type PrFormValues } from './form-model';

export const AUTOSAVE_DELAY_MS = 2000;

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';

export interface Autosave {
  status: AutosaveStatus;
  /** latest server version */
  version: () => number;
  /** local edits newer than the server copy were restored on open */
  restored: boolean;
  /** saves now if anything is unsaved; resolves with the version to submit against */
  flush: () => Promise<number>;
  /** forget the local copy (after submit or delete) */
  discard: () => void;
}

export function useAutosave(options: {
  prId: string;
  userId: string;
  form: UseFormReturn<PrFormValues>;
  /** what the server holds, as loaded */
  serverValues: PrFormValues;
  serverVersion: number;
  enabled: boolean;
}): Autosave {
  const { prId, userId, form, enabled } = options;
  const key = draftKey(userId, prId);
  const save = useSavePrDraft(prId);
  const put = useAutosaveStore((s) => s.put);
  const clear = useAutosaveStore((s) => s.clear);

  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [restored, setRestored] = useState(false);
  const versionRef = useRef(options.serverVersion);
  const savedHashRef = useRef(documentHash(options.serverValues));
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const conflictRef = useRef(false);

  const saveNow = useCallback((): Promise<void> => {
    const run = async () => {
      if (conflictRef.current) return;
      const values = form.getValues();
      const hash = documentHash(values);
      if (hash === savedHashRef.current) {
        clear(key);
        setStatus((s) => (s === 'idle' ? s : 'saved'));
        return;
      }
      setStatus('saving');
      try {
        const result = await save.mutateAsync({ body: toDraftBody(values, versionRef.current) });
        versionRef.current = result.version;
        savedHashRef.current = hash;
        // give new lines their ids so the next save updates them instead of adding copies
        result.lineIds.forEach((id, i) => {
          if (id && !form.getValues(`lines.${i}.id`)) {
            form.setValue(`lines.${i}.id`, id, { shouldDirty: false });
          }
        });
        if (documentHash(form.getValues()) === hash) clear(key);
        setStatus('saved');
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'VERSION_CONFLICT') {
          conflictRef.current = true;
          setStatus('conflict');
        } else {
          setStatus('error');
        }
      }
    };
    chainRef.current = chainRef.current.then(run);
    return chainRef.current;
  }, [clear, form, key, save]);

  // Restore a local copy that is newer than the server's, once.
  useEffect(() => {
    if (!enabled) return;
    const local = useAutosaveStore.getState().drafts[key];
    if (!local) return;
    if (
      local.baseVersion === options.serverVersion &&
      documentHash(local.values) !== savedHashRef.current
    ) {
      form.reset(local.values);
      setRestored(true);
      void saveNow();
    } else {
      clear(key);
    }
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled) return;
    const subscription = form.watch((values) => {
      if (conflictRef.current) return;
      put(key, {
        values: values as PrFormValues,
        baseVersion: versionRef.current,
        savedAt: Date.now(),
      });
      setStatus('pending');
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void saveNow(), AUTOSAVE_DELAY_MS);
    });
    return () => {
      subscription.unsubscribe();
      clearTimeout(timerRef.current);
    };
  }, [enabled, form, key, put, saveNow]);

  const flush = useCallback(async () => {
    clearTimeout(timerRef.current);
    await saveNow();
    if (conflictRef.current) {
      throw new ApiRequestError(409, 'VERSION_CONFLICT', 'The draft was changed elsewhere');
    }
    return versionRef.current;
  }, [saveNow]);

  const discard = useCallback(() => {
    clearTimeout(timerRef.current);
    conflictRef.current = true; // no more saves for this form instance
    clear(key);
  }, [clear, key]);

  return { status, version: () => versionRef.current, restored, flush, discard };
}
