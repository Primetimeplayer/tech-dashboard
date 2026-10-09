import { googleNewsUrl, normalizeLanguage, normalizeRegion } from "../scripts/lib/news-locale.js";
import { parseGoogleNewsXml } from "../scripts/lib/parse-google-news.js";

const SESSION_DAYS = 30;
const OAUTH_STATE_MINUTES = 10;

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
      "Access-Control-Allow-Credentials": "true",
    },
  });
}

function redirect(url) {
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  });
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(
    new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}=([^;]*)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  parts.push("Path=/");

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  return parts.join("; ");
}

function randomString(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);

  return Array.from(data, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function sha256(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );

  const bytes = new Uint8Array(digest);

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");

  if (origin && origin === env.ALLOWED_ORIGIN) {
    return origin;
  }

  return "";
}

function corsHeaders(request, env) {
  const origin = allowedOrigin(request, env);

  if (!origin) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    Vary: "Origin",
  };
}

function getBearerToken(request) {
  const header = request.headers.get("Authorization") || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();

  return token || null;
}

function getSessionToken(request) {
  return getBearerToken(request) || getCookie(request, "signal_session");
}

async function requireUser(request, env) {
  const sessionToken = getSessionToken(request);

  if (!sessionToken) {
    return null;
  }

  const sessionHash = await sha256(sessionToken);

  const row = await env.SIGNAL_DB.prepare(`
    SELECT
      sessions.user_id,
      sessions.expires_at,
      users.email,
      users.provider,
      users.provider_subject
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.id_hash = ?
      AND datetime(sessions.expires_at) > datetime('now')
  `)
    .bind(sessionHash)
    .first();

  return row || null;
}

async function handleGoogleLogin(request, env) {
  if (!env.GOOGLE_CLIENT_ID) {
    return new Response("Google OAuth is not configured.", {
      status: 500,
    });
  }

  const state = randomString(32);
  const verifier = randomString(32);
  const challenge = await pkceChallenge(verifier);

  const oauthState = `${state}.${verifier}`;

  const cookie = serializeCookie("signal_oauth", oauthState, {
    maxAge: OAUTH_STATE_MINUTES * 60,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });

  const redirectUri =
    "https://signal-sync.primetimeplayer-signal-sync.workers.dev/auth/callback";

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "online",
    prompt: "select_account",
  });

  const response = redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  );

  response.headers.append("Set-Cookie", cookie);

  return response;
}

async function handleGoogleCallback(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new Response("Google OAuth is not configured.", {
      status: 500,
    });
  }

  const url = new URL(request.url);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return new Response("Missing OAuth parameters.", {
      status: 400,
    });
  }

  const stored = getCookie(request, "signal_oauth");

  if (!stored) {
    return new Response("OAuth session expired. Please try again.", {
      status: 400,
    });
  }

  const separator = stored.indexOf(".");

  if (separator === -1) {
    return new Response("Invalid OAuth state.", {
      status: 400,
    });
  }

  const storedState = stored.slice(0, separator);
  const verifier = stored.slice(separator + 1);

  if (storedState !== state) {
    return new Response("Invalid OAuth state.", {
      status: 400,
    });
  }

  const redirectUri =
    "https://signal-sync.primetimeplayer-signal-sync.workers.dev/auth/callback";

  const tokenResponse = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    }
  );

  if (!tokenResponse.ok) {
    return new Response("Google token exchange failed.", {
      status: 502,
    });
  }

  const tokens = await tokenResponse.json();

  if (!tokens.access_token) {
    return new Response("Google did not return an access token.", {
      status: 502,
    });
  }

  const userinfoResponse = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    }
  );

  if (!userinfoResponse.ok) {
    return new Response("Could not retrieve Google account information.", {
      status: 502,
    });
  }

  const profile = await userinfoResponse.json();

  if (!profile.sub || !profile.email) {
    return new Response("Google account information is incomplete.", {
      status: 502,
    });
  }

  const provider = "google";
  const providerSubject = profile.sub;
  const email = profile.email;

  let user = await env.SIGNAL_DB.prepare(`
    SELECT id, email
    FROM users
    WHERE provider = ?
      AND provider_subject = ?
  `)
    .bind(provider, providerSubject)
    .first();

  if (!user) {
    const existingEmail = await env.SIGNAL_DB.prepare(`
      SELECT id
      FROM users
      WHERE email = ?
    `)
      .bind(email)
      .first();

    if (existingEmail) {
      await env.SIGNAL_DB.prepare(`
        UPDATE users
        SET provider = ?, provider_subject = ?
        WHERE id = ?
      `)
        .bind(provider, providerSubject, existingEmail.id)
        .run();

      user = {
        id: existingEmail.id,
        email,
      };
    } else {
      const userId = crypto.randomUUID();

      await env.SIGNAL_DB.prepare(`
        INSERT INTO users (
          id,
          email,
          provider,
          provider_subject
        )
        VALUES (?, ?, ?, ?)
      `)
        .bind(userId, email, provider, providerSubject)
        .run();

      user = {
        id: userId,
        email,
      };
    }
  }

  const authCode = randomString(32);
  const authCodeHash = await sha256(authCode);

  const authCodeExpiresAt = new Date(
    Date.now() + 2 * 60 * 1000
  ).toISOString();

  await env.SIGNAL_DB.prepare(`
    INSERT INTO auth_codes (
      code_hash,
      user_id,
      expires_at
    )
    VALUES (?, ?, ?)
  `)
    .bind(authCodeHash, user.id, authCodeExpiresAt)
    .run();

  const clearOAuthCookie = serializeCookie(
    "signal_oauth",
    "",
    {
      maxAge: 0,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    }
  );

  const response = redirect(
    `${env.ALLOWED_ORIGIN}/tech-dashboard/?auth_code=${encodeURIComponent(authCode)}`
  );

  response.headers.append("Set-Cookie", clearOAuthCookie);

  return response;
}

