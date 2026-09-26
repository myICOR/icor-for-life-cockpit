// breakpoint.ts - the one JS twin of the shell breakpoint (GL-003 §5.10 A366:
// bp_lg 1024 is the mobile number; md is never a chrome gate). The CSS side is
// `@media (width < 64rem)` for the drawer shell. Keep the two in step.
import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 1024;
const DESKTOP_QUERY = `(min-width: ${MOBILE_BREAKPOINT}px)`;

export function isDesktop(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

/** True while the shell is the off-canvas drawer (below 1024px). */
export function useIsDrawer(): boolean {
  const [drawer, setDrawer] = useState(() => !isDesktop());
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDrawer(!mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return drawer;
}
