import { z } from 'zod';

export const ErrorResponseDto = z.object({
  statusCode: z.number(),
  message: z.string(),
  error: z.string().optional(),
});
export type ErrorResponseDto = z.infer<typeof ErrorResponseDto>;

export const ValidationErrorDto = z.object({
  /** Without list positions, so a refusal inside a list lands on the list. */
  path: z.string(),
  name: z.string(),
  message: z.string(),
});
export type ValidationErrorDto = z.infer<typeof ValidationErrorDto>;

export const ValidationResponseDto = z.object({
  statusCode: z.number(),
  message: z.array(ValidationErrorDto),
  error: z.string().optional(),
});
export type ValidationResponseDto = z.infer<typeof ValidationResponseDto>;

export const isErrorResponse = (response: unknown): response is ErrorResponseDto =>
  ErrorResponseDto.safeParse(response).success;

export const isValidationResponse = (response: unknown): response is ValidationResponseDto =>
  ValidationResponseDto.safeParse(response).success;
