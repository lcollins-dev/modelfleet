import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ITokenPayload, TokenService } from '@/core/user/token.service';

describe('TokenService', () => {
  let tokenService: TokenService;
  let signAsync: ReturnType<typeof vi.fn>;
  let verifyAsync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    signAsync = vi.fn();
    verifyAsync = vi.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenService,
        {
          provide: JwtService,
          useValue: { signAsync, verifyAsync },
        },
      ],
    }).compile();

    tokenService = moduleRef.get(TokenService);
  });

  describe('createToken', () => {
    it('signs a payload with the session uuid as the subject', async () => {
      signAsync.mockResolvedValue('signed-token');

      const token = await tokenService.createToken('session-uuid-123');

      expect(token).toBe('signed-token');
      expect(signAsync).toHaveBeenCalledWith({ sub: 'session-uuid-123' });
    });
  });

  describe('decodeToken', () => {
    it('returns the decoded payload when the token is valid', async () => {
      const payload: ITokenPayload = { sub: 'session-uuid-123', iat: 1, exp: 2 };
      verifyAsync.mockResolvedValue(payload);

      const result = await tokenService.decodeToken('valid-token');

      expect(result).toEqual(payload);
      expect(verifyAsync).toHaveBeenCalledWith('valid-token');
    });

    it('returns null when verification throws', async () => {
      verifyAsync.mockRejectedValue(new Error('jwt malformed'));

      const result = await tokenService.decodeToken('bad-token');

      expect(result).toBeNull();
    });

    it('returns null on an expired token error', async () => {
      verifyAsync.mockRejectedValue(new Error('jwt expired'));

      const result = await tokenService.decodeToken('expired-token');

      expect(result).toBeNull();
    });
  });
});
