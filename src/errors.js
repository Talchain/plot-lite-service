export function errorResponse(type, message, hint, fields) {
    return { error: { type, message, hint, fields } };
}
export function errorTypeToStatus(type) {
    switch (type) {
        case 'BAD_INPUT': return 400;
        case 'TIMEOUT': return 504;
        case 'RETRYABLE': return 503;
        case 'RATE_LIMIT': return 429;
        case 'BREAKER_OPEN': return 503;
        case 'INTERNAL':
        default: return 500;
    }
}
// Normalised public error helper — preserves existing { error: {...} } shape
import { toPublicError } from './lib/error-normaliser.js';
export function replyWithAppError(reply, args) {
    try {
        if (process.env.NODE_ENV !== 'production') {
            const req = reply?.request;
            req?.log?.debug?.({ type: args.type, statusCode: args.statusCode, devDetail: args.devDetail }, 'validation detail (dev only)');
        }
    }
    catch { }
    const publicMessage = (() => {
        if (args.message)
            return args.message;
        const pub = toPublicError({ type: args.type, http: args.statusCode, key: args.key, retryable: args.retryable, code: args.code });
        return pub.message;
    })();
    return reply.code(args.statusCode).send(errorResponse(args.type, publicMessage, args.hint, args.fields));
}
