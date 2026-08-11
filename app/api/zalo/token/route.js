import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    // Dynamic import to prevent module evaluation crashes at the top level
    const { getApps, initializeApp, cert } = await import('firebase-admin/app');
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

    const body = await req.json();

    // PHASE 1: Exchange code for access_token (works on Vercel US IP)
    if (body.code) {
      const tokenResponse = await fetch('https://oauth.zaloapp.com/v4/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          secret_key: process.env.ZALO_APP_SECRET || process.env.ZALO_SECRET_KEY,
        },
        body: new URLSearchParams({
          app_id: process.env.NEXT_PUBLIC_ZALO_APP_ID || process.env.ZALO_APP_ID,
          grant_type: 'authorization_code',
          code: body.code,
          code_verifier: body.codeVerifier || '',
        }),
      });

      const tokenData = await tokenResponse.json();
      if (tokenData.error) {
        return NextResponse.json({ error: tokenData.error_name || 'Token error' }, { status: 400 });
      }
      return NextResponse.json({ zaloAccessToken: tokenData.access_token });
    }

    // PHASE 2: Mint Custom Token using the Client-provided zaloId
    if (body.zaloId && body.zaloAccessToken) {
      const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
      const db = getFirestore();

      // Kiểm tra zaloId đã được link vào tài khoản email nào chưa
      const linked = await db.collection('users')
        .where('zaloId', '==', body.zaloId)
        .limit(1)
        .get();

      // Nếu đã link → dùng UID của tài khoản đó (không tạo user mới)
      const uid = !linked.empty ? linked.docs[0].id : `zalo:${body.zaloId}`;

      const customToken = await getAuth().createCustomToken(uid, {
        zaloId: body.zaloId,
      });

      // Tạo bonus code nếu chưa có (dùng Admin SDK, bypass Security Rules)
      try {
        const existingBonus = await db.collection('bonusCodes')
          .where('userId', '==', uid)
          .limit(1)
          .get();

        if (existingBonus.empty) {
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          let code = 'SD-';
          for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];

          const activateDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await db.collection('bonusCodes').doc(code).set({
            code,
            userId: uid,
            zaloId: body.zaloId,
            status: 'pending',
            bonusPercent: 10,
            createdAt: FieldValue.serverTimestamp(),
            activateDeadline,
            activatedAt: null,
            expireAt: null,
            usedAt: null,
            usedOnRequestId: null,
            bonusAmount: null,
          });
        }
      } catch (bonusErr) {
        console.error('Bonus code creation error:', bonusErr.message);
      }

      return NextResponse.json({ customToken });
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Server Error', details: error.message }, { status: 500 });
  }
}
