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
    const { senderZaloId, username_zalo, code, fbId } = body;

    if (!code || (!senderZaloId && !fbId)) {
      return NextResponse.json({ error: 'Thiếu thông tin' }, { status: 400 });
    }

    const source = fbId ? 'facebook' : 'zalo';

    const db = await getFirestore();
    const codeStr = code.trim().toUpperCase();

    // Tìm bonusCode
    const snap = await db.collection('bonusCodes').doc(codeStr).get();
    if (!snap.exists) {
      return NextResponse.json({ success: false, message: 'Mã không tồn tại.' });
    }

    const data = snap.data();

    // Kiểm tra trạng thái
    if (data.status === 'active') {
      return NextResponse.json({ success: false, message: 'Mã đã được kích hoạt rồi.' });
    }
    if (data.status === 'used') {
      return NextResponse.json({ success: false, message: 'Mã đã được sử dụng rồi.' });
    }
    if (data.status === 'expired') {
      return NextResponse.json({ success: false, message: 'Mã đã hết hạn.' });
    }
    if (data.status !== 'pending') {
      return NextResponse.json({ success: false, message: 'Mã không hợp lệ.' });
    }

    // Ghi lại senderZaloId để biết ai đã kích hoạt (không dùng để verify)
    // Không check zaloId vì Zalo App ID và OA ID có thể khác nhau cho cùng 1 user

    // Kích hoạt: expireAt = now + 30 ngày
    const now = new Date();
    const expireAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const updateBonus = {
      status: 'active',
      activatedAt: now,
      expireAt: expireAt,
      activatedSource: source,
    };
    if (source === 'zalo') updateBonus.activatedByZaloId = senderZaloId;
    if (source === 'facebook') updateBonus.activatedByFbId = fbId;

    await snap.ref.update(updateBonus);

    // Gán thông tin định danh vào user document
    if (data.userId) {
      try {
        const userRef = db.collection('users').doc(data.userId);
        const updateData = {};
        if (source === 'zalo') {
          if (senderZaloId) updateData.senderZaloId = senderZaloId;
          if (username_zalo) updateData.zaloUsername = username_zalo;
        }
        if (source === 'facebook') {
          updateData.fbId = fbId;
        }
        if (Object.keys(updateData).length) await userRef.set(updateData, { merge: true });
      } catch (_) {
        // Lỗi cập nhật info không ảnh hưởng đến việc kích hoạt
      }
    }

    return NextResponse.json({
      success: true,
      message: `✅ Kích hoạt thành công! Bonus +${data.bonusPercent}% cho lần rút đầu tiên. Hết hạn: ${expireAt.toLocaleDateString('vi-VN')}`,
      bonusPercent: data.bonusPercent,
      expireAt: expireAt.toISOString(),
    });

  } catch (err) {
    return NextResponse.json({ error: 'Server Error', details: err.message }, { status: 500 });
  }
}
