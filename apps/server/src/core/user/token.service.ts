import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface ITokenPayload {
  /** Subject (User uuid) */
  sub: string;

  exp?: number;
  iat?: number;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(private readonly jwtService: JwtService) {}

  createToken(sessionUuid: string): Promise<string> {
    const payload: ITokenPayload = { sub: sessionUuid };
    return this.jwtService.signAsync(payload);
  }

  async decodeToken(token: string): Promise<ITokenPayload | null> {
    try {
      const tokenPayload = await this.jwtService.verifyAsync<ITokenPayload>(token);
      return tokenPayload;
    } catch (error) {
      this.logger.log({ error }, 'decodeToken(): Failed to decode token');
    }

    return null;
  }
}