async function handleAuthExchange(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      { error: "Invalid JSON" },
      400,
      allowedOrigin(request, env)
    );
  }

  const code =
    typeof body.code === "string"
      ? body.code.trim()
      : "";

  if (!code) {
    return json(
      { error: "code is required" },
      400,
      allowedOrigin(request, env)
    );
  }

  const codeHash = await sha256(code);

  const row = await env.SIGNAL_DB.prepare(`
    SELECT
      auth_codes.user_id,
      users.email
    FROM auth_codes
    JOIN users ON users.id = auth_codes.user_id
    WHERE auth_codes.code_hash = ?
      AND datetime(auth_codes.expires_at) > datetime('now')
  `)
    .bind(codeHash)
    .first();

  if (!row) {
    return json(
      { error: "Invalid or expired auth code" },
      401,
      allowedOrigin(request, env)
    );
  }

  // One-time use: consume the auth code before issuing the session.
  await env.SIGNAL_DB.prepare(`
    DELETE FROM auth_codes
    WHERE code_hash = ?
  `)
    .bind(codeHash)
    .run();

  const sessionToken = randomString(32);
  const sessionHash = await sha256(sessionToken);

  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  await env.SIGNAL_DB.prepare(`
    INSERT INTO sessions (
      id_hash,
      user_id,
      expires_at
    )
    VALUES (?, ?, ?)
  `)
    .bind(sessionHash, row.user_id, expiresAt)
    .run();

  return json(
    {
      authenticated: true,
      token: sessionToken,
      user: {
        id: row.user_id,
        email: row.email,
      },
    },
    200,
    allowedOrigin(request, env)
  );
}

async function handleLogout(request, env) {
  const sessionToken = getSessionToken(request);

  if (sessionToken) {
    const sessionHash = await sha256(sessionToken);

    await env.SIGNAL_DB.prepare(`
      DELETE FROM sessions
      WHERE id_hash = ?
    `)
      .bind(sessionHash)
      .run();
  }

  const cookie = serializeCookie("signal_session", "", {
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });

  if (request.method === "POST") {
    const response = json(
      { authenticated: false },
      200,
      allowedOrigin(request, env)
    );
    response.headers.append("Set-Cookie", cookie);
    return response;
  }

  const response = redirect(`${env.ALLOWED_ORIGIN}/tech-dashboard/`);
  response.headers.append("Set-Cookie", cookie);

  return response;
}

async function handleMe(request, env) {
  const user = await requireUser(request, env);

  if (!user) {
    return json(
      { authenticated: false },
      401,
      allowedOrigin(request, env)
    );
  }

  return json(
    {
      authenticated: true,
      user: {
        id: user.user_id,
        email: user.email,
      },
    },
    200,
    allowedOrigin(request, env)
  );
}

