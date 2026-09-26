// A styled replacement for window.confirm(): `if (await confirm({...})) …`.
export interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

export const confirmState = $state<{ request: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null }>(
  {
    request: null,
  },
);

export function confirm(req: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.request?.resolve(false);
    confirmState.request = { ...req, resolve };
  });
}
