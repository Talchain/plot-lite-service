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
