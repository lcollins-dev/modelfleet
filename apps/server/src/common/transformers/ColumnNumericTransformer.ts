export class ColumnNumericTransformer {
  to(value: number | null): number | null {
    return value;
  }

  from(value: string | null): number | null {
    if (value === null) {
      return null;
    }

    return parseFloat(value);
  }
}
