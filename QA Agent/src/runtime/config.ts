import { config as loadDotenv } from "dotenv";
import type { Site } from "../types.js";

loadDotenv({ path: ".env" });
loadDotenv({ path: "../.env", override: false });

export interface RuntimeConfig {
  adminBaseUrl?: string;
  adminLoginUrl?: string;
  adminUsername?: string;
  adminPassword?: string;
  adminVerificationCode?: string;
  adminStorageState?: string;
  creatorBaseUrl?: string;
  creatorLoginUrl?: string;
  creatorUsername?: string;
  creatorPassword?: string;
  creatorVerificationCode?: string;
  creatorStorageState?: string;
  agencyBaseUrl?: string;
  agencyLoginUrl?: string;
  agencyUsername?: string;
  agencyPassword?: string;
  agencyVerificationCode?: string;
  agencyStorageState?: string;
  forceRelogin: boolean;
  storageTtlMs: number;
  headless: boolean;
  evidenceDir: string;
  caseTimeoutMs: number;
}

export function loadRuntimeConfig(): RuntimeConfig {
  return {
    adminBaseUrl: readEnv("QA_ADMIN_BASE_URL"),
    adminLoginUrl: readEnv("QA_ADMIN_LOGIN_URL"),
    adminUsername: readEnv("QA_ADMIN_USERNAME"),
    adminPassword: readEnv("QA_ADMIN_PASSWORD"),
    adminVerificationCode: readEnv("QA_ADMIN_VERIFICATION_CODE"),
    adminStorageState: readEnv("QA_ADMIN_STORAGE_STATE"),
    creatorBaseUrl: readEnv("QA_CREATOR_BASE_URL"),
    creatorLoginUrl: readEnv("QA_CREATOR_LOGIN_URL"),
    creatorUsername: readEnv("QA_CREATOR_USERNAME"),
    creatorPassword: readEnv("QA_CREATOR_PASSWORD"),
    creatorVerificationCode: readEnv("QA_CREATOR_VERIFICATION_CODE"),
    creatorStorageState: readEnv("QA_CREATOR_STORAGE_STATE"),
    agencyBaseUrl: readEnv("QA_AGENCY_BASE_URL"),
    agencyLoginUrl: readEnv("QA_AGENCY_LOGIN_URL"),
    agencyUsername: readEnv("QA_AGENCY_USERNAME"),
    agencyPassword: readEnv("QA_AGENCY_PASSWORD"),
    agencyVerificationCode: readEnv("QA_AGENCY_VERIFICATION_CODE"),
    agencyStorageState: readEnv("QA_AGENCY_STORAGE_STATE"),
    forceRelogin: readBool("QA_FORCE_RELOGIN"),
    storageTtlMs: Number(readEnv("QA_STORAGE_TTL_MS") ?? 24 * 60 * 60 * 1000),
    headless: readEnv("QA_HEADLESS") !== "false",
    evidenceDir: readEnv("QA_EVIDENCE_DIR") ?? "reports/runs",
    caseTimeoutMs: Number(readEnv("QA_CASE_TIMEOUT_MS") ?? 90_000)
  };
}

export function missingAdminEnv(config: RuntimeConfig): string[] {
  return missingSiteEnv(config, "admin");
}

export function missingSiteEnv(config: RuntimeConfig, site: Site): string[] {
  const missing: string[] = [];
  const siteConfig = runtimeSiteConfig(config, site);

  if (!siteConfig.baseUrl && !siteConfig.loginUrl) missing.push(siteEnvName(site, "BASE_URL"));
  if (!siteConfig.username) missing.push(siteEnvName(site, "USERNAME"));
  if (!siteConfig.password) missing.push(siteEnvName(site, "PASSWORD"));

  return missing;
}

export interface RuntimeSiteConfig {
  baseUrl?: string;
  loginUrl?: string;
  username?: string;
  password?: string;
  verificationCode?: string;
  storageState?: string;
}

export function runtimeSiteConfig(config: RuntimeConfig, site: Site): RuntimeSiteConfig {
  if (site === "creator") {
    return {
      baseUrl: config.creatorBaseUrl ?? originFromUrl(config.creatorLoginUrl),
      loginUrl: config.creatorLoginUrl,
      username: config.creatorUsername,
      password: config.creatorPassword,
      verificationCode: config.creatorVerificationCode,
      storageState: config.creatorStorageState
    };
  }

  if (site === "agency") {
    return {
      baseUrl: config.agencyBaseUrl ?? originFromUrl(config.agencyLoginUrl),
      loginUrl: config.agencyLoginUrl,
      username: config.agencyUsername,
      password: config.agencyPassword,
      verificationCode: config.agencyVerificationCode,
      storageState: config.agencyStorageState
    };
  }

  return {
    baseUrl: config.adminBaseUrl,
    loginUrl: config.adminLoginUrl,
    username: config.adminUsername,
    password: config.adminPassword,
    verificationCode: config.adminVerificationCode,
    storageState: config.adminStorageState
  };
}

function siteEnvName(site: Site, suffix: "BASE_URL" | "USERNAME" | "PASSWORD"): string {
  return `QA_${site.toUpperCase()}_${suffix}`;
}

function originFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readBool(name: string): boolean {
  const value = readEnv(name)?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
