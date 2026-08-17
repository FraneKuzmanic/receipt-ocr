import pino from "pino";
import { config } from "./config.js";

// PRD §9.4: never log credentials, receipt contents or signed URLs.
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.file", "*.signedUrl"],
    remove: true,
  },
});
