/** One owner for the production task, route fallback, and browser refresh cadence. */
export const ADMISSION_CENSUS_CADENCE_MS = 30_000;

/** A dead request must not arrest the browser's census refresh loop forever. */
export const ADMISSION_REQUEST_TIMEOUT_MS = 20_000;
