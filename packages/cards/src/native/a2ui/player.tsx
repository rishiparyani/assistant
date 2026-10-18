// A React Native player for A2UI (decision 2026-10-18 "Try A2UI"): it draws a surface that
// Google's A2UI core (@a2ui/web_core) keeps, with native views from the app. Nothing here
// knows the app's theme, data or network: the views decide how each part looks, the host
// decides what the data is. Kept apart so it can become a shared package.
//
// Only the core's root entry is used: its versioned entries (v0_9, v1_0) also bring the web
// renderers (Lit), which don't run on a phone.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ComponentContext, GenericBinder, type SurfaceModel } from "@a2ui/web_core";

/** A resolved child: its id and, for a repeated part, the data it stands for. */
export type ChildRef = string | { id: string; basePath: string };

export interface PartProps {
  /** The part's properties with their data resolved, plus a `setX` for each bound one. */
  props: Record<string, unknown>;
  /** Draws a child. */
  child: (ref: ChildRef, key?: string | number) => ReactNode;
}

/** A part the player can draw: its name, its schema (Zod 3, from the catalogue) and its view. */
export interface PartView {
  name: string;
  schema: unknown;
  View: (p: PartProps) => ReactNode;
}

const Surface = createContext<{ surface: SurfaceModel; parts: Map<string, PartView> } | null>(null);

/** Draws a surface from its root. Parts the app has no view for are left out. */
export function A2uiSurface({ surface, parts }: { surface: SurfaceModel; parts: PartView[] }) {
  const value = useMemo(() => ({ surface, parts: new Map(parts.map((p) => [p.name, p])) }), [surface, parts]);
  // Parts arrive one by one while the agent writes: draw again when one does.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const added = surface.componentsModel.onCreated.subscribe(redraw);
    const removed = surface.componentsModel.onDeleted.subscribe(redraw);
    return () => {
      added.unsubscribe();
      removed.unsubscribe();
    };
  }, [surface]);
  return (
    <Surface.Provider value={value}>
      <Node id="root" basePath="/" />
    </Surface.Provider>
  );
}

function Node({ id, basePath }: { id: string; basePath: string }) {
  const ctx = useContext(Surface)!;
  const model = ctx.surface.componentsModel.get(id);
  const part = model ? ctx.parts.get(model.type) : undefined;
  if (!model || !part) return null;
  return <Bound key={`${model.type}:${id}`} id={id} basePath={basePath} part={part} />;
}

function Bound({ id, basePath, part }: { id: string; basePath: string; part: PartView }) {
  const { surface } = useContext(Surface)!;
  // The core resolves every bound property and keeps it current; a setter writes the data.
  const binder = useMemo(
    () =>
      // The core is built on its own copy of Zod 3; the schema is the same shape (zod/v3).
      new GenericBinder<Record<string, unknown>>(
        new ComponentContext(surface, id, basePath),
        part.schema as ConstructorParameters<typeof GenericBinder>[1],
      ),
    [surface, id, basePath, part],
  );
  // One subscription per binder: the binder connects on its first listener and lets go on its
  // last, so a new subscribe function on every draw would loop.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const sub = binder.subscribe(onChange);
      return () => sub.unsubscribe();
    },
    [binder],
  );
  const snapshot = useCallback(() => binder.snapshot, [binder]);
  const props = useSyncExternalStore(subscribe, snapshot) ?? {};
  // Hidden when it has a visible that isn't yes (a path with nothing there yet counts as no).
  const raw = surface.componentsModel.get(id)?.properties;
  if (raw && "visible" in raw && !props.visible) return null;
  const child = (ref: ChildRef, key?: string | number) =>
    typeof ref === "string" ? (
      <Node key={key ?? ref} id={ref} basePath={basePath} />
    ) : (
      <Node key={key ?? ref.basePath} id={ref.id} basePath={ref.basePath} />
    );
  const View = part.View;
  return <View props={props} child={child} />;
}
