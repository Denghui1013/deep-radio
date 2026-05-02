class AppError extends Error {
  constructor(code, message, status = 500, detail) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function toAppError(err, fallbackCode = "INTERNAL_ERROR", fallbackStatus = 500) {
  if (err instanceof AppError) {
    return err;
  }
  return new AppError(
    fallbackCode,
    err && err.message ? err.message : "Unexpected server error",
    fallbackStatus
  );
}

module.exports = {
  AppError,
  toAppError,
};
