import { redirect } from 'next/navigation';
export default async function PortalHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Keep an explicit language choice (?lang=hi) when sending visitors to sign-in.
  const { lang } = await searchParams;
  redirect(lang === 'hi' || lang === 'en' ? `/login?lang=${lang}` : '/login');
}
