// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import node from '@astrojs/node';

// Design D2: output 'server' so only /api/* proxy endpoints run on the server.
// Every UI page opts back into static output with `export const prerender = true`.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [preact()],
});
