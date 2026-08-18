import { createClient } from "@supabase/supabase-js";

const required = ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "STORAGE_BUCKET"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`Storage provisioning requires: ${missing.join(", ")}`);
  process.exitCode = 1;
} else {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const bucketName = process.env.STORAGE_BUCKET;

  try {
    const { data: bucket, error: getError } = await client.storage.getBucket(bucketName);
    const missingBucket = getError && String(getError.statusCode) === "404";

    if (getError && !missingBucket) {
      throw new Error("Could not inspect the storage bucket.");
    }

    if (!bucket) {
      const { error } = await client.storage.createBucket(bucketName, { public: false });
      if (error) throw new Error("Could not create the storage bucket.");
      console.log(`Created private storage bucket ${bucketName}.`);
    } else if (bucket.public) {
      const { error } = await client.storage.updateBucket(bucketName, { public: false });
      if (error) throw new Error("Could not make the storage bucket private.");
      console.log(`Updated storage bucket ${bucketName} to private.`);
    } else {
      console.log(`Storage bucket ${bucketName} is already private.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage provisioning failed.";
    console.error(message);
    process.exitCode = 1;
  }
}
