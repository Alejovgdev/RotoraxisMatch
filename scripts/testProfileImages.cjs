// Offline behavioral tests: real use case, repository/cache and deletion helper.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
let count=0;
function ok(label){count++;console.log(`PASS ${label}`);}
function load(file, mocks={}, globals={}) {
  const exports={};
  const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const extra=file.includes('delete-account')?'\nexport {deleteAccountTechnician};':'';
  vm.runInNewContext(ts.transpileModule(source+extra,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
    {exports,require:key=>{assert.ok(key in mocks,`Unexpected dependency ${key}`);return mocks[key];},console,Uint8Array,Map,Set,Date,...globals});
  return exports;
}
const {changeProfileImage,squareImageCrop}=load('src/usecases/profileImages.ts');
const image={bytes:new ArrayBuffer(12),contentType:'image/jpeg'};
function store(options={}) {
  let current='old'; const calls=[];
  return {calls,get current(){return current;},
    async upload(){calls.push('upload');if(options.uploadFails)throw Error('upload failed');return 'new';},
    async savePath(_kind,_id,previous,next){
      calls.push(`save:${previous}:${next}`);
      if(options.writeFails)throw Error('write failed');
      current=next;if(options.lostResponse)throw Error('lost response');
    },
    async readPath(){calls.push('read');if(options.readFails)throw Error('read failed');return current;},
    async remove(_kind,p){calls.push(`remove:${p}`);if(options.cleanupFails)throw Error('cleanup failed');},
    invalidate(){calls.push('invalidate');},
  };
}
async function main(){
  {
    const s=store(); const r=await changeProfileImage(s,'technician','t','old',image);
    assert.equal(r.path,'new');assert.deepEqual(s.calls,['upload','save:old:new','invalidate','remove:old']);ok('upload, save pointer, invalidate, delete old in that order');
  }
  {
    const s=store();const r=await changeProfileImage(s,'company','c','old',null);
    assert.equal(r.path,null);assert.deepEqual(s.calls,['save:old:null','invalidate','remove:old']);ok('remove clears pointer without an upload');
  }
  {
    const s=store({uploadFails:true});await assert.rejects(changeProfileImage(s,'technician','t','old',image));
    assert.deepEqual(s.calls,['upload']);assert.equal(s.current,'old');ok('upload failure preserves previous image');
  }
  {
    const s=store({writeFails:true});await assert.rejects(changeProfileImage(s,'company','c','old',image));
    assert.equal(s.current,'old');assert.ok(s.calls.includes('remove:new'));assert.ok(!s.calls.includes('remove:old'));ok('denied or concurrent write cleans only the new upload');
  }
  {
    const s=store({lostResponse:true});const r=await changeProfileImage(s,'technician','t','old',image);
    assert.equal(r.path,'new');assert.ok(!s.calls.includes('remove:new'));ok('lost success response does not delete the saved photo');
  }
  {
    const s=store({writeFails:true,readFails:true});await assert.rejects(changeProfileImage(s,'technician','t','old',image),/Reload/);
    assert.ok(!s.calls.some(x=>x.startsWith('remove:')));ok('unknown write outcome preserves both objects');
  }
  {
    const s=store({cleanupFails:true});const r=await changeProfileImage(s,'technician','t','old',null);
    assert.equal(r.cleanupPending,true);assert.equal(s.current,null);ok('cleanup failure reports warning after successful removal');
  }
  for(const [w,h] of [[1600,900],[900,1600],[24,32],[512,512]])for(const zoom of [1,2,3])for(const position of [0,0.5,1]){
    const c=squareImageCrop(w,h,zoom,position,position);
    assert.equal(c.width,c.height);assert.ok(c.originX>=0&&c.originY>=0&&c.originX+c.width<=w&&c.originY+c.height<=h);
  }
  assert.throws(()=>squareImageCrop(0,200));ok('square crop stays within landscape, portrait, small and square images (36 cases)');

  // The actual repository uses authenticated download and its cache is isolated
  // by session. Simulate auth events without initiating an application session.
  let session={user:{id:'company-a'},access_token:'test-token-a'},authCallback,downloads=0,pending=null,mutations=[];
  const backend={
    auth:{onAuthStateChange(fn){authCallback=fn;return{};},async getSession(){return{data:{session}};}},
    storage:{from(bucket){return{
      getPublicUrl(p){assert.equal(bucket,'company-logos');return{data:{publicUrl:`https://public.test/${p}`}};},
      async upload(p,bytes,opts){mutations.push({p,bytes,opts});return{error:null};},
      async remove(paths){return{data:paths.map(name=>({name})),error:null};},
    };}},
    from(table){const state={table};return{
      update(values){state.values=values;return this;},eq(key,value){state[key]=value;return this;},
      is(key,value){state[key]=value;return this;},select(){return this;},
      async maybeSingle(){mutations.push(state);return{data:{id:state.id},error:null};},
    };},
  };
  class Reader {readAsDataURL(blob){this.result=blob.uri;this.onload();}}
  const {profileImageRepository:r}=load('src/repositories/v2/profileImageRepository.ts',{
    '../../lib/supabase':{supabase:backend},'expo-crypto':{randomUUID:()=> '12345678-1234-4234-8234-123456789abc'},
  },{FileReader:Reader,process:{env:{EXPO_PUBLIC_SUPABASE_URL:'https://private.test',EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-test-key'}},
    fetch:async(url,options)=>{
      assert.match(url,/^https:\/\/private.test\/storage\/v1\/object\/authenticated\/technician-photos\//);
      assert.ok(!url.includes('token'));assert.equal(options.headers.Authorization,`Bearer ${session.access_token}`);
      assert.equal(options.cache,'no-store');downloads++;
      const data=pending?await pending:{data:{uri:`data:image/jpeg;base64,${session.user.id}:${url}`}};
      return{ok:true,blob:async()=>data.data};
    }});
  let revisions=0;r.subscribe(()=>revisions++);authCallback('SIGNED_IN',session);
  const first=await r.photo('tech/photo.jpg');await r.photo('tech/photo.jpg');assert.equal(downloads,1);ok('same-session photo downloads are deduplicated');
  session={user:{id:'company-b'},access_token:'test-token-b'};authCallback('SIGNED_IN',session);
  const second=await r.photo('tech/photo.jpg');assert.notEqual(first,second);assert.equal(downloads,2);ok('account change never reuses previous private image');
  let finish;pending=new Promise(resolve=>{finish=resolve;});
  const stale=r.photo('tech/slow.jpg');await Promise.resolve();await Promise.resolve();
  session=null;authCallback('SIGNED_OUT',null);finish({data:{uri:'data:stale'},error:null});
  await assert.rejects(stale,/session changed/);await assert.rejects(r.photo('tech/photo.jpg'),/Sign in/);assert.ok(revisions>=3);ok('sign-out clears cache and discards in-flight image responses');
  assert.equal(r.logo('company/logo.png'),'https://public.test/company/logo.png');ok('logo uses public bucket URL');
  await r.savePath('technician','t',null,'new');await r.savePath('company','c','old','new');
  assert.equal(mutations[0].photo_path,null);assert.equal(mutations[1].logo_path,'old');ok('pointer writes compare previous null or path in database query');
  await r.upload('technician','t',image);assert.equal(mutations[2].opts.upsert,false);assert.equal(mutations[2].opts.cacheControl,'0');
  assert.match(mutations[2].p,/^t\/[0-9a-f-]+\.jpg$/);ok('uploads are new random paths with no overwrite');

  const {deleteAccountTechnician}=load('supabase/functions/delete-account/index.ts',{
    'https://esm.sh/@supabase/supabase-js@2.107.0':{createClient:()=>{throw Error('No network');}},
  },{Deno:{serve:()=>{}}});
  function deletionBackend(mode){
    const files={'technician-documents':Array.from({length:105},(_,i)=>`t/doc-${i}`),
      'technician-photos':['t/photo.jpg','t/abandoned.jpg','t/older/photo.jpg','foreign/keep.jpg']};
    const removed=[];let deleted=false;
    return{files,removed,get deleted(){return deleted;},
      from(table){assert.equal(table,'technician_profiles');return{select(columns){assert.equal(columns,'id');return this;},eq(){return this;},async maybeSingle(){return{data:{id:'t'}};}};},
      storage:{from(bucket){assert.ok(bucket in files);return{
        async list(folder,{offset,limit}){
          if(mode==='list'&&bucket==='technician-photos')return{error:{message:'fail'}};
          const children=new Map();files[bucket].filter(p=>p.startsWith(folder+'/')).forEach(p=>{
            const name=p.slice(folder.length+1).split('/')[0];children.set(name,{name,id:p.slice(folder.length+1).includes('/')?null:'object'});
          });return{data:[...children.values()].slice(offset,offset+limit)};
        },
        async remove(paths){
          assert.ok(paths.every(p=>p.startsWith('t/')));assert.ok(paths.length<=100);
          if(mode==='remove'&&bucket==='technician-photos')return{error:{message:'fail'}};
          removed.push(...paths);if(mode!=='unconfirmed')files[bucket]=files[bucket].filter(p=>!paths.includes(p));return{error:null};
        },
      };}},auth:{admin:{async deleteUser(id){assert.equal(id,'user');deleted=true;return{};}}},
    };
  }
  const good=deletionBackend();await deleteAccountTechnician(good,'user');
  assert.equal(good.deleted,true);assert.equal(good.removed.length,108);assert.deepEqual(good.files['technician-photos'],['foreign/keep.jpg']);
  ok('account deletion removes photos, abandoned files, nested files and paginated documents only from own folders');
  for(const mode of ['list','remove','unconfirmed']){
    const bad=deletionBackend(mode);await assert.rejects(deleteAccountTechnician(bad,'user'));assert.equal(bad.deleted,false);ok(`account auth deletion waits for confirmed Storage cleanup (${mode})`);
  }
  console.log(`Profile image behavioral tests: ${count}/${count}. No login or network.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
