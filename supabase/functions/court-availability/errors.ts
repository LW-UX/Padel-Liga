export type AvailabilityFailure = "playtomic_timeout" | "playtomic_unavailable"
  | "playtomic_access_denied" | "playtomic_login_required" | "playtomic_rate_limited"
  | "playtomic_invalid_response";

// Only fixed categories cross the public boundary, never provider bodies or credentials.
export class AvailabilityReadError extends Error {
  readonly reason: AvailabilityFailure;
  constructor(reason: AvailabilityFailure) {
    super(reason);
    this.reason = reason;
    this.name = "AvailabilityReadError";
  }
}

export function playtomicHttpError(status: number, authenticated = false) {
  // A 403 can also be a gateway/device block, even with a valid session.
  if (status === 403) return new AvailabilityReadError("playtomic_access_denied");
  if (status === 401) return new AvailabilityReadError(authenticated
    ? "playtomic_login_required" : "playtomic_access_denied");
  if (status === 429) return new AvailabilityReadError("playtomic_rate_limited");
  if (status === 408 || status === 504) return new AvailabilityReadError("playtomic_timeout");
  if (status >= 500) return new AvailabilityReadError("playtomic_unavailable");
  return new AvailabilityReadError("playtomic_invalid_response");
}
