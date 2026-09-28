// Called once when the server starts (not during `next build`). It only schedules work;
// register() must return before the server accepts requests.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
}
