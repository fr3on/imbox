export const STEP = 15;

export const DAY_MIN = 24 * 60;

/** Every 15-minute slot of a day, as minutes past local midnight. */
export const SLOTS: number[] = Array.from({ length: DAY_MIN / STEP }, (_, i) => i * STEP);
