import { Router } from "express";
import type { HealthResponse } from "@receipt/shared";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  const body: HealthResponse = { status: "ok", uptimeSeconds: Math.floor(process.uptime()) };
  res.json(body);
});
