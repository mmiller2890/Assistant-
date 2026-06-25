// Telemetry has been removed in this local-only fork.
// These helpers are kept as no-ops so the rest of the app compiles unchanged.

export const ANALYTICS_EVENTS = {
  APP_STARTED: "app_started",
  GET_LICENSE: "get_license",
} as const;

export const captureEvent = async (
  _eventName: string,
  _properties?: Record<string, any>
): Promise<void> => {
  // no-op
};

export const trackAppStart = async (
  _appVersion: string,
  _instanceId: string
): Promise<void> => {
  // no-op
};