import { BackendDeclaration } from './declaration';

export interface IDeclarationIssue {
  path: (string | number)[];

  message: string;
}

export function declarationIssues(declaration: BackendDeclaration): IDeclarationIssue[] {
  const listed = new Set(declaration.groups.map(entry => entry.group));
  const seen = new Set<string>();
  const issues: IDeclarationIssue[] = [];

  declaration.fields.forEach((field, index) => {
    if (seen.has(field.name)) {
      issues.push({ path: ['fields', index, 'name'], message: `${field.name} is declared twice` });
    }

    if (!listed.has(field.group)) {
      issues.push({ path: ['fields', index, 'group'], message: `${field.group} is not a listed group` });
    }

    seen.add(field.name);
  });

  return issues;
}
