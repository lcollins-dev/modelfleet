import { z } from 'zod';

import { emailAddress, password, PASSWORD_MAX_LENGTH, requestBody, text } from '../../../fields';
import { UserRoleId } from './role';

export const LoginRequestDto = requestBody({
  email: emailAddress(),
  password: text(0, PASSWORD_MAX_LENGTH),
});
export type LoginRequestDto = z.infer<typeof LoginRequestDto>;

export const TokenResponseDto = z.object({
  token: z.string(),
});
export type TokenResponseDto = z.infer<typeof TokenResponseDto>;

export const ProfileResponseDto = z.object({
  name: z.string(),
  email: z.string(),
  userRoleIds: z.array(z.enum(UserRoleId)),

  /** While set, the api answers only the profile and sign-out routes */
  mustChangePassword: z.boolean(),
});
export type ProfileResponseDto = z.infer<typeof ProfileResponseDto>;

export const UpdateProfileRequestDto = requestBody({
  name: text(2, 256),
  email: emailAddress(),
  password: password().optional(),
});
export type UpdateProfileRequestDto = z.infer<typeof UpdateProfileRequestDto>;

export const UpdateProfileResponseDto = z.object({
  /** Set when the update replaced the session, and the caller must swap to this token */
  token: z.string().optional(),
});
export type UpdateProfileResponseDto = z.infer<typeof UpdateProfileResponseDto>;

export * from './role';

export * from './admin';
