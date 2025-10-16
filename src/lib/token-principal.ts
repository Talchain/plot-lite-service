/**
 * Token principal extraction with HMAC (F2)
 */
import { createHmac } from 'crypto';
import { canonicalizeRemote } from './net.js';

export function extractPrincipal(req: any): string {
  if (process.env.TOKEN_RL_ENABLE === '1') {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) {
      const token = auth.slice(7);
      const secret = process.env.TOKEN_HMAC_SECRET || 'default-insecure-secret';
      const h = createHmac('sha256', secret).update(token).digest('hex');
      return 'token:' + h;
    }
  }
  
  return 'ip:' + canonicalizeRemote(req.ip || 'unknown');
}
