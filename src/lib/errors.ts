export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message } };
  }
}

export function notFound(what: string): ApiError {
  return new ApiError(404, 'not_found', `${what} not found`);
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, 'bad_request', message);
}

export function conflict(message: string): ApiError {
  return new ApiError(409, 'conflict', message);
}
