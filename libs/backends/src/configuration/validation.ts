import { z } from 'zod';

import { BackendDeclaration } from './declaration';
import { configurationSchema } from './document';

export enum ConfigurationIssueReason {
  WRONG_TYPE = 'wrongType',
  NOT_AN_INTEGER = 'notAnInteger',
  BELOW_MINIMUM = 'belowMinimum',
  ABOVE_MAXIMUM = 'aboveMaximum',
  NOT_A_CHOICE = 'notAChoice',
}

export interface IConfigurationIssue {
  field: string;
  reason: ConfigurationIssueReason;
  message: string;
}

export interface IConfigurationValidation {
  valid: boolean;
  issues: readonly IConfigurationIssue[];

  /** Keys the declaration does not model. They are reported rather than rejected, and the document keeps them. */
  unmodelledFields: readonly string[];
}

export function validateConfiguration(
  declaration: BackendDeclaration,
  document: Readonly<Record<string, unknown>>
): IConfigurationValidation {
  const parsed = configurationSchema(declaration).safeParse(document);
  const issues = parsed.success ? [] : parsed.error.issues.map(reportIssue);

  const modelled = new Set(declaration.fields.map(field => field.name));
  const unmodelledFields = Object.keys(document).filter(key => !modelled.has(key));

  return { valid: issues.length === 0, issues, unmodelledFields };
}

function reportIssue(issue: z.core.$ZodIssue): IConfigurationIssue {
  return {
    field: issue.path.length > 0 ? String(issue.path[0]) : '',
    reason: reasonFor(issue),
    message: `${pathLabel(issue.path)} ${issue.message}`,
  };
}

function reasonFor(issue: z.core.$ZodIssue): ConfigurationIssueReason {
  switch (issue.code) {
    case 'invalid_type':
      return issue.expected === 'int' ? ConfigurationIssueReason.NOT_AN_INTEGER : ConfigurationIssueReason.WRONG_TYPE;

    case 'too_small':
      return ConfigurationIssueReason.BELOW_MINIMUM;

    case 'too_big':
      return ConfigurationIssueReason.ABOVE_MAXIMUM;

    case 'invalid_value':
      return ConfigurationIssueReason.NOT_A_CHOICE;

    default:
      return ConfigurationIssueReason.WRONG_TYPE;
  }
}

function pathLabel(path: readonly PropertyKey[]): string {
  return path.map(segment => (typeof segment === 'number' ? `[${segment}]` : String(segment))).join('');
}
