export class AppError extends Error {}

export class ValidationError extends AppError {
  constructor(
    public form: string | null,
    public fields: { [path: string]: { name?: string; message: string } | undefined }
  ) {
    super('There were validation errors, please correct them and try again');
  }
}
