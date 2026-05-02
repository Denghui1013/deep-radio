export const RADIO_STATES = Object.freeze([
  "idle",
  "connecting",
  "selecting",
  "intro",
  "playing",
  "paused",
  "error"
]);

export const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL?.trim() || "http://localhost:4000";
