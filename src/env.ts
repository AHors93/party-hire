// Load .env when running locally (Replit uses Secrets instead).
// Kept in its own module and imported first, so it runs before config reads process.env.
try {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile();
} catch {
  // no .env file – that's fine
}
