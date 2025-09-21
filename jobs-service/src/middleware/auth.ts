import { FastifyRequest, FastifyReply } from 'fastify';

export async function requireApiKey(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['jobs_api_key'] as string;
  const expectedKey = process.env.JOBS_API_KEY;

  if (!expectedKey) {
    return; // No API key required if not configured
  }

  if (!apiKey || apiKey !== expectedKey) {
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'Valid JOBS_API_KEY header required',
      code: 'INVALID_API_KEY',
    });
    return;
  }
}