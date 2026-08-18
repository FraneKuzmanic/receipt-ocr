/// <reference types="vite/client" />

// `client/tsconfig.json` sets "types": [], so custom import.meta.env members must be declared
// here or they do not typecheck.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
