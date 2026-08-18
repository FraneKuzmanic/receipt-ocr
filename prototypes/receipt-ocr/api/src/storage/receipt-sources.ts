import type { SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import type { Database } from "../database.types.js";

export const SOURCE_URL_TTL_SECONDS = 300;

export function sourceObjectPath(userId: string, receiptId: string): string {
  return `${userId}/${receiptId}/source`;
}

export async function uploadSource(
  client: SupabaseClient<Database>,
  path: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await client.storage
    .from(config.STORAGE_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error("Could not store receipt source.");
}

export async function createSourceSignedUrl(
  client: SupabaseClient<Database>,
  path: string,
): Promise<string> {
  const { data, error } = await client.storage
    .from(config.STORAGE_BUCKET)
    .createSignedUrl(path, SOURCE_URL_TTL_SECONDS);
  if (error || data === null) throw new Error("Could not create receipt source URL.");
  return data.signedUrl;
}

export async function removeSource(client: SupabaseClient<Database>, path: string): Promise<void> {
  await client.storage.from(config.STORAGE_BUCKET).remove([path]);
}
