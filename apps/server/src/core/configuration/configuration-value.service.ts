import { Injectable } from '@nestjs/common';

import { ConfigurationValue, IConfigurationObject } from '@libs/dto';

/** A key the document does not hold. `null` canonicalises to `"null"`, so the two never collide. */
const ABSENT = 'absent';

@Injectable()
export class ConfigurationValueService {
  /**
   * Two values give the same string exactly when they are structurally equal. Nested keys are ordered, so a
   * value read back from `jsonb` matches the one just parsed from YAML.
   */
  canonical(value: ConfigurationValue | undefined): string {
    if (value === undefined) {
      return ABSENT;
    }

    if (Array.isArray(value)) {
      return `[${value.map(entry => this.canonical(entry)).join(',')}]`;
    }

    if (this.isObject(value)) {
      const keys = Object.keys(value).sort();

      return `{${keys.map(key => `${JSON.stringify(key)}:${this.canonical(value[key])}`).join(',')}}`;
    }

    return JSON.stringify(value);
  }

  isEqual(left: ConfigurationValue | undefined, right: ConfigurationValue | undefined): boolean {
    return this.canonical(left) === this.canonical(right);
  }

  private isObject(value: ConfigurationValue): value is IConfigurationObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
