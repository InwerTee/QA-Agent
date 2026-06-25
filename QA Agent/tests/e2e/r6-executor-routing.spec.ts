import { expect, test } from "@playwright/test";
import { hasR6MasterCampaignExecutor } from "../../src/executors/r6MasterCampaign.js";

test("R6 pilot case ids are routed to the Master Campaign executor", async () => {
  expect(hasR6MasterCampaignExecutor("R6-B7.2-TC01")).toBe(true);
  expect(hasR6MasterCampaignExecutor("R6-B7.1-TC01")).toBe(true);
  expect(hasR6MasterCampaignExecutor("R6-B7.3-TC01")).toBe(true);
  expect(hasR6MasterCampaignExecutor("R6-B7.5-TC99")).toBe(false);
});
