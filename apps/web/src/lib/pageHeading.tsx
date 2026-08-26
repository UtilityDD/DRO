import { createContext, useContext, useEffect, type ReactNode } from 'react';

type SetHeading = (heading: string) => void;

const HeadingContext = createContext<SetHeading | null>(null);

export function PageHeadingProvider({ set, children }: { set: SetHeading; children: ReactNode }) {
  return <HeadingContext.Provider value={set}>{children}</HeadingContext.Provider>;
}

/** Lets a page replace the shell masthead title with its own live heading. */
export function usePageHeading(heading: string) {
  const set = useContext(HeadingContext);
  useEffect(() => {
    if (!set) return;
    set(heading);
    return () => set('');
  }, [set, heading]);
}
