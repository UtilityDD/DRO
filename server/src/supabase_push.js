const { pushAllLocalToSupabase, useSupabase } = require('./store');

async function main() {
  if (!useSupabase()) {
    console.error('Supabase not configured. Edit server/data/supabase_config.json first.');
    console.error('See docs/SUPABASE_SETUP.md');
    process.exit(1);
  }
  console.log('Pushing local server/data/*.json → your Supabase schema dro …');
  const report = await pushAllLocalToSupabase();
  console.log('Done:', report);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
