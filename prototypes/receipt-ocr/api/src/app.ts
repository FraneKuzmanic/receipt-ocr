import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { HEALTH_PATH } from "@receipt/shared";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { HttpError, errorHandler } from "./middleware/error-handler.js";
import { healthRouter } from "./routes/health.js";

/**
 * Builds the Express application without binding a port, so tests can drive it directly.
 */
export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN }));
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.use(HEALTH_PATH, healthRouter);

  app.use((_req, _res, next) => {
    next(new HttpError(404, "not_found"));
  });

  // Must stay last: Express only treats a four-argument middleware as an error handler.
  app.use(errorHandler);

  return app;
}
