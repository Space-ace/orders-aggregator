export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, "not_found", message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, "bad_request", message);
  }
}

export class UpstreamError extends AppError {
  constructor(message: string) {
    super(502, "upstream_error", message);
  }
}
