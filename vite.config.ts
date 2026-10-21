import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages can't send response headers, so the built page carries its
// Content Security Policy as a meta tag. Only scripts from the app itself run;
// the page talks only to Supabase and frames only Supabase (CVs) and Google
// Docs (the handbook). A new external host must be added here. Build only: the
// dev server injects inline scripts this policy would block.
function contentSecurityPolicy(supabaseUrl: string | undefined): Plugin {
  const supabase = supabaseUrl ? new URL(supabaseUrl).origin : ''
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    // MUI (emotion) writes its styles into <style> tags at runtime.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase}`,
    "font-src 'self' data:",
    `connect-src 'self' ${supabase}`,
    `frame-src ${supabase} https://docs.google.com https://accounts.google.com`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ')
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
    ],
  }
}

export default defineConfig(({ mode }) => ({
  // Relative base so the build works under any GitHub Pages sub-path.
  base: './',
  plugins: [react(), contentSecurityPolicy(loadEnv(mode, process.cwd()).VITE_SUPABASE_URL)],
}))
