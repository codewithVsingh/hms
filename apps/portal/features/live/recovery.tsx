'use client';
import { useState } from 'react';
import { Brand, Button, Field, Notice } from '@hms/ui';
import { Captcha } from './captcha';
import { v2 } from './v2-client';
export function Recovery({ reset = false, demo = false }: { reset?: boolean; demo?: boolean }) {
  const [value, setValue] = useState(''),
    [captcha, setCaptcha] = useState(''),
    [key, setKey] = useState(0),
    [busy, setBusy] = useState(false),
    [msg, setMsg] = useState('');
  return (
    <main id="main" className="booking-container">
      <form
        className="surface ops-panel stack"
        style={{ maxWidth: 520, margin: '30px auto' }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg('');
          try {
            if (demo) {
              setMsg('Preview only. No email or password changes were sent.');
              return;
            }
            await v2(
              reset ? 'auth/password' : 'auth/recover',
              reset ? { password: value } : { email: value, captchaToken: captcha },
            );
            setMsg(
              reset
                ? 'Password updated. Sign in again with the new password.'
                : 'If the account is eligible, a recovery message will arrive.',
            );
            setValue('');
          } catch (e) {
            setMsg(e instanceof Error ? e.message : 'Try again.');
          } finally {
            setBusy(false);
            setCaptcha('');
            setKey((k) => k + 1);
          }
        }}
      >
        <Brand href="/login" />
        <h1>{reset ? 'Set a new password' : 'Recover account'}</h1>
        <p>
          {reset
            ? 'Use a unique password of at least 12 characters.'
            : 'Enter your hospital-issued work email.'}
        </p>
        <Field label={reset ? 'New password' : 'Work email'}>
          <input
            required
            type={reset ? 'password' : 'email'}
            minLength={reset ? 12 : undefined}
            autoComplete={reset ? 'new-password' : 'email'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        {!reset && !demo && <Captcha onToken={setCaptcha} resetKey={key} />}
        <Button type="submit" disabled={busy || (!reset && !demo && !captcha)}>
          {reset ? 'Set password' : 'Send recovery link'}
        </Button>
        {msg && <Notice>{msg}</Notice>}
        <a href="/login">Return to sign in</a>
      </form>
    </main>
  );
}
