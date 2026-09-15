/**
 * EXACT replica of what ChatPage.tsx does in the browser, run from Node.
 * Uses the real Supabase auth token, the exact same fetch URL the browser
 * builds, and reads the stream incrementally with a reader — timing every
 * stage with high-resolution clocks.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const envText = readFileSync(resolve(root, '.env'), 'utf8');
const env = Object.fromEntries(
  envText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const now = () => {
  const [s, ns] = process.hrtime();
  return s * 1000 + ns / 1e6;
};

const t0 = now();
const log = (label) => console.log(`[CHAT-TIMING] ${label} +${(now() - t0).toFixed(1)}ms`);

async function main() {
  log('before getAccessToken');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    console.error('NO SESSION', error?.message);
    process.exit(2);
  }
  const token = data.session.access_token;
  log('after getAccessToken');

  const apiUrl = env.VITE_API_URL || '';
  const url = `${apiUrl}/api/v1/chat/stream`;
  log(`before fetch url=${url}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ plant_id: null, message: 'Best soil for Aloe Vera?' }),
  });
  log('after fetch resolved');
  log(`status=${res.status}`);
  log(`content-type=${res.headers.get('content-type')}`);
  log(`transfer-encoding=${res.headers.get('transfer-encoding')}`);
  log(`content-encoding=${res.headers.get('content-encoding')}`);

  if (res.status === 401) {
    const body = await res.text();
    console.error('401:', body);
    process.exit(3);
  }
  if (!res.ok || !res.body) {
    console.error('request failed', res.status);
    process.exit(4);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let firstChunkAt = null;
  let totalChars = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.length > 0 && firstChunkAt === null) {
      firstChunkAt = now();
      log('first non-empty chunk received');
      log(`first chunk bytes=${buffer.length}`);
    }
    totalChars += buffer.length;
    buffer = '';
  }
  log('stream closed');
  log(`total_chars=${totalChars}`);
  log(`first_chunk_ms=${(firstChunkAt - t0).toFixed(1)}`);
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});