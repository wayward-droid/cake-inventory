// ---------------------------------------------------------------------------
// Session, profile and role helpers.
// ---------------------------------------------------------------------------

import { sb, errText, IS_CONFIGURED } from './supabase.js';

let profileCache = null;
let sessionCache = null;

export async function getSession() {
  if (sessionCache) return sessionCache;
  const { data } = await sb.auth.getSession();
  sessionCache = data?.session || null;
  return sessionCache;
}

export async function getProfile(force = false) {
  if (profileCache && !force) return profileCache;
  const session = await getSession();
  if (!session?.user) return null;

  let { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  // The sign-up trigger can take a moment on a fresh Supabase project.
  if (!data && !error) {
    await new Promise((r) => setTimeout(r, 450));
    ({ data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle());
  }
  if (error) throw new Error(errText(error));
  profileCache = data || {
    id: session.user.id,
    email: session.user.email,
    full_name: session.user.user_metadata?.full_name || session.user.email,
    role: 'staff',
    active: true,
    _missing: true,
  };
  return profileCache;
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(errText(error));
  sessionCache = data?.session || null;
  profileCache = null;
  return data;
}

export async function signUp({ email, password, fullName, phone }) {
  const { data, error } = await sb.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { full_name: fullName, phone } },
  });
  if (error) throw new Error(errText(error));
  sessionCache = data?.session || null;
  profileCache = null;
  return data;
}

export async function claimOwner() {
  const { data, error } = await sb.rpc('claim_owner');
  if (error) throw new Error(errText(error));
  profileCache = null;
  return data;
}

export async function signOut() {
  await sb.auth.signOut();
  sessionCache = null;
  profileCache = null;
}

export async function requireAuth() {
  if (!IS_CONFIGURED) {
    location.replace('index.html');
    return null;
  }
  const session = await getSession();
  if (!session?.user) {
    const back = location.pathname.endsWith('dashboard.html')
      ? encodeURIComponent(location.hash || '#/dashboard')
      : encodeURIComponent('#/dashboard');
    location.replace(`index.html?next=${back}`);
    return null;
  }
  const profile = await getProfile();
  if (!profile || profile.active === false) {
    await signOut();
    location.replace('index.html?error=inactive');
    return null;
  }
  return profile;
}

export async function requireOwner() {
  const profile = await getProfile();
  if (!profile || profile.role !== 'owner') {
    throw new Error('This area is only available to the owner.');
  }
  return profile;
}

export async function isOwner() {
  const p = await getProfile();
  return p?.role === 'owner';
}

export function displayName(profile) {
  return profile?.full_name || profile?.email?.split('@')[0] || 'There';
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || 'CS';
}

export function onAuthChange(cb) {
  return sb.auth.onAuthStateChange((event, session) => {
    sessionCache = session || null;
    profileCache = null;
    cb(event, session);
  });
}

export async function sendPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${location.origin}${location.pathname.replace('index.html', '')}index.html?reset=1`,
  });
  if (error) throw new Error(errText(error));
}
