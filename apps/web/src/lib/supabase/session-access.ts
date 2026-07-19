import { getBrowserSupabase } from "./browser";

export async function ensureSessionAccess(sessionId: string) {
  const supabase = getBrowserSupabase();
  if (!supabase)
    throw new Error("Supabase browser credentials are not configured.");

  let { data } = await supabase.auth.getSession();
  if (!data.session) {
    const signedIn = await supabase.auth.signInAnonymously();
    if (signedIn.error) throw signedIn.error;
    data = { session: signedIn.data.session };
  }
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Supabase did not return an access token.");

  const headers = { authorization: `Bearer ${accessToken}` };
  const joined = await fetch(`/api/sessions/${sessionId}/join`, {
    method: "POST",
    headers,
  });
  if (!joined.ok) throw new Error(`Session join failed (${joined.status}).`);
  await supabase.realtime.setAuth(accessToken);

  return { supabase, accessToken, headers };
}
