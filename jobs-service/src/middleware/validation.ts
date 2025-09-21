import { FastifyRequest, FastifyReply } from 'fastify';
import { ZodSchema, ZodError } from 'zod';

export function validateBody<T>(schema: ZodSchema<T>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validatedData = schema.parse(request.body);
      (request as any).validatedBody = validatedData;
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400).send({
          error: 'Validation Error',
          message: 'Invalid request body',
          code: 'VALIDATION_ERROR',
          details: error.errors,
        });
        return;
      }
      throw error;
    }
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validatedData = schema.parse(request.query);
      (request as any).validatedQuery = validatedData;
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400).send({
          error: 'Validation Error',
          message: 'Invalid query parameters',
          code: 'VALIDATION_ERROR',
          details: error.errors,
        });
        return;
      }
      throw error;
    }
  };
}

export function validateParams<T>(schema: ZodSchema<T>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validatedData = schema.parse(request.params);
      (request as any).validatedParams = validatedData;
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400).send({
          error: 'Validation Error',
          message: 'Invalid path parameters',
          code: 'VALIDATION_ERROR',
          details: error.errors,
        });
        return;
      }
      throw error;
    }
  };
}