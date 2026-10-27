/**
 * The project's website (the front page, the features tour, the letter, the brand page and the app downloads), when this install links to it.
 * Set VITE_WEBSITE_URL when building; with none, the links to it are left out.
 */
export const WEBSITE_URL = ((import.meta.env.VITE_WEBSITE_URL as string | undefined) ?? "").replace(/\/+$/, "");
