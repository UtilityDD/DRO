const sb = require('./supabase');

const st = sb.status();
console.log(JSON.stringify({ ok: true, ...st }, null, 2));
if (!st.configured) {
  console.log('\nNot configured yet. See docs/SUPABASE_SETUP.md');
  console.log('Copy server/data/supabase_config.example.json → supabase_config.json');
  process.exitCode = 1;
}
