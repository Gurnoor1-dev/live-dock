const APP_ORIGIN = (process.env.LIVE_DOCK_ORIGIN || "").replace(/\/$/, "");
const CRON_SECRET = process.env.NEON_CRON_SECRET || "";
const ROUTES = new Set(["/auto-crew", "/schedule-reviser", "/notifier"]);

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
    if (!APP_ORIGIN || !CRON_SECRET) {
      return Response.json({ error: "Scheduler is not configured" }, { status: 503 });
    }

    let delivery;
    try {
      delivery = await request.json();
    } catch {
      return Response.json({ error: "Invalid trigger payload" }, { status: 400 });
    }

    const invocationId = request.headers.get("x-neon-trigger-invocation-id");
    if (!invocationId || invocationId !== delivery?.invocation_id ||
        delivery?.version !== 1 || delivery?.trigger?.type !== "schedule") {
      return Response.json({ error: "Invalid Neon trigger delivery" }, { status: 401 });
    }

    const route = new URL(request.url).pathname;
    if (!ROUTES.has(route)) {
      return Response.json({ error: "Unknown automation route" }, { status: 404 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(`${APP_ORIGIN}/api/cron${route}`, {
        method: "GET",
        headers: { authorization: `Bearer ${CRON_SECRET}`, accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) {
        console.error("LiveDock automation failed", {
          route, status: response.status, response: body.slice(0, 1500),
        });
        return Response.json(
          { ok: false, route, status: response.status, response: body.slice(0, 1500) },
          { status: 502 },
        );
      }
      return Response.json({ ok: true, route, status: response.status });
    } catch (error) {
      console.error("LiveDock automation request failed", {
        route, error: error instanceof Error ? error.message : "Unknown error",
      });
      return Response.json({ ok: false, route, error: "Automation request failed" }, { status: 502 });
    } finally {
      clearTimeout(timeout);
    }
  },
};
