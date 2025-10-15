/**
 * Token-scoped principal extraction (E1)
 * Use bearer token as principal when present, fallback to IP
 */
import { createHash } from 'crypto';

export function extractPrincipal(req: any): string {
  // TOKEN_RL_ENABLE=1 uses token as principal
  if (process.env.TOKEN_RL_ENABLE === '1') {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) {
      const token = auth.slice(7);
      // Hash token for privacy
      return 'token:' + createHash('sha256').update(token).digest('hex').slice(0, 16);
    }
  }
  
  // Fallback to canonicalized IP
  const { canonicalizeRemote } = require('./net.js');
  return 'ip:' + canonicalizeRemote(req.ip || 'unknown');
}
