import { AppError, ValidationError } from '../error';

export enum ApiErrorType {
  VALIDATION = 'VALIDATION',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  TIMEOUT = 'TIMEOUT',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  NETWORK = 'NETWORK',
  UNKNOWN = 'UNKNOWN',
}

export class ApiErrorBase {
  private constructor(
    public type: ApiErrorType,
    public message: string
  ) {}

  public static readonly TOO_MANY_REQUESTS = new ApiErrorBase(
    ApiErrorType.TOO_MANY_REQUESTS,
    "You've done that too often in a short time. Wait a moment and try again."
  );

  public static readonly TIMEOUT = new ApiErrorBase(ApiErrorType.TIMEOUT, 'That took too long. Try again in a moment.');

  public static readonly UNAUTHORIZED = new ApiErrorBase(
    ApiErrorType.UNAUTHORIZED,
    'Your session has ended. Sign in again to continue.'
  );

  public static readonly FORBIDDEN = new ApiErrorBase(ApiErrorType.FORBIDDEN, "You don't have access to that.");

  public static readonly NOT_FOUND = new ApiErrorBase(
    ApiErrorType.NOT_FOUND,
    "We couldn't find that. It may have been removed."
  );

  public static readonly NETWORK = new ApiErrorBase(
    ApiErrorType.NETWORK,
    "We couldn't connect. Check your internet connection and try again."
  );

  public static readonly UNKNOWN = new ApiErrorBase(
    ApiErrorType.UNKNOWN,
    "We couldn't finish that. Try again in a moment."
  );
}

export class ApiError extends AppError {
  public type: ApiErrorType;
  public message: string;

  constructor(apiErrorBase: ApiErrorBase, message?: string) {
    const type = apiErrorBase.type;
    const newMessage = message ?? apiErrorBase.message;

    super(`${type}: ${newMessage}`);

    this.type = type;
    this.message = newMessage;
  }
}

export class ApiValidationError extends ValidationError {}
