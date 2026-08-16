import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, matchingFeedback, users } from "../drizzle/schema";
import { ENV } from './_core/env';

export type FeedbackPlatform = "coolpc" | "pchome" | "momo";

export interface MatchingFeedbackInput {
  sinyaName: string;
  targetName: string;
  targetId?: string | null;
  sourceAlias?: string | null;
  targetAlias?: string | null;
  platform: FeedbackPlatform;
  createdByOpenId: string;
  note?: string | null;
}

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/** Store one authoritative target per Sinya product and platform. */
export async function upsertMatchingFeedback(input: MatchingFeedbackInput) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");

  await db.insert(matchingFeedback).values({
    sinyaName: input.sinyaName,
    targetName: input.targetName,
    targetId: input.targetId ?? null,
    sourceAlias: input.sourceAlias ?? null,
    targetAlias: input.targetAlias ?? null,
    platform: input.platform,
    createdByOpenId: input.createdByOpenId,
    active: true,
    note: input.note ?? null,
  }).onDuplicateKeyUpdate({
    set: {
      targetName: input.targetName,
      targetId: input.targetId ?? null,
      sourceAlias: input.sourceAlias ?? null,
      targetAlias: input.targetAlias ?? null,
      createdByOpenId: input.createdByOpenId,
      active: true,
      note: input.note ?? null,
    },
  });
}

/** Public, minimal crawler export that does not expose creator identity. */
export async function listActiveMatchingFeedback() {
  const db = await getDb();
  if (!db) return [];

  return db.select({
    sinyaName: matchingFeedback.sinyaName,
    targetName: matchingFeedback.targetName,
    targetId: matchingFeedback.targetId,
    sourceAlias: matchingFeedback.sourceAlias,
    targetAlias: matchingFeedback.targetAlias,
    platform: matchingFeedback.platform,
    updatedAt: matchingFeedback.updatedAt,
  }).from(matchingFeedback).where(eq(matchingFeedback.active, true));
}
