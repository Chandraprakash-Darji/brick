import { Schema } from "effect";

export class BadRequest extends Schema.TaggedError<BadRequest>()(
  "BadRequest",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}
export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}
export class Conflict extends Schema.TaggedError<Conflict>()(
  "Conflict",
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}
export class InternalServerError extends Schema.TaggedError<InternalServerError>()(
  "InternalServerError",
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}
