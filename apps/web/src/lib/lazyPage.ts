import { lazy, type ComponentType } from 'react';
import { recoverIfChunkError } from './chunkReload';

function importWithReload<T>(loader: () => Promise<T>): Promise<T> {
  return loader().catch((err: unknown) => {
    if (recoverIfChunkError(err)) return new Promise<T>(() => {});
    throw err;
  });
}

/** Code-split a named export. Stale deploy hashes reload once instead of a blank page. */
export function lazyNamed<M>(loader: () => Promise<M>, exportName: keyof M & string) {
  return lazy(() =>
    importWithReload(() =>
      loader().then((m) => ({ default: (m as Record<string, ComponentType>)[exportName] })),
    ),
  );
}
