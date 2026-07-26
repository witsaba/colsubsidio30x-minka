/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Base URL of the STT service (default http://localhost:8001). Server-side only. */
  readonly STT_BASE_URL: string;
  /** Base URL of the matcher service (default http://localhost:8002). Server-side only. */
  readonly MATCHER_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
