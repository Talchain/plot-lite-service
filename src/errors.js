export function errorResponse(type, message, hint) {
    return { error: { type, message, hint } };
}
