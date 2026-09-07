export type GoogleCloudAccessTokenProvider = () => Promise<string>;

/** Obtains a Cloud ADC token; callers own capability-specific validation and timeouts. */
export async function defaultGoogleCloudAccessToken(): Promise<string> {
  const { GoogleAuth } = await import('google-auth-library');
  const token = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getAccessToken();
  if (token === null) throw new Error('missing token');
  return token;
}
