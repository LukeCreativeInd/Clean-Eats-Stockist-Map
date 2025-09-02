import crypto from 'crypto';

export function verifyShopifyHmac(rawBody: Buffer, hmacHeader: string | string[] | undefined, secret: string) {
  if (!hmacHeader || Array.isArray(hmacHeader)) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(digest));
  } catch {
    return false;
  }
}
