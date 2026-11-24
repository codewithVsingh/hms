export async function v3<T = unknown>(path: string, data?: unknown): Promise<T> {
  const form = typeof FormData !== 'undefined' && data instanceof FormData;
  const r = await fetch('/api/v3/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: data === undefined || form ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : form ? data : JSON.stringify(data),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || 'Operation unavailable.');
  return j as T;
}
export type CancellationPolicy = { feePaise: number; freeHours: number; version: number };
export type CancellationQuote = {
  eligible: boolean;
  cancelled?: boolean;
  reason?: string;
  paidPaise?: number;
  deductionPaise?: number;
  refundPaise?: number;
  policyVersion?: number;
  slotId?: string;
  startsAt?: string;
  refundStatus?: string;
  refundId?: string | null;
  feePaise?: number;
  freeHours?: number;
};
