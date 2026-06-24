import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env" });
loadDotenv({ path: "../.env", override: false });

export interface RuntimeConfig {
  adminBaseUrl?: string;
  adminLoginUrl?: string;
  adminUsername?: string;
  adminPassword?: string;
  adminVerificationCode?: string;
  adminStorageState?: string;
  forceRelogin: boolean;
  storageTtlMs: number;
  headless: boolean;
  evidenceDir: string;
}

export function loadRuntimeConfig(): RuntimeConfig {
  return {
    adminBaseUrl: readEnv("QA_ADMIN_BASE_URL"),
    adminLoginUrl: readEnv("QA_ADMIN_LOGIN_URL"),
    adminUsername: readEnv("QA_ADMIN_USERNAME"),
    adminPassword: readEnv("QA_ADMIN_PASSWORD"),
    adminVerificationCode: readEnv("QA_ADMIN_VERIFICATION_CODE"),
    adminStorageState: readEnv("QA_ADMIN_STORAGE_STATE"),
    forceRelogin: readBool("QA_FORCE_RELOGIN"),
    storageTtlMs: Number(readEnv("QA_STORAGE_TTL_MS") ?? 24 * 60 * 60 * 1000),
    headless: readEnv("QA_HEADLESS") !== "false",
    evidenceDir: readEnv("QA_EVIDENCE_DIR") ?? "reports/runs"
  };
}

export function missingAdminEnv(config: RuntimeConfig): string[] {
  const missing: string[] = [];

  if (!config.adminBaseUrl) missing.push("QA_ADMIN_BASE_URL");
  if (!config.adminUsername) missing.push("QA_ADMIN_USERNAME");
  if (!config.adminPassword) missing.push("QA_ADMIN_PASSWORD");

  return missing;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readBool(name: string): boolean {
  const value = readEnv(name)?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
