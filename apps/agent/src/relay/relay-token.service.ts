import { Injectable } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;

@Injectable()
export class RelayTokenService {
  private token: Buffer | null = null;

  /** Replaces whatever the last handshake minted, so only the live session's token opens the relay. */
  mint(): string {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');

    this.token = Buffer.from(token, 'utf8');

    return token;
  }

  clear(): void {
    this.token = null;
  }

  /** False until a handshake has minted one, so nothing relays before the server is connected. */
  accepts(presented: string): boolean {
    const token = this.token;

    if (token === null) {
      return false;
    }

    const offered = Buffer.from(presented, 'utf8');

    if (offered.length !== token.length) {
      return false;
    }

    return timingSafeEqual(offered, token);
  }
}
