import { BadRequestException } from '@nestjs/common';

import { ValidationErrorDto, ValidationResponseDto } from '@libs/dto';

/** Throws where the call is not refused, so a passing call cannot read as no issues. */
export const issuesFrom = async (run: () => unknown): Promise<ValidationErrorDto[]> => {
  try {
    await run();
  } catch (error) {
    return readIssues(error);
  }

  throw new Error('issuesFrom(): The call was expected to be refused, and was not');
};

export const issuePathsFrom = async (run: () => unknown): Promise<string[]> =>
  (await issuesFrom(run)).map(issue => issue.path);

const readIssues = (error: unknown): ValidationErrorDto[] => {
  if (!(error instanceof BadRequestException)) {
    throw error;
  }

  const body = ValidationResponseDto.safeParse(error.getResponse());

  if (!body.success) {
    throw error;
  }

  return body.data.message;
};
