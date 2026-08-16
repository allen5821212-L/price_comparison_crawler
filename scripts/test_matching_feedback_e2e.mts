import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { matchingFeedback } from "../drizzle/schema";
import { getDb } from "../server/db";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";

const stamp = `__E2E_${Date.now()}__`;
const sinyaName = `${stamp} ASUS B850-G`;
const targetName = `${stamp} ROG B850-G`;
const rulesEndpoint = process.env.MATCHING_RULES_ENDPOINT || "http://127.0.0.1:3000/api/matching-rules";

function createAdminContext(): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 1,
      openId: "e2e-admin",
      name: "E2E Admin",
      email: null,
      loginMethod: "test",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
  };
}

const db = await getDb();
if (!db) throw new Error("Database unavailable for matching-feedback E2E test");

let exitCode = 0;
try {
  const caller = appRouter.createCaller(createAdminContext());
  const confirmation = await caller.matchRules.confirm({
    sinyaName,
    targetName,
    targetId: "coolpc_e2e-b850-g",
    platform: "coolpc",
  });

  if (confirmation.sourceAlias !== "B850-G" || confirmation.targetAlias !== "B850-G") {
    throw new Error(`Unexpected generated aliases: ${JSON.stringify(confirmation)}`);
  }

  const response = await fetch(rulesEndpoint);
  const payload = await response.json() as { rules?: Array<{ id: number; sinyaName: string }> };
  const exportedRule = payload.rules?.find(rule => rule.sinyaName === sinyaName);
  if (!response.ok || !exportedRule) {
    throw new Error("Saved rule did not appear in the crawler export endpoint");
  }

  execFileSync("python3", ["crawler/test_rules_e2e.py", sinyaName, targetName], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, MATCHING_RULES_URL: rulesEndpoint },
    stdio: "inherit",
  });

  execFileSync("python3", ["crawler/test_rule_usage_e2e.py", String(exportedRule.id)], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, MATCHING_RULE_USAGE_URL: "http://127.0.0.1:3000/api/matching-rules/usage" },
    stdio: "inherit",
  });

  const stored = await db.select({ hitCount: matchingFeedback.hitCount, lastHitAt: matchingFeedback.lastHitAt })
    .from(matchingFeedback)
    .where(eq(matchingFeedback.id, exportedRule.id))
    .limit(1);
  if (stored[0]?.hitCount !== 1 || !stored[0]?.lastHitAt) {
    throw new Error(`Crawler usage metrics were not persisted: ${JSON.stringify(stored[0])}`);
  }

  console.log("PASS: tRPC confirmation → database → HTTP export → crawler application → usage metrics");
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  await db.delete(matchingFeedback).where(eq(matchingFeedback.sinyaName, sinyaName));
  process.exit(exitCode);
}
