import { createContext } from "react";

/** The app header's game-status area. A mounted game portals its turn status
 * here; standalone renders (no provider) show it inline instead. */
export const HeaderSlot = createContext<HTMLElement | null>(null);
