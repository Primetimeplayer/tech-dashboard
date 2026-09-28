// cloudflare-worker/worker.js
// A minimal sync backend for Signal's "Saved items" feature. Free to run on
// Cloudflare's free tier. Entirely optional -- the dashboard works fine
// without this, using browser-local storage instead.
//
// GET  /saved   -> returns the saved-items JSON blob
// POST /saved   -> overwrites it with the request body (the dashboard sends
//                  its full local saved-items map on every change)
//
// Protected by a single shared secret token (X-Sync-Token header) rather
// than real auth, since this is meant for one person's own devices, not a
// multi-user service. Don't reuse this pattern for anything with real users.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    if (url.pathname !== '/saved') {
      return new Response('Not found', { status: 404, headers: cors });
    }

    const token = request.headers.get('X-Sync-Token');
    if (!env.SYNC_TOKEN || token !== env.SYNC_TOKEN) {
      return new Response('Unauthorized', { status: 401, headers: cors });
    }

    if (request.method === 'GET') {
      const data = await env.SAVED_KV.get('saved-items');
      return new Response(data || '{}', {
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    if (request.method === 'POST') {
      const body = await request.text();
      try {
        JSON.parse(body); // reject anything that isn't valid JSON before storing it
      } catch {
        return new Response('Invalid JSON', { status: 400, headers: cors });
      }
      await env.SAVED_KV.put('saved-items', body);
      return new Response('OK', { headers: cors });
    }

    return new Response('Method not allowed', { status: 405, headers: cors });
  },
};
