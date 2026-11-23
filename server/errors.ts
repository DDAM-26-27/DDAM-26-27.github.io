export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 503,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Thrown inside a transaction to roll it back while returning a preview result. */
export class PreviewRollback<T> extends Error {
  constructor(public result: T) {
    super('preview');
  }
}
