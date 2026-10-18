// A card drawn at its natural height (owner 2026-10-18: "the expense tracker widget … is not
// fully visible"): nothing stretched to fill a cell. In the chat and the full view with every
// row it has; on the home, a full-width card with the rows its size allows. Narrow cards on the
// home keep their cell's height, so two sit side by side.
import { createContext, useContext } from "react";

export const FitContext = createContext(false);
export const useFit = () => useContext(FitContext);
/** Undoes a `flex: 1` that fills a cell: in a card with no set height it would collapse to nothing. */
export const UNFLEX = { flexGrow: 0, flexShrink: 0, flexBasis: "auto" } as const;
/** Rows shown when a card fits its content: all of them, within reason. */
export const FIT_ROWS = 50;
