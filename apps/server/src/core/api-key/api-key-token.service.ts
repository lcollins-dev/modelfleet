import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Recognisable in a log or by a secret scanner, so a leaked key is identifiable on sight. */
const TOKEN_PREFIX = 'mfk_';

const KEY_ID_BYTES = 12;
const SECRET_BYTES = 32;

/** Hex keeps the identifier clear of the `_` separator, which the base64url secret may contain. */
const KEY_ID_LENGTH = KEY_ID_BYTES * 2;

const SEPARATOR_INDEX = TOKEN_PREFIX.length + KEY_ID_LENGTH;

export interface IIssuedToken {
  keyId: string;
  secretHash: string;

  /** The only readable copy of the credential. */
  token: string;
}

export interface IPresentedToken {
  keyId: string;
  secret: string;
}

@Injectable()
export class ApiKeyTokenService {
  issue(): IIssuedToken {
    const keyId = randomBytes(KEY_ID_BYTES).toString('hex');
    const secret = randomBytes(SECRET_BYTES).toString('base64url');

    return {
      keyId,
      secretHash: this.hash(secret),
      token: `${TOKEN_PREFIX}${keyId}_${secret}`,
    };
  }

  parse(token: string): IPresentedToken | null {
    if (!token.startsWith(TOKEN_PREFIX) || token[SEPARATOR_INDEX] !== '_') {
      return null;
    }

    const keyId = token.slice(TOKEN_PREFIX.length, SEPARATOR_INDEX);
    const secret = token.slice(SEPARATOR_INDEX + 1);

    if (!/^[0-9a-f]+$/.test(keyId) || secret.length === 0) {
      return null;
    }

    return { keyId, secret };
  }

  matches(secret: string, secretHash: string): boolean {
    const presented = Buffer.from(this.hash(secret), 'hex');
    const stored = Buffer.from(secretHash, 'hex');

    if (presented.length !== stored.length) {
      return false;
    }

    return timingSafeEqual(presented, stored);
  }

  hash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }
}
