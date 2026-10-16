import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

import { fieldIssuesOf, fieldRefusal, toValidationErrors } from '../validation-errors';

@Injectable()
export class ZodPipe<Schema extends z.ZodType> implements PipeTransform<unknown, z.output<Schema>> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown, metadata: ArgumentMetadata): z.output<Schema> {
    const result = this.schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    const errors = toValidationErrors(fieldIssuesOf(result.error.issues));
    const fieldErrors = errors.filter(error => error.path !== '');

    // A named param or query value, or a body that is not an object, has no form field to land on.
    if (metadata.data !== undefined || fieldErrors.length < errors.length) {
      throw new BadRequestException(errors[0].message);
    }

    throw fieldRefusal(fieldErrors);
  }
}
