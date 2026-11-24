export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const response = await fetch('/api/v1/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'The service is unavailable.');
  return data as T;
}
export function localDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function when(iso: string) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
export function rupees(paise: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}
export function human(s: string) {
  return s.replaceAll('_', ' ').replace(/^./, (v) => v.toUpperCase());
}
export function message(e: unknown) {
  return e instanceof Error ? e.message : 'Operation could not be completed.';
}
export type BookingRecord = {
  id: string;
  reference: string;
  mrn?: string;
  doctor: string;
  patient: string;
  startsAt: string;
  status: string;
  paymentChoice: string;
  feePaise: number;
  paymentStatus: string;
  invoiceNumber: string;
  expiresAt: string | null;
  orderId?: string | null;
};
