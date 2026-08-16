import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { listActiveMatchingFeedback, recordMatchingFeedbackUsage } from "../db";
import { createContext } from "./context";
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
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.get("/api/matching-rules", async (_req, res) => {
    try {
      const rules = await listActiveMatchingFeedback();
      res.json({ rules });
    } catch (error) {
      console.error("[Matching rules] export failed", error);
      res.status(500).json({ rules: [], error: "matching rules unavailable" });
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
