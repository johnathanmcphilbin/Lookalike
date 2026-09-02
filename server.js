require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const fetch = require('node-fetch');
const path = require('path');

const {
  HACKATIME_CLIENT_ID,
  HACKATIME_CLIENT_SECRET,
  HACKATIME_REDIRECT_URI,
  HACKCLUB_CLIENT_ID,
  HACKCLUB_CLIENT_SECRET,
  HACKCLUB_REDIRECT_URI,
  AIRTABLE_FORM_URL,
  SESSION_SECRET,
  MIN_HOURS_REQUIRED = 2,
  PORT = 3000,
} = process.env;

const HACKATIME_BASE = 'https://hackatime.hackclub.com';
const HACKCLUB_AUTH_BASE = 'https://auth.hackclub.com';

if (!HACKATIME_CLIENT_ID || !HACKATIME_CLIENT_SECRET || !HACKATIME_REDIRECT_URI) {
  console.warn('[lookatime] Missing HACKATIME_CLIENT_ID / HACKATIME_CLIENT_SECRET / HACKATIME_REDIRECT_URI in .env — auth routes will fail until set.');
}
if (!HACKCLUB_CLIENT_ID || !HACKCLUB_CLIENT_SECRET || !HACKCLUB_REDIRECT_URI) {
  console.warn('[lookalike] Missing HACKCLUB_CLIENT_ID / HACKCLUB_CLIENT_SECRET / HACKCLUB_REDIRECT_URI in .env — Hack Club identity routes will fail until set.');
}

const app = express();

// cookie-session (not express-session's default MemoryStore) because Vercel is
// serverless — session data has to travel in the signed cookie itself, not sit in
// one instance's RAM, or it silently vanishes on the next request.
app.use(cookieSession({
  name: 'lookalike.sess',
  keys: [SESSION_SECRET || 'dev-only-secret-change-me'],
  maxAge: 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
}));

app.use(express.static(path.join(__dirname)));

// Step 2: kick off the OAuth flow
app.get('/auth/login', (req, res) => {
  const url = new URL('/oauth/authorize', HACKATIME_BASE);
  url.searchParams.set('client_id', HACKATIME_CLIENT_ID);
  url.searchParams.set('redirect_uri', HACKATIME_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'profile read');
  res.redirect(url.toString());
});

// Step 3 + 4: catch the code, trade it for an access token server-side
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('missing ?code from Hackatime');

  try {
    const tokenRes = await fetch(`${HACKATIME_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: HACKATIME_CLIENT_ID,
        client_secret: HACKATIME_CLIENT_SECRET,
        code,
        redirect_uri: HACKATIME_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      console.error('[lookatime] token exchange failed', tokenRes.status, await tokenRes.text());
      return res.status(502).send('could not exchange code for a token');
    }

    const tokenData = await tokenRes.json();
    // access_token is long-lived (~16yr per Hackatime) — fine to keep in session only,
    // swap for a real DB row keyed by your own user id once you have accounts.
    req.session.hackatimeAccessToken = tokenData.access_token;
    res.redirect('/?connected=1');
  } catch (err) {
    console.error('[lookatime] callback error', err);
    res.status(500).send('something broke talking to hackatime');
  }
});

async function fetchHackatimeProjects(token) {
  const projectsRes = await fetch(`${HACKATIME_BASE}/api/v1/authenticated/projects`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!projectsRes.ok) {
    console.error('[lookatime] projects lookup failed', projectsRes.status, await projectsRes.text());
    return null;
  }
  const data = await projectsRes.json();
  return data.projects || [];
}

// List the user's hackatime projects so they can pick which one is this submission —
// hours are per-project, chosen by hand, not auto-summed/keyword-matched. Auto-matching
// let unrelated projects with a similar name count, or missed real ones with a different name.
app.get('/api/hackatime/projects', async (req, res) => {
  const token = req.session.hackatimeAccessToken;
  if (!token) return res.status(401).json({ error: 'not connected' });

  const projects = await fetchHackatimeProjects(token);
  if (projects === null) return res.status(502).json({ error: 'projects lookup failed' });

  const sorted = projects
    .map(function (p) {
      return {
        name: p.name,
        total_seconds: p.total_seconds || 0,
        most_recent_heartbeat: p.most_recent_heartbeat || null,
      };
    })
    .sort(function (a, b) {
      // most recently worked-on first; projects with no heartbeat sort last
      if (!a.most_recent_heartbeat) return 1;
      if (!b.most_recent_heartbeat) return -1;
      return new Date(b.most_recent_heartbeat) - new Date(a.most_recent_heartbeat);
    });

  res.json({
    projects: sorted,
    selected: req.session.hackatimeSelectedProject || null,
  });
});

app.post('/api/hackatime/select-project', express.json(), (req, res) => {
  const token = req.session.hackatimeAccessToken;
  if (!token) return res.status(401).json({ error: 'not connected' });

  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'missing project name' });

  req.session.hackatimeSelectedProject = name;
  res.json({ ok: true, selected: name });
});

// Steps 5-7: look up trust level + hours on whichever single project they picked
app.get('/api/hackatime/status', async (req, res) => {
  const token = req.session.hackatimeAccessToken;
  if (!token) return res.json({ connected: false });

  try {
    const meRes = await fetch(`${HACKATIME_BASE}/api/v1/authenticated/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) {
      console.error('[lookatime] /me lookup failed', meRes.status, await meRes.text());
      return res.status(502).json({ connected: true, error: 'stats lookup failed' });
    }
    const me = await meRes.json();
    const trustLevel = me?.trust_factor?.trust_level;

    // Step 6: red trust level is a hard stop, no exceptions
    if (trustLevel === 'red') {
      return res.json({ connected: true, banned: true, trustLevel, eligible: false });
    }

    const selectedName = req.session.hackatimeSelectedProject;
    if (!selectedName) {
      return res.json({ connected: true, banned: false, trustLevel, needsProjectSelection: true, eligible: false });
    }

    const projects = await fetchHackatimeProjects(token);
    if (projects === null) return res.status(502).json({ connected: true, error: 'stats lookup failed' });

    const selectedProject = projects.find(function (p) { return p.name === selectedName; });
    const hours = (selectedProject ? selectedProject.total_seconds : 0) / 3600;
    const minHours = Number(MIN_HOURS_REQUIRED);
    const eligible = hours >= minHours;

    res.json({
      connected: true,
      banned: false,
      trustLevel,
      selectedProject: selectedName,
      hours: Math.round(hours * 100) / 100,
      minHours,
      eligible,
    });
  } catch (err) {
    console.error('[lookatime] status error', err);
    res.status(500).json({ connected: true, error: 'something broke checking your hours' });
  }
});

