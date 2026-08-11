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
    const { token, id, content, link } = await req.json();
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

    const postRef = db.doc(`posts/${id}`);
    await postRef.update({ content: content || '', link: link || null });

    // Đồng bộ lại Worker KV bằng đúng bản mới nhất sau khi sửa — cần đọc lại toàn bộ
    // doc (không chỉ 2 field vừa sửa) vì endpoint /posts/upsert của Worker GHI ĐÈ cả
    // object tại đúng id đó, không merge field.
    try {
      if (process.env.POSTS_SYNC_URL && process.env.POSTS_SYNC_SECRET) {
        const snap = await postRef.get();
        const data = snap.data();
        await fetch(`${process.env.POSTS_SYNC_URL}/posts/upsert`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.POSTS_SYNC_SECRET}`,
          },
          body: JSON.stringify({
            id,
            senderName: data.senderName || '',
            senderAvatar: data.senderAvatar || null,
            content: data.content || '',
            images: data.images || [],
            link: data.link || null,
            createdAt: data.createdAt?.seconds != null
              ? { seconds: data.createdAt.seconds }
              : (data.createdAt?._seconds != null ? { seconds: data.createdAt._seconds } : null),
          }),
        });
      }
    } catch (syncErr) {
      console.error('Lỗi đồng bộ Worker KV (sửa bài):', syncErr.message);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Server Error', details: err.message }, { status: 500 });
  }
}
