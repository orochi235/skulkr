import { isEditableTarget } from '@weasel-js/gestures';
import { useEffect } from 'react';

/** Escape anywhere on the page calls `release`, unless something under the key claims it first: a field being typed
 *  in, an open dialog or popover, or a handler that already prevented its default. */
export function useReleaseOnEscape(release: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isEditableTarget(e.target)) return;
      if (e.target instanceof Element && e.target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      release();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [release]);
}
