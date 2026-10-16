import { BadRequestException, HttpStatus } from '@nestjs/common';
import { kebabCase, upperFirst } from 'lodash';
import { z } from 'zod';

import { ValidationErrorDto, ValidationResponseDto } from '@libs/dto';

export const fieldRefusal = (errors: ValidationErrorDto[]): BadRequestException => {
  const response: ValidationResponseDto = {
    statusCode: HttpStatus.BAD_REQUEST,
    message: errors,
    error: 'Bad Request',
  };

  return new BadRequestException(response);
};

export interface IFieldIssue {
  path: readonly PropertyKey[];
  message: string;
}

export const fieldIssuesOf = (issues: z.core.$ZodIssue[]): IFieldIssue[] =>
  issues.flatMap(issue =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map(key => ({ path: [...issue.path, key], message: issue.message }))
      : [{ path: issue.path, message: issue.message }]
  );

export const toValidationErrors = (issues: IFieldIssue[]): ValidationErrorDto[] => {
  const errors = new Map<string, ValidationErrorDto>();

  for (const issue of issues) {
    const fieldPath = issue.path.filter(segment => typeof segment === 'string');
    const path = fieldPath.join('.');

    if (!errors.has(path)) {
      errors.set(path, { path, name: fieldName(fieldPath.at(-1) ?? ''), message: issue.message });
    }
  }

  return [...errors.values()];
};

const fieldName = (property: string): string =>
  upperFirst(kebabCase(property).replace(/-/g, ' '))
    .replace(' id', '')
    .replace(/^Desc$/, 'Description');
