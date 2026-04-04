export interface ApiError {
  code: string;
  message: string;
  statusCode: number;
}

export interface ContentValidationError {
  field: string;
  message: string;
  path: string;
}
