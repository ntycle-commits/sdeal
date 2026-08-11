import { NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

function getFirebaseAdmin() {
  if (!getApps().length) {
    initializeApp({ credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })});
  }
}

const ANY_URL_RE = /https?:\/\/[^\s​‌‍﻿\)\]\>"']+/gi;
const SHOPEE_RE = /shope\.ee|vn\.shp\.ee|shopee\.vn|s\.shopee\.vn/i;
const VIDEO_RE = /sv\.shopee\.vn|shopee\.vn\/share-video|shopee\.vn\/live/i;
const SANDEAL_CODE_RE = /sandeal\.io\.vn\/([A-Za-z0-9]{10})(?:[^A-Za-z0-9]|$)/;

// Sandeal shortlink không dùng HTTP redirect mà dùng meta refresh + JS
// → đọc Firestore REST trực tiếp để lấy target URL
async function resolveSandealUrl(url) {
  const m = url.match(SANDEAL_CODE_RE);
  if (!m) return null;
  const code = m[1];
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/shortlinks/${code}`;
  try {
    const res = await fetch(docUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.fields?.url?.stringValue || null;
  } catch { return null; }
}

async function resolveUrl(url) {
  if (/sandeal\.io\.vn/i.test(url)) {
    const target = await resolveSandealUrl(url);
    if (target) return target; // target là affiliate URL (s.shopee.vn/an_redir?...)
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, {
      redirect: 'follow', signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36' }
    });
    return r.url;
  } finally { clearTimeout(t); }
}

function cleanUrl(resolved) {
  if (/shopee\.vn\/search/i.test(resolved)) return resolved;
  if (/shopee\.vn\/(collection|mall\/collection|topic)/i.test(resolved)) return resolved;
  let m = resolved.match(/shopee\.vn\/[^?#]+-i\.(\d+)\.(\d+)/);
  if (m) return `https://shopee.vn/product/${m[1]}/${m[2]}`;
  m = resolved.match(/shopee\.vn\/product\/(\d+)\/(\d+)/);
  if (m) return `https://shopee.vn/product/${m[1]}/${m[2]}`;
  m = resolved.match(/shopee\.vn\/[^/]+\/(\d+)\/(\d+)/);
  if (m) return `https://shopee.vn/product/${m[1]}/${m[2]}`;
  try { const u = new URL(resolved); u.search = ''; u.hash = ''; return u.toString(); } catch { return resolved; }
}

export async function POST(request) {
  try {
    getFirebaseAdmin();
    const { text, affiliateId, subId, token } = await request.json();
    if (!token) return NextResponse.json({ error: 'Chưa đăng nhập' }, { status: 401 });
    try { await getAuth().verifyIdToken(token); } catch { return NextResponse.json({ error: 'Token không hợp lệ' }, { status: 401 }); }
    if (!text?.trim()) return NextResponse.json({ error: 'Không có text' }, { status: 400 });
    if (!affiliateId?.trim()) return NextResponse.json({ error: 'Thiếu Affiliate ID' }, { status: 400 });

    const db = getFirestore();
    const base = (process.env.NEXT_PUBLIC_APP_URL || `https://${request.headers.get('host')}`).replace(/\/$/, '');
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    const matches = [...text.matchAll(ANY_URL_RE)].map(m => {
      const original = m[0].replace(/[.,;:!?)\]>"']+$/, '');
      return { original, start: m.index, end: m.index + original.length };
    });
    if (!matches.length) return NextResponse.json({ success: true, result: text, done: 0, total: 0 });

    const settled = await Promise.allSettled(matches.map(async ({ original, start, end }) => {
      let resolved = await resolveUrl(original);
      // Nếu là affiliate URL (s.shopee.vn/an_redir?origin_link=...), extract origin_link
      if (/s\.shopee\.vn\/an_redir/i.test(resolved)) {
        try {
          const originLink = new URL(resolved).searchParams.get('origin_link');
          if (originLink) resolved = decodeURIComponent(originLink);
        } catch {}
      }
      if (!SHOPEE_RE.test(resolved) || VIDEO_RE.test(resolved)) return { start, end, shortUrl: null };
      const clean = cleanUrl(resolved);
      const affUrl = `https://s.shopee.vn/an_redir?origin_link=${encodeURIComponent(clean)}&affiliate_id=${affiliateId.trim()}&sub_id=${(subId||'').trim()}`;
      let code = '';
      for (let i = 0; i < 10; i++) code += chars[Math.floor(Math.random() * chars.length)];
      await db.collection('shortlinks').doc(code).set({ url: affUrl, clicks: 0, createdAt: FieldValue.serverTimestamp() });
      return { start, end, shortUrl: `${base}/${code}` };
    }));

    const results = settled.map((s, i) => ({ ...matches[i], shortUrl: s.status === 'fulfilled' ? s.value?.shortUrl : null }));
    results.sort((a, b) => b.start - a.start);
    let result = text;
    for (const { start, end, shortUrl } of results) {
      if (shortUrl) result = result.slice(0, start) + shortUrl + result.slice(end);
    }
    const done = results.filter(r => r.shortUrl).length;
    return NextResponse.json({ success: true, result, done, total: matches.length });
  } catch (e) {
    console.error('convert error', e);
    return NextResponse.json({ error: 'Lỗi server: ' + e.message }, { status: 500 });
  }
}
