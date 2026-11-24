'use client';
import { useState } from 'react';
import { Button, Field, Notice, L } from '@hms/ui';
import { Captcha } from './captcha';
export function CallbackForm({ demo, portalUrl }: { demo: boolean; portalUrl: string }) {
  const [name, setName] = useState(''),
    [phone, setPhone] = useState('+91'),
    [category, setCategory] = useState('appointment'),
    [consent, setConsent] = useState(false),
    [token, setToken] = useState(''),
    [reset, setReset] = useState(0),
    [busy, setBusy] = useState(false),
    [msg, setMsg] = useState(''),
    [ok, setOk] = useState(false);
  return (
    <form
      className="surface callback-form stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg('');
        setOk(false);
        try {
          if (!demo) {
            const r = await fetch(portalUrl.replace(/\/$/, '') + '/api/public/inquiry', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, phone, category, consent, token }),
              credentials: 'omit',
              cache: 'no-store',
            });
            const result = await r.json();
            if (!r.ok) throw new Error(result.error || 'Unable to submit');
          }
          setOk(true);
          setMsg(
            demo
              ? 'Preview request recorded locally. No message was sent.'
              : 'Request received. Reception can contact you during working hours.',
          );
          setName('');
          setPhone('+91');
          setConsent(false);
        } catch (e) {
          setMsg(e instanceof Error ? e.message : 'Unable to submit');
        } finally {
          setBusy(false);
          setToken('');
          setReset((x) => x + 1);
        }
      }}
    >
      <Field label="Your name">
        <input
          required
          minLength={2}
          maxLength={100}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Phone with country code">
        <input
          type="tel"
          required
          pattern="\+[1-9][0-9]{7,14}"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>
      <Field label="What can we help with?">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="appointment">Appointments</option>
          <option value="hours">Opening hours</option>
          <option value="billing">Billing information</option>
          <option value="general">General inquiry</option>
        </select>
      </Field>
      <Notice>
        <L en="Do not include medical records, symptoms or emergency information. For emergencies, contact local emergency services." />
      </Notice>
      <label className="check-field">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I
        acknowledge the <a href="/policies/privacy">privacy notice</a> and request a callback.
      </label>
      {!demo && <Captcha onToken={setToken} resetKey={reset} />}
      <Button type="submit" disabled={busy || !consent || (!demo && !token)}>
        Request callback
      </Button>
      {msg && <Notice tone={ok ? 'success' : 'warning'}>{msg}</Notice>}
    </form>
  );
}