async function handleSaved(request, env) {
  const user = await requireUser(request, env);

  if (!user) {
    return json(
      { error: "Not authenticated" },
      401,
      allowedOrigin(request, env)
    );
  }

  const cors = corsHeaders(request, env);

  if (request.method === "GET") {
    const result = await env.SIGNAL_DB.prepare(`
      SELECT
        story_url AS url,
        title,
        note,
        saved_at AS savedAt
      FROM saved_items
      WHERE user_id = ?
      ORDER BY saved_at DESC
    `)
      .bind(user.user_id)
      .all();

    return new Response(
      JSON.stringify({
        saved: result.results || [],
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...cors,
        },
      }
    );
  }

  if (request.method === "PUT") {
    const body = await request.json();

    if (!body.url || typeof body.url !== "string") {
      return json(
        { error: "url is required" },
        400,
        allowedOrigin(request, env)
      );
    }

    const title =
      typeof body.title === "string"
        ? body.title
        : "";

    const note =
      typeof body.note === "string"
        ? body.note
        : "";

    const savedAt =
      typeof body.savedAt === "string"
        ? body.savedAt
        : new Date().toISOString();

    await env.SIGNAL_DB.prepare(`
      INSERT INTO saved_items (
        user_id,
        story_url,
        title,
        note,
        saved_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, story_url)
      DO UPDATE SET
        title = excluded.title,
        note = excluded.note,
        saved_at = excluded.saved_at
    `)
      .bind(
        user.user_id,
        body.url,
        title,
        note,
        savedAt
      )
      .run();

    return json(
      { ok: true },
      200,
      allowedOrigin(request, env)
    );
  }

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const storyUrl = url.searchParams.get("url");

    if (!storyUrl) {
      return json(
        { error: "url is required" },
        400,
        allowedOrigin(request, env)
      );
    }

    await env.SIGNAL_DB.prepare(`
      DELETE FROM saved_items
      WHERE user_id = ?
        AND story_url = ?
    `)
      .bind(user.user_id, storyUrl)
      .run();

    return json(
      { ok: true },
      200,
      allowedOrigin(request, env)
    );
  }

  return json(
    { error: "Method not allowed" },
    405,
    allowedOrigin(request, env)
  );
}

function newsCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store",
  };
}

async function handleNewsFeed(request) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: newsCorsHeaders(),
    });
  }

  const url = new URL(request.url);
  const region = normalizeRegion(url.searchParams.get("region"));
  const language = normalizeLanguage(url.searchParams.get("language"));
  const feedUrl = googleNewsUrl(region, language);

  try {
    let response = null;
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(feedUrl, {
        redirect: "follow",
        headers: {
          "User-Agent": "signal-personal-dashboard/1.0 (+https://github.com/Primetimeplayer/tech-dashboard)",
          Accept: "application/rss+xml, application/xml, text/xml",
        },
      });
      if (response.ok) break;
      lastStatus = response.status;
      await response.text();
      response = null;
      if (lastStatus !== 502 && lastStatus !== 503) break;
    }
    if (!response || !response.ok) {
      throw new Error(`Google News ${lastStatus || "failed"}`);
    }
    const items = parseGoogleNewsXml(await response.text());
    if (!items.length) {
      throw new Error("Google News returned no items");
    }
    return new Response(JSON.stringify({
      updated: new Date().toISOString(),
      count: items.length,
      region,
      language,
      feedUrl,
      items,
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...newsCorsHeaders(),
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, feedUrl, region, language }), {
      status: 502,
      headers: {
        "Content-Type": "application/json",
        ...newsCorsHeaders(),
      },
    });
  }
}

async function handleLegacySaved(request, env) {
  const token = request.headers.get("X-Sync-Token");

  if (!token || token !== env.SYNC_TOKEN) {
    return new Response("Unauthorized", {
      status: 401,
    });
  }

  const key = "saved-items";

  if (request.method === "GET") {
    const value = await env.SAVED_KV.get(key);

    return new Response(value || "{}", {
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  if (request.method === "POST") {
    const body = await request.text();

    await env.SAVED_KV.put(key, body);

    return new Response(
      JSON.stringify({ ok: true }),
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  return new Response("Method not allowed", {
    status: 405,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname === "/api/news") {
      return new Response(null, { headers: newsCorsHeaders() });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders(request, env),
      });
    }

    if (url.pathname === "/api/news") {
      return handleNewsFeed(request);
    }

    if (url.pathname === "/auth/google") {
      return handleGoogleLogin(request, env);
    }

    if (url.pathname === "/auth/callback") {
      return handleGoogleCallback(request, env);
    }

    if (url.pathname === "/auth/exchange" && request.method === "POST") {
      return handleAuthExchange(request, env);
    }

    if (url.pathname === "/auth/logout") {
      return handleLogout(request, env);
    }

    if (url.pathname === "/api/me") {
      return handleMe(request, env);
    }

    if (url.pathname === "/api/saved") {
      return handleSaved(request, env);
    }

    if (url.pathname === "/saved") {
      return handleLegacySaved(request, env);
    }

    return new Response("Signal Sync Worker", {
      status: 200,
    });
  },
};
