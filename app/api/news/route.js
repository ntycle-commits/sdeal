import { NextResponse } from 'next/server';

async function getFirestore() {
  const { getApps, initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

export async function POST(req) {
  try {
    // Xác thực bot secret
    const authHeader = req.headers.get('authorization');
    if (!process.env.BONUS_SECRET || authHeader !== `Bearer ${process.env.BONUS_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { senderName, senderAvatar, content, images, link } = body;

    if (!content && (!images || images.length === 0)) {
      return NextResponse.json({ error: 'Thiếu nội dung' }, { status: 400 });
    }

    const db = await getFirestore();
    const postRef = db.collection('posts').doc();
    const now = new Date();
    const postData = {
      senderName: senderName || 'Ẩn danh',
      senderAvatar: senderAvatar || null,
      content: content || '',
      images: images || [],
      link: link || null,
      createdAt: now,
    };
    await postRef.set(postData);

    // Đồng bộ sang Worker KV cho search/feed cache — dùng đúng dữ liệu vừa ghi, không
    // đọc lại Firestore nên không tốn thêm reads. Lỗi đồng bộ không ảnh hưởng việc đăng
    // bài (bài đã lên Firestore/feed thành công), chỉ log lại để biết mà kiểm tra sau.
    try {
      if (process.env.POSTS_SYNC_URL && process.env.POSTS_SYNC_SECRET) {
        await fetch(`${process.env.POSTS_SYNC_URL}/posts/upsert`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.POSTS_SYNC_SECRET}`,
          },
          body: JSON.stringify({
            id: postRef.id,
            ...postData,
            createdAt: { seconds: Math.floor(now.getTime() / 1000) },
          }),
        });
      }
    } catch (syncErr) {
      console.error('Lỗi đồng bộ Worker KV:', syncErr.message);
    }

    return NextResponse.json({ success: true, id: postRef.id });
  } catch (err) {
    return NextResponse.json({ error: 'Server Error', details: err.message }, { status: 500 });
  }
}
