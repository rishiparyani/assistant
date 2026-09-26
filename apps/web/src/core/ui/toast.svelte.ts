// App-wide toasts: toast.success("Saved"), toast.error(err).
export interface ToastItem {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

export const toasts = $state<ToastItem[]>([]);
let next = 1;

function push(kind: ToastItem["kind"], text: string, ms = 3200) {
  const id = next++;
  toasts.push({ id, kind, text });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, ms);
}

export const toast = {
  success: (text: string) => push("success", text),
  info: (text: string) => push("info", text),
  error: (err: unknown) => push("error", err instanceof Error ? err.message : String(err), 5000),
};