// Hack Club Identity: verify who someone actually is before they can submit
app.get('/auth/hackclub/login', (req, res) => {
  const url = new URL('/oauth/authorize', HACKCLUB_AUTH_BASE);
  url.searchParams.set('client_id', HACKCLUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', HACKCLUB_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email name verification_status slack_id');
  res.redirect(url.toString());
});

app.get('/auth/hackclub/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('missing ?code from Hack Club');

  try {
    const tokenRes = await fetch(`${HACKCLUB_AUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: HACKCLUB_CLIENT_ID,
        client_secret: HACKCLUB_CLIENT_SECRET,
        redirect_uri: HACKCLUB_REDIRECT_URI,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      console.error('[lookalike] hackclub token exchange failed', tokenRes.status, await tokenRes.text());
      return res.status(502).send('could not exchange code for a token');
    }

    const tokenData = await tokenRes.json();

    const meRes = await fetch(`${HACKCLUB_AUTH_BASE}/api/v1/me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!meRes.ok) {
      console.error('[lookalike] hackclub /me lookup failed', meRes.status, await meRes.text());
      return res.status(502).send('could not verify your Hack Club identity');
    }

    const me = await meRes.json();
    // TODO: confirm the exact shape/values of verification_status once this has run for real —
    // storing the raw response for now rather than guessing at an eligibility check.
    req.session.hackclubIdentity = me;
    res.redirect('/?identity=1');
  } catch (err) {
    console.error('[lookalike] hackclub callback error', err);
    res.status(500).send('something broke talking to hack club identity');
  }
});

app.get('/api/hackclub/status', (req, res) => {
  const me = req.session.hackclubIdentity;
  if (!me) return res.json({ connected: false });
  res.json({ connected: true, identity: me });
});

// Once identity is verified, hand off to the Airtable form with the fields we can
// safely prefill (name/email only — this app's OAuth scopes don't include a mailing
// address; that still needs Hack Club's Submit/Identity Vault redirect flow).
app.get('/submit', (req, res) => {
  const me = req.session.hackclubIdentity;
  if (!me) return res.redirect('/auth/hackclub/login');
  if (!AIRTABLE_FORM_URL) return res.status(500).send('AIRTABLE_FORM_URL not configured');

  const url = new URL(AIRTABLE_FORM_URL);
  if (me.email) url.searchParams.set('prefill_Email', me.email);
  if (me.name) {
    const [first, ...rest] = String(me.name).split(' ');
    url.searchParams.set('prefill_First Name', first || '');
    if (rest.length) url.searchParams.set('prefill_Last Name', rest.join(' '));
  }
  res.redirect(url.toString());
});

// Vercel imports this file as a serverless function (see api/index.js) rather than
// running it directly, so only call listen() when this is actually run with `node server.js`.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`lookalike running at http://localhost:${PORT}`);
  });
}

module.exports = app;
