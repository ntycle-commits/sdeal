// Worker cache cho collection "posts" (Firestore vẫn là nguồn gốc — worker này chỉ giữ
// 1 bản sao chỉ-để-đọc, đồng bộ từ server Next.js mỗi khi có bài được tạo/xoá).
//
// Endpoints:
//   GET  /posts/index    — công khai, trả về toàn bộ danh sách bài (search + load more feed)
//   GET  /posts/:id      — công khai, tra 1 bài theo id (trang chia sẻ /p/[id])
//   POST /posts/upsert   — cần Bearer secret, thêm/cập nhật 1 bài
//   POST /posts/delete   — cần Bearer secret, xoá 1 bài theo id
//   POST /posts/bulk-set — cần Bearer secret, GHI ĐÈ toàn bộ danh sách (dùng cho backfill 1 lần)

const KV_KEY = 'index';
const MAX_POSTS = 2000; // chỉ giữ 2000 bài mới nhất — vừa đủ cho search + load more, không phình to

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      if (request.method === 'GET' && pathname === '/posts/index') {
        const list = await getIndex(env);
        return json(list, cors, { 'Cache-Control': 'public, max-age=60' });
      }

      if (request.method === 'GET' && pathname.startsWith('/posts/')) {
        const id = decodeURIComponent(pathname.slice('/posts/'.length));
        const list = await getIndex(env);
        const post = list.find(p => p.id === id);
        if (!post) return json({ error: 'not_found' }, cors, {}, 404);
        return json(post, cors, { 'Cache-Control': 'public, max-age=300' });
      }

      if (request.method === 'POST' && pathname === '/posts/upsert') {
        const authErr = checkAuth(request, env, cors);
        if (authErr) return authErr;
        const post = await request.json();
        if (!post?.id) return json({ error: 'missing_id' }, cors, {}, 400);
        const list = await getIndex(env);
        const idx = list.findIndex(p => p.id === post.id);
        if (idx >= 0) list[idx] = post; else list.unshift(post);
        const trimmed = list.slice(0, MAX_POSTS);
        await env.POSTS_CACHE.put(KV_KEY, JSON.stringify(trimmed));
        return json({ success: true, count: trimmed.length }, cors);
      }

      if (request.method === 'POST' && pathname === '/posts/delete') {
        const authErr = checkAuth(request, env, cors);
        if (authErr) return authErr;
        const { id } = await request.json();
        if (!id) return json({ error: 'missing_id' }, cors, {}, 400);
        const list = await getIndex(env);
        const filtered = list.filter(p => p.id !== id);
        await env.POSTS_CACHE.put(KV_KEY, JSON.stringify(filtered));
        return json({ success: true, count: filtered.length }, cors);
      }

      if (request.method === 'POST' && pathname === '/posts/bulk-set') {
        const authErr = checkAuth(request, env, cors);
        if (authErr) return authErr;
        const list = await request.json();
        if (!Array.isArray(list)) return json({ error: 'expected_array' }, cors, {}, 400);
        const trimmed = list.slice(0, MAX_POSTS);
        await env.POSTS_CACHE.put(KV_KEY, JSON.stringify(trimmed));
        return json({ success: true, count: trimmed.length }, cors);
      }

      return json({ error: 'not_found' }, cors, {}, 404);
    } catch (err) {
      return json({ error: 'server_error', details: err.message }, cors, {}, 500);
    }
  },
};

async function getIndex(env) {
  const raw = await env.POSTS_CACHE.get(KV_KEY);
  return raw ? JSON.parse(raw) : [];
}

function checkAuth(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (!env.POSTS_SYNC_SECRET || auth !== `Bearer ${env.POSTS_SYNC_SECRET}`) {
    return json({ error: 'unauthorized' }, cors, {}, 401);
  }
  return null;
}

function json(data, cors, extraHeaders, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...extraHeaders },
  });
}
