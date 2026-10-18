// A card drawn at its natural height (the chat and the full view, owner 2026-10-18: "the
// expense tracker widget … is not fully visible"): every row it has, nothing stretched to fill
// a home cell. On the home a card keeps its cell's height and shows what fits.
import { createContext, useContext } from "react";

export const FitContext = createContext(false);
export const useFit = () => useContext(FitContext);
/** Undoes a `flex: 1` that fills a cell: in a card with no set height it would collapse to nothing. */
export const UNFLEX = { flexGrow: 0, flexShrink: 0, flexBasis: "auto" } as const;
/** Rows shown when a card fits its content: all of them, within reason. */
export const FIT_ROWS = 50;
