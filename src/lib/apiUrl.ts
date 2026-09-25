/** The Server (server branch). Set API_URL in .env.local to point at another one, e.g. http://localhost:3100. */
export const apiUrl = (process.env.API_URL || "http://43.204.46.19").replace(/\/+$/, "");
