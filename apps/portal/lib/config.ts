export const websiteUrl = process.env.NEXT_PUBLIC_WEBSITE_URL || 'http://localhost:3000';
export const demoEnabled =
  process.env.HMS_DEMO_MODE === 'true' ||
  (process.env.NODE_ENV === 'development' && process.env.HMS_DEMO_MODE !== 'false');
