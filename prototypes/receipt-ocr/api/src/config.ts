import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

// The repository keeps a single .env at its root; src/ and dist/ sit at the same depth.
loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const NODE_ENVS = ["development", "test", "production"] as const;
const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

type NodeEnv = (typeof NODE_ENVS)[number];
type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  readonly PORT: number;
  readonly NODE_ENV: NodeEnv;
  readonly LOG_LEVEL: LogLevel;
  readonly WEB_ORIGIN: string;
}

const problems: string[] = [];

function readPort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    problems.push(`PORT must be an integer between 1 and 65535 (received "${raw}")`);
    return fallback;
  }
  return parsed;
}

function readEnum<T extends string>(
  name: string,
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (raw === undefined || raw === "") return fallback;
  if (!allowed.includes(raw as T)) {
    problems.push(`${name} must be one of ${allowed.join(", ")} (received "${raw}")`);
    return fallback;
  }
  return raw as T;
}

const parsed: Config = {
  PORT: readPort(process.env["PORT"], 3001),
  NODE_ENV: readEnum("NODE_ENV", process.env["NODE_ENV"], NODE_ENVS, "development"),
  LOG_LEVEL: readEnum("LOG_LEVEL", process.env["LOG_LEVEL"], LOG_LEVELS, "info"),
  WEB_ORIGIN: process.env["WEB_ORIGIN"] ?? "http://localhost:5173",
};

if (problems.length > 0) {
  throw new Error(`Invalid environment configuration:\n- ${problems.join("\n- ")}`);
}

export const config: Config = Object.freeze(parsed);
