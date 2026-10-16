/** Reaches an operator as written. A retryable one is fetched again from what is already on disk. */
export class DownloadError extends Error {
  constructor(
    message: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}
