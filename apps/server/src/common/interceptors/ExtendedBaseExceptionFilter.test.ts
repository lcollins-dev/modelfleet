import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExtendedBaseExceptionFilter } from '@/common/interceptors/ExtendedBaseExceptionFilter';

const host = {} as ArgumentsHost;

describe('ExtendedBaseExceptionFilter', () => {
  let filter: ExtendedBaseExceptionFilter;
  let forwarded: { exception: unknown; host: ArgumentsHost }[];

  beforeEach(() => {
    vi.restoreAllMocks();

    filter = new ExtendedBaseExceptionFilter();
    forwarded = [];

    vi.spyOn(BaseExceptionFilter.prototype, 'catch').mockImplementation(
      (exception: unknown, exceptionHost: ArgumentsHost) => {
        forwarded.push({ exception, host: exceptionHost });
      }
    );
  });

  describe('isExceptionWithType', () => {
    it('recognises an object carrying a string type', () => {
      expect(filter.isExceptionWithType({ type: 'entity.too.large' })).toBe(true);
    });

    it('rejects an object whose type is not a string', () => {
      expect(filter.isExceptionWithType({ type: 42 })).toBe(false);
    });

    it('rejects null and a plain error', () => {
      expect(filter.isExceptionWithType(null)).toBe(false);
      expect(filter.isExceptionWithType(new Error('boom'))).toBe(false);
    });
  });

  describe('catch', () => {
    it('turns an undecodable url param into a bad request', () => {
      filter.catch(new URIError('URI malformed'), host);

      const exception = forwarded[0].exception as BadRequestException;

      expect(exception).toBeInstanceOf(BadRequestException);
      expect(exception.message).toBe('The URL contains an invalid parameter');
    });

    it('turns an oversized body into a bad request', () => {
      filter.catch({ type: 'entity.too.large' }, host);

      const exception = forwarded[0].exception as BadRequestException;

      expect(exception).toBeInstanceOf(BadRequestException);
      expect(exception.message).toBe('Request body is too large');
    });

    it('passes any other http exception straight through', () => {
      const exception = new NotFoundException();

      filter.catch(exception, host);

      expect(forwarded).toEqual([{ exception, host }]);
    });

    it('passes an unrecognised body-parser error straight through', () => {
      const exception = { type: 'entity.parse.failed' };

      filter.catch(exception, host);

      expect(forwarded[0].exception).toBe(exception);
    });
  });
});
