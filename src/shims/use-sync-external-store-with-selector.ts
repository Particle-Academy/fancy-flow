/**
 * ESM polyfill for `use-sync-external-store/shim/with-selector.js`.
 *
 * Why this exists: we bundle `@xyflow/react` (see tsup.config.ts), which
 * transitively pulls in zustand → the CJS-only
 * `use-sync-external-store/shim/with-selector`. esbuild bundles that CJS
 * module but leaves its internal `require("react")` intact in the ESM
 * output — and `react` is (correctly) external. A browser ESM consumer
 * then hits `require is not defined` / "Calling require for react".
 *
 * The build redirects that import here (tsup esbuildPlugins). React 18+
 * ships `useSyncExternalStore` natively, and our peer range is
 * ^18 || ^19, so we only re-implement the selector + equality
 * memoization layer on top of it. This is the canonical algorithm from
 * React's own `use-sync-external-store/with-selector` source, kept
 * verbatim so behavior matches what zustand/xyflow expect.
 *
 * zustand imports the DEFAULT export and destructures
 * `useSyncExternalStoreWithSelector`, so we expose both default + named.
 */
import { useSyncExternalStore, useRef, useEffect, useMemo, useDebugValue } from "react";

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: undefined | null | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
  const instRef = useRef<{ hasValue: boolean; value: Selection | null } | null>(null);
  let inst: { hasValue: boolean; value: Selection | null };
  if (instRef.current === null) {
    inst = { hasValue: false, value: null };
    instRef.current = inst;
  } else {
    inst = instRef.current;
  }

  const [getSelection, getServerSelection] = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot: Snapshot;
    let memoizedSelection: Selection;

    const memoizedSelector = (nextSnapshot: Snapshot): Selection => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);
        if (isEqual !== undefined && inst.hasValue) {
          const currentSelection = inst.value as Selection;
          if (isEqual(currentSelection, nextSelection)) {
            memoizedSelection = currentSelection;
            return currentSelection;
          }
        }
        memoizedSelection = nextSelection;
        return nextSelection;
      }

      const prevSnapshot = memoizedSnapshot;
      const prevSelection = memoizedSelection;

      if (Object.is(prevSnapshot, nextSnapshot)) {
        return prevSelection;
      }

      const nextSelection = selector(nextSnapshot);
      if (isEqual !== undefined && isEqual(prevSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return prevSelection;
      }

      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    };

    const maybeGetServerSnapshot = getServerSnapshot === undefined || getServerSnapshot === null ? null : getServerSnapshot;
    const getSnapshotWithSelector = (): Selection => memoizedSelector(getSnapshot());
    const getServerSnapshotWithSelector =
      maybeGetServerSnapshot === null ? undefined : (): Selection => memoizedSelector(maybeGetServerSnapshot());

    return [getSnapshotWithSelector, getServerSnapshotWithSelector] as const;
  }, [getSnapshot, getServerSnapshot, selector, isEqual]);

  const value = useSyncExternalStore(subscribe, getSelection, getServerSelection);

  useEffect(() => {
    inst.hasValue = true;
    inst.value = value;
  }, [value]);

  useDebugValue(value);
  return value;
}

export default { useSyncExternalStoreWithSelector };
