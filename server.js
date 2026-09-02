require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const path = require('path');

const {
  HACKATIME_CLIENT_ID,
  HACKATIME_CLIENT_SECRET,
  HACKATIME_REDIRECT_URI,
  SESSION_SECRET,
  MIN_HOURS_REQUIRED = 2,
  PORT = 3000,
} = process.env;

const HACKATIME_BASE = 'https://hackatime.hackclub.com';

if (!HACKATIME_CLIENT_ID || !HACKATIME_CLIENT_SECRET || !HACKATIME_REDIRECT_URI) {
  console.warn('[lookatime] Missing HACKATIME_CLIENT_ID / HACKATIME_CLIENT_SECRET / HACKATIME_REDIRECT_URI in .env — auth routes will fail until set.');
}

const app = express();

app.use(session({
  secret: SESSION_SECRET || 'dev-only-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' },
}));

app.use(express.static(path.join(__dirname)));

// Step 2: kick off the OAuth flow
app.get('/auth/login', (req, res) => {
  const url = new URL('/oauth/authorize', HACKATIME_BASE);
  url.searchParams.set('client_id', HACKATIME_CLIENT_ID);
  url.searchParams.set('redirect_uri', HACKATIME_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'profile+read');
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

// Steps 5-7: look up hours + trust level, decide eligibility
app.get('/api/hackatime/status', async (req, res) => {
  const token = req.session.hackatimeAccessToken;
  if (!token) return res.json({ connected: false });

  try {
    const url = new URL('/api/v1/users/my/stats', HACKATIME_BASE);
    // adjust to your program's actual window
    url.searchParams.set('start_date', process.env.PROGRAM_START_DATE || '2026-01-01');
    url.searchParams.set('end_date', process.env.PROGRAM_END_DATE || '2026-12-31');

    const statsRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!statsRes.ok) {
      console.error('[lookatime] stats lookup failed', statsRes.status, await statsRes.text());
      return res.status(502).json({ connected: true, error: 'stats lookup failed' });
    }

    const stats = await statsRes.json();
    const trustLevel = stats?.trust_factor?.trust_level;

    // Step 6: red trust level is a hard stop, no exceptions
    if (trustLevel === 'red') {
      return res.json({ connected: true, banned: true, trustLevel, eligible: false });
    }

    // Step 7: total_seconds already accounts for overlapping projects — don't re-derive it
    const hours = (stats.total_seconds || 0) / 3600;
    const minHours = Number(MIN_HOURS_REQUIRED);
    const eligible = hours >= minHours;

    res.json({
      connected: true,
      banned: false,
      trustLevel,
      hours: Math.round(hours * 100) / 100,
      minHours,
      eligible,
    });
  } catch (err) {
    console.error('[lookatime] status error', err);
    res.status(500).json({ connected: true, error: 'something broke checking your hours' });
  }
});

app.listen(PORT, () => {
  console.log(`lookalike running at http://localhost:${PORT}`);
});
