import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { loadBotStatus } from "./lib/bot-status";
import { paperTradeController } from "./lib/paper-trade";
import { renderPrometheusMetrics } from "./lib/metrics";

const app: Express = express();
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/metrics", async (_req, res) => {
  try {
    const status = await loadBotStatus();
    res.type("text/plain; version=0.0.4").send(renderPrometheusMetrics(status, paperTradeController.getStatus()));
  } catch {
    res.status(500).type("text/plain").send("metrics unavailable\n");
  }
});

app.use("/api", router);

const defaultFrontendDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "meridian",
  "dist",
  "public",
);

const staticDir = process.env["STATIC_DIR"] ?? defaultFrontendDir;

if (existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

export default app;
