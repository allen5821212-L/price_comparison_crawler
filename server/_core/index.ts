import "dotenv/config";
import compression from "compression";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { listActiveBrandAliases, listActiveMatchingFeedback, listLearnedNegativeMatchFeatures, recordMatchingFeedbackUsage, runReviewApiHealthMonitorByTaskUid } from "../db";
import { createContext } from "./context";
import { sdk } from "./sdk";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(compression({ threshold: 1024 }));
  // Storage uploads are handled by registerStorageProxy; public API bodies stay deliberately small.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.get("/api/matching-rules", async (_req, res) => {
    try {
      const [rules, negativeFeatures, brandAliases] = await Promise.all([listActiveMatchingFeedback(), listLearnedNegativeMatchFeatures(), listActiveBrandAliases()]);
      res.json({ rules, negativeFeatures, brandAliases });
    } catch (error) {
      console.error("[Matching rules] export failed", error);
      res.status(500).json({ rules: [], negativeFeatures: [], brandAliases: [], error: "matching rules unavailable" });
    }
  });
  app.post("/api/matching-rules/usage", async (req, res) => {
    const remoteAddress = req.socket.remoteAddress || "";
    const isLoopback = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress.endsWith("127.0.0.1");
    if (!isLoopback) return res.status(403).json({ error: "crawler endpoint is loopback-only" });

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id: unknown) => Number.isInteger(id)) : [];
    try {
      await recordMatchingFeedbackUsage(ids);
      res.json({ success: true, updated: ids.length });
    } catch (error) {
      console.error("[Matching rules] usage update failed", error);
      res.status(500).json({ success: false, error: "usage update unavailable" });
    }
  });
  app.post("/api/scheduled/review-api-health", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const result = await runReviewApiHealthMonitorByTaskUid(user.taskUid);
      return res.json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Review API health monitor] failed", error);
      return res.status(500).json({ error: message, timestamp: new Date().toISOString() });
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
