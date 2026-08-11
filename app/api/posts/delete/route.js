import { NextResponse } from 'next/server';

async function getAdminSdk() {
  const { getApps, initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getAuth } = await import('firebase-admin/auth');
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return { db: getFirestore(), auth: getAuth() };
}

export async function POST(req) {
  try {
    const { token, id } = await req.json();
    if (!id) return NextResponse.json({ error: 'Thiếu id' }, { status: 400 });
    if (!token) return NextResponse.json({ error: 'Chưa đăng nhập' }, { status: 401 });

    const { db, auth } = await getAdminSdk();

    let decoded;
    try { decoded = await auth.verifyIdToken(token); }
    catch { return NextResponse.json({ error: 'Token không hợp lệ' }, { status: 401 }); }

    const userSnap = await db.doc(`users/${decoded.uid}`).get();
    if (userSnap.data()?.role !== 'admin') {
      return NextResponse.json({ error: 'Không có quyền' }, { status: 403 });
    }

    await db.doc(`posts/${id}`).delete();

    try {
      if (process.env.POSTS_SYNC_URL && process.env.POSTS_SYNC_SECRET) {
        await fetch(`${process.env.POSTS_SYNC_URL}/posts/delete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.POSTS_SYNC_SECRET}`,
          },
          body: JSON.stringify({ id }),
        });
      }
    } catch (syncErr) {
      console.error('Lỗi đồng bộ Worker KV (xoá bài):', syncErr.message);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Server Error', details: err.message }, { status: 500 });
  }
}
