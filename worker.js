const REPO = 'ch1in/26eurosummer-data';
const DATA_PATH = 'data/trip-data.json';
const ITINERARY_PATH = 'data/itinerary.json';
const BRANCH = 'main';

function cors(resp) {
  resp.headers.set('Access-Control-Allow-Origin', '*');
  resp.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  resp.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return resp;
}

function json(obj, status) {
  return cors(new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  }));
}

function checkAuth(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  return token && env.AUTH_HASH && token === env.AUTH_HASH;
}

function ghHeaders(env) {
  return {
    'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'trip-sync-relay'
  };
}

function contentsUrl(path) {
  return 'https://api.github.com/repos/' + REPO + '/contents/' + encodeURI(path) + '?ref=' + BRANCH;
}

function b64EncodeUtf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64DecodeUtf8(str) {
  return decodeURIComponent(escape(atob(str)));
}

async function getFile(env, path) {
  const res = await fetch(contentsUrl(path), { headers: ghHeaders(env) });
  if (res.status === 404) return { content: null, sha: null };
  if (!res.ok) throw new Error('GitHub GET failed: ' + res.status + ' ' + await res.text());
  const data = await res.json();
  return { content: b64DecodeUtf8(data.content.replace(/\n/g, '')), sha: data.sha };
}

async function putFile(env, path, contentStr, sha) {
  const body = {
    message: 'sync from trip app',
    content: b64EncodeUtf8(contentStr),
    branch: BRANCH
  };
  if (sha) body.sha = sha;
  const res = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + encodeURI(path), {
    method: 'PUT',
    headers: ghHeaders(env),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('GitHub PUT failed: ' + res.status + ' ' + await res.text());
  return res.json();
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    if (!checkAuth(request, env)) {
      return json({ error: 'unauthorized' }, 401);
    }

    const url = new URL(request.url);
    const isItinerary = url.pathname.replace(/\/$/, '') === '/itinerary';

    try {
      if (isItinerary) {
        if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
        const { content } = await getFile(env, ITINERARY_PATH);
        if (content === null) return json({}, 404);
        return json(JSON.parse(content));
      }

      if (request.method === 'GET') {
        const { content } = await getFile(env, DATA_PATH);
        if (content === null) return json({});
        return json(JSON.parse(content));
      }

      if (request.method === 'POST') {
        const incoming = await request.json();
        const { sha } = await getFile(env, DATA_PATH);
        await putFile(env, DATA_PATH, JSON.stringify(incoming), sha);
        return json({ ok: true });
      }

      return json({ error: 'method not allowed' }, 405);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  }
};
