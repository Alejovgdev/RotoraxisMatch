// --rehearse: reproduce pre-102 attacks, test 102 and its undo inside ROLLBACK.
// Default: verify installed 102. Never signs in or persists test data.
const fs=require('node:fs');
const path=require('node:path');
require('./lib/devDatabaseGuard.cjs').assertDevDatabase();
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const env=Object.fromEntries(read('.env').split(/\r?\n/).filter(s=>/^[A-Z_]+=/.test(s)).map(s=>{
  const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];
}));
const token=process.env.SUPABASE_TEST_ACCESS_TOKEN??env.SUPABASE_ACCESS_TOKEN??process.env.SUPABASE_ACCESS_TOKEN;
const host=new URL(env.EXPO_PUBLIC_SUPABASE_URL??process.env.EXPO_PUBLIC_SUPABASE_URL).hostname;
assert.match(host,/^[a-z0-9]+\.supabase\.co$/);assert.ok(token,'Missing administrative test token');
const rehearse=process.argv.includes('--rehearse');
const migration=read('supabase/migrations/102_signup_role_guards.sql');
const down=read('supabase/rollbacks/102_signup_role_guards.down.sql').replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,'');
function suite(file){const sql=read(`scripts/${file}`);assert.match(sql,/\bBEGIN;/);assert.match(sql,/ROLLBACK;\s*$/);
  return sql.replace(/\bBEGIN;/,'').replace(/ROLLBACK;\s*$/,'');}
async function query(sql){
  const r=await fetch(`https://api.supabase.com/v1/projects/${host.split('.')[0]}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000),
  });const d=await r.json();if(!r.ok)throw new Error(`HTTP ${r.status}: ${d.message??'SQL failed'}`);return d;
}
const rolledBack=sql=>query(`BEGIN; SET LOCAL lock_timeout='3s';\n${sql}\nROLLBACK;`);
const schemaSnapshot=`SELECT md5(jsonb_build_object(
  'functions',(SELECT jsonb_agg(replace(pg_get_functiondef(oid),chr(13),'') ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f'),
  'acl',(SELECT jsonb_agg(coalesce(proacl::text,'') ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace),
  'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY oid) FROM pg_trigger WHERE NOT tgisinternal),
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage'))
)::text) AS hash`;
function checkRows(rows,count){assert.equal(rows.length,count,'Missing role checks');assert.ok(rows.every(r=>r.passed===true),JSON.stringify(rows.filter(r=>!r.passed)));}
async function main(){
  const [state]=await query(`SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='102_signup_role_guards') AS installed,
    EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='103_offer_writes_require_verified_company') AS offer_guard`);
  assert.equal(state.installed,!rehearse,rehearse?'102 is already installed: run without --rehearse':'102 is not installed: use --rehearse first');
  const tables=await query(`SELECT schemaname,tablename FROM pg_tables WHERE schemaname='public' OR (schemaname='auth' AND tablename='users') OR (schemaname='supabase_migrations' AND tablename='schema_migrations') ORDER BY schemaname,tablename`);
  const dataSnapshot=tables.map(({schemaname:s,tablename:t})=>{assert.match(s,/^[a-z_]+$/);assert.match(t,/^[a-z0-9_]+$/);
    return `SELECT '${s}.${t}' AS item,md5(coalesce(jsonb_agg(j ORDER BY j::text)::text,'[]')) AS hash FROM (SELECT to_jsonb(x) j FROM "${s}"."${t}" x) q`;
  }).join('\nUNION ALL\n')+'\nORDER BY item';
  const beforeData=await query(dataSnapshot);const beforeSchema=await query(schemaSnapshot);
  const secure=`SET LOCAL app.signup_roles_secure='true'; SET LOCAL app.company_offer_guard_secure='${state.offer_guard}';\n`;
  const baseline="SET LOCAL app.signup_roles_secure='false';\n";
  const candidate=rehearse?migration:'';
  try{
    if(rehearse){
      const reproduced=await rolledBack(baseline+suite('testSignupRoles.sql'));checkRows(reproduced,18);
      console.log('PASS baseline: forged admin self-activates; active technician creates company; pending-company offer permissions reproduced.');
    }
    const rows=await rolledBack(candidate+'\n'+secure+suite('testSignupRoles.sql'));checkRows(rows,40);
    rows.forEach(r=>console.log(`PASS ${r.test}`));
    for(const [file,count] of [['testTechnicianSignup.sql',25],['testApplicationSecurity.sql',23],['testTransactionalWrites.sql',27]]){
      const results=await rolledBack(candidate+'\n'+secure+suite(file));checkRows(results,count);
      console.log(`PASS ${file}: ${count}/${count}`);
    }
    if(rehearse){
      for(const [label,from,to,expected] of [
        ['admin signup whitelist removed',"v_requested_role NOT IN ('technician', 'company')","v_requested_role NOT IN ('technician', 'company', 'admin')",'client admin signup rejected'],
        ['company role check removed',"WHERE id = v_uid AND role = 'company_user'","WHERE id = v_uid",'technician cannot create company'],
        ['reverse account-role guard removed',"role = 'technician') THEN","role IN ('technician','company_user')) THEN",'company cannot create technician profile through RPC'],
      ]){
        assert.ok(migration.includes(from),`Missing mutation target: ${label}`);let message='';
        try{await rolledBack(migration.replace(from,to)+'\n'+secure+suite('testSignupRoles.sql'));}catch(e){message=e.message;}
        assert.ok(message.includes(`Role test failed: ${expected}`),`Missed negative control: ${label}: ${message}`);
        console.log(`PASS negative control: ${label}`);
      }
      const restored=await rolledBack(`${migration}\n${secure}${suite('testSignupRoles.sql')}\n${down}
        DROP TABLE role_results;
        DROP FUNCTION pg_temp.check_role(text,boolean,text);
        DROP FUNCTION pg_temp.attempt_role(text);
        ${baseline}${suite('testSignupRoles.sql')}\n${schemaSnapshot};`);
      assert.deepEqual(restored,beforeSchema,'Undo did not restore original schema');
      console.log('PASS undo: original behaviour and schema restored inside ROLLBACK.');
    }
  }finally{
    assert.deepEqual(await query(dataSnapshot),beforeData,'Rollback changed existing data or migration history');
    assert.deepEqual(await query(schemaSnapshot),beforeSchema,'Rollback changed installed schema');
    console.log(`PASS rollback: ${tables.length} tables, existing admins, schema and migration history unchanged.`);
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
