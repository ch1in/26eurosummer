const REPO = 'ch1in/26eurosummer-data';
const DATA_PATH = 'data/trip-data.json';
const ITINERARY_PATH = 'data/itinerary.json';
const PHOTOS_PREFIX = 'photos/';
const BRANCH = 'main';

function cors(resp) {
  resp.headers.set('Access-Control-Allow-Origin', '*');
  resp.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  resp.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  return resp;
}

function json(obj, status) {
  return cors(new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  }));
}

// GET requests from an <img src> tag can't carry an Authorization header,
// so photo reads also accept the token as a ?t= query param. Everything
// else (data sync, itinerary, photo upload/delete) uses the header.
function checkAuth(request, env, url) {
  const auth = request.headers.get('Authorization') || '';
  const headerToken = auth.replace(/^Bearer\s+/i, '');
  if (headerToken && env.AUTH_HASH && headerToken === env.AUTH_HASH) return true;
  const queryToken = url.searchParams.get('t') || '';
  return !!(queryToken && env.AUTH_HASH && queryToken === env.AUTH_HASH);
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
function b64ToBytes(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getFileOnce(env, path) {
  const res = await fetch(contentsUrl(path), { headers: ghHeaders(env) });
  if (res.status === 404) return { contentB64: null, sha: null };
  const bodyText = await res.text();
  if (!res.ok) throw new Error('GitHub GET failed: ' + res.status + ' ' + bodyText);
  let data;
  try { data = JSON.parse(bodyText); }
  catch (e) { throw new Error('GitHub GET returned non-JSON body (status ' + res.status + ', len ' + bodyText.length + '): ' + bodyText.slice(0, 200)); }
  if (!data || typeof data.content !== 'string') {
    throw new Error('GitHub GET missing content field (status ' + res.status + '): ' + bodyText.slice(0, 200));
  }
  return { contentB64: data.content.replace(/\n/g, ''), sha: data.sha };
}
// GitHub's API occasionally hiccups with a transient 5xx or a truncated
// body (we've seen both) — one retry after a short pause clears it.
async function getFileRaw(env, path) {
  try {
    return await getFileOnce(env, path);
  } catch (e) {
    await new Promise(r => setTimeout(r, 500));
    return await getFileOnce(env, path);
  }
}
async function getFile(env, path) {
  const { contentB64, sha } = await getFileRaw(env, path);
  if (contentB64 === null || contentB64 === undefined) return { content: null, sha: null };
  return { content: b64DecodeUtf8(contentB64), sha };
}

async function putFileB64(env, path, contentB64, sha) {
  const body = {
    message: 'sync from trip app',
    content: contentB64,
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
async function putFile(env, path, contentStr, sha) {
  return putFileB64(env, path, b64EncodeUtf8(contentStr), sha);
}
async function deleteFile(env, path, sha) {
  const res = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + encodeURI(path), {
    method: 'DELETE',
    headers: ghHeaders(env),
    body: JSON.stringify({ message: 'delete photo from trip app', sha, branch: BRANCH })
  });
  if (!res.ok) throw new Error('GitHub DELETE failed: ' + res.status + ' ' + await res.text());
  return res.json();
}

function safePhotoId(id) {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);

    if (!checkAuth(request, env, url)) {
      return json({ error: 'unauthorized' }, 401);
    }

    const path = url.pathname.replace(/\/$/, '');
    const photoMatch = path.match(/^\/photo\/([A-Za-z0-9_-]+)$/);

    try {
      if (path === '/itinerary') {
        if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
        const { content } = await getFile(env, ITINERARY_PATH);
        if (content === null) return json({}, 404);
        return json(JSON.parse(content));
      }

      if (path === '/photo' && request.method === 'POST') {
        const body = await request.json();
        if (!body || !body.id || !safePhotoId(body.id) || !body.dataBase64) {
          return json({ error: 'missing or invalid id/dataBase64' }, 400);
        }
        await putFileB64(env, PHOTOS_PREFIX + body.id + '.jpg', body.dataBase64, null);
        return json({ ok: true });
      }

      if (photoMatch && request.method === 'GET') {
        const { contentB64 } = await getFileRaw(env, PHOTOS_PREFIX + photoMatch[1] + '.jpg');
        if (contentB64 === null) return cors(new Response('not found', { status: 404 }));
        const bytes = b64ToBytes(contentB64);
        return cors(new Response(bytes, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }
        }));
      }

      if (photoMatch && request.method === 'DELETE') {
        const filePath = PHOTOS_PREFIX + photoMatch[1] + '.jpg';
        const { sha } = await getFileRaw(env, filePath);
        if (sha) await deleteFile(env, filePath, sha);
        return json({ ok: true });
      }

      if (path === '' || path === '/') {
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
      }

      return json({ error: 'method not allowed' }, 405);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  }
};
