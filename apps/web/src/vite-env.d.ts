/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __DRO_BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
