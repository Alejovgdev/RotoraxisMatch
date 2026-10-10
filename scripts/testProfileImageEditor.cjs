// Exercise actual editor event handlers offline; OS picker and codec are adapters.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync('src/components/ui/ProfileImageEditor.tsx','utf8');
let slots=[],cursor=0,effects=[],selected={canceled:true},saved=[],prepared=[],platform='web',pickOptions;
const react={createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)}),
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
  useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((d,j)=>d!==slots[i][j])){slots[i]=deps;effects.push(fn);}},
};
const usecase={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/usecases/profileImages.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:usecase});
const store={async upload(kind,id,image){saved.push(['upload',kind,id,image.bytes.byteLength]);return'new-path';},
  async savePath(kind,id,previous,next){saved.push(['save',previous,next]);},async readPath(){return'old-path';},
  async remove(kind,path){saved.push(['remove',path]);},invalidate(){}};
const modules={react,'react-native':{Image:'Image',Pressable:'Pressable',View:'View',StyleSheet:{create:x=>x},Platform:{get OS(){return platform;}}},
  'expo-image-picker':{async launchImageLibraryAsync(options){pickOptions=options;return selected;}},
  'expo-image-manipulator':{SaveFormat:{JPEG:'jpeg',PNG:'png'},async manipulateAsync(uri,actions,options){prepared.push({uri,actions,options});return{base64:'YWJj'};}},
  'lucide-react-native':{Camera:'Camera'},'./Avatar':{Avatar:'Avatar'},'./BottomSheet':{BottomSheet:'BottomSheet'},'./Text':{Text:'Text'},
  '../company/CompanyPage':{PillButton:'PillButton'},'../../theme':{colors:{}},'../../usecases/profileImages':usecase,
  '../../repositories/v2/profileImageRepository':{profileImageRepository:store},
};
const out={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText,
  {exports:out,require:k=>{assert.ok(modules[k],k);return modules[k];},atob:s=>Buffer.from(s,'base64').toString('binary'),Uint8Array});
function tree(node){return !node||typeof node!=='object'?[]:[node,...(node.children??[]).flatMap(tree)];}
let props={kind:'technician',id:'tech',name:'Ana',path:'old-path',onChanged:path=>saved.push(['changed',path])};
function render(){cursor=0;effects=[];const result=out.ProfileImageEditor(props);effects.forEach(fn=>fn());return tree(result);}
function press(label){const button=render().find(n=>n.type==='PillButton'&&n.props.label===label);assert.ok(button,label);assert.ok(!button.props.disabled,label);button.props.onPress();}
async function settle(){for(let i=0;i<25;i++)await Promise.resolve();}
async function main(){
  press('Change photo');press('Choose image');await settle();assert.equal(saved.length,0);assert.ok(render().find(n=>n.type==='BottomSheet').props.visible);
  press('Cancel');assert.equal(saved.length,0);console.log('PASS cancelling picker or editor makes no writes');
  selected={canceled:false,assets:[{uri:'file:test',width:1600,height:900}]};
  press('Change photo');press('Choose image');await settle();assert.equal(pickOptions.allowsEditing,false);
  assert.ok(render().some(n=>n.props.accessibilityLabel==='Square image preview'));
  press('Save photo');await settle();assert.equal(prepared[0].actions[0].crop.width,900);assert.equal(prepared[0].actions[1].resize.width,512);
  assert.equal(prepared[0].options.format,'jpeg');assert.equal(saved.filter(x=>x[0]==='upload').length,1);
  assert.equal(render().find(n=>n.type==='Avatar').props.photoPath,'new-path');console.log('PASS web previews square crop and resizes/re-encodes before uploading');
  press('Change photo');press('Remove photo');await settle();assert.equal(render().find(n=>n.type==='Avatar').props.photoPath,null);
  assert.ok(saved.some(x=>x[0]==='save'&&x[2]===null));console.log('PASS removing photo updates avatar to initials source immediately');
  for(const os of ['android','ios']){
    slots=[];saved=[];prepared=[];platform=os;props={...props,kind:'company',id:'company'};
    press('Change logo');press('Choose image');await settle();assert.equal(pickOptions.allowsEditing,true);assert.deepEqual(Array.from(pickOptions.aspect),[1,1]);
    press('Save logo');await settle();assert.equal(prepared[0].options.format,'png');assert.equal(render().find(n=>n.type==='Avatar').props.logoPath,'new-path');
    press('Change logo');press('Remove logo');await settle();assert.equal(render().find(n=>n.type==='Avatar').props.logoPath,null);
    console.log(`PASS ${os} square picker, PNG logo and removal to initials`);
  }
  console.log('Profile image editor: 5/5 offline checks; device interaction remains with owner.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
