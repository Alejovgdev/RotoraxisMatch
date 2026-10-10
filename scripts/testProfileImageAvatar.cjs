// Offline checks of the shared Avatar, including image replacement after errors.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname,'../src/components/ui/Avatar.tsx'),'utf8');
let failed = null;
const react = { createElement: (type,props,...children) => ({type,props,children}), useState: () => [failed,value=>{failed=value;}], useEffect: () => {} };
const exportsObject = {};
const dependencies = {
  react,
  'react-native': {Image:'Image',View:'View',StyleSheet:{create:s=>s},Platform:{OS:'web'}},
  'lucide-react-native': {User:'User'},
  './Text':{Text:'Text'},
  '../../state/useProfileImage':{useProfileImage:()=>null},
  '../../theme':{colors:{surfaceMuted:'grey',textMuted:'grey',surfaceSoft:'white'}},
};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,
  {exports:exportsObject,require:name=>{assert.ok(dependencies[name],name);return dependencies[name];}});
const {Avatar,AvatarFrame}=exportsObject;
const shown=Avatar({name:'Ana Ruiz',uri:'local-test-image'});
assert.equal(shown.type,'Image');
const removed=Avatar({name:'Ana Ruiz',uri:null});
assert.equal(removed.children[0].children[0],'AR');
const logo=Avatar({kind:'company',name:'Example Air',uri:null});
assert.equal(logo.children[0].children[0],'EA');
const locked=Avatar({name:'Ana Ruiz',uri:'private-image',anonymous:true});
assert.equal(locked.children[0].type,'User');
assert.ok(!JSON.stringify(locked).includes('Ana Ruiz'));
assert.ok(!JSON.stringify(locked).includes('private-image'));
Avatar({name:'Ana Ruiz',uri:'broken-image'}).props.onError();
assert.equal(Avatar({name:'Ana Ruiz',uri:'broken-image'}).children[0].children[0],'AR');
assert.equal(Avatar({name:'Ana Ruiz',uri:'replacement-image'}).type,'Image');
// Regla H (fase 8): el marco alrededor del avatar sólo con iniciales o el icono genérico.
const bare = (frame) => frame.props.style[1];
assert.equal(AvatarFrame({image:{uri:'framed-photo'},style:'frame',children:[]}).props.style[0],'frame');
assert.equal(bare(AvatarFrame({image:{uri:'framed-photo'},style:'frame',children:[]})).backgroundColor,'transparent','con foto, sin fondo');
assert.equal(bare(AvatarFrame({image:{uri:'framed-photo'},style:'frame',children:[]})).borderWidth,0,'con foto, sin borde');
assert.equal(bare(AvatarFrame({image:{uri:'framed-photo'},style:'frame',children:[]})).boxShadow,'none','con foto, sin sombra');
assert.equal(bare(AvatarFrame({image:{uri:null},style:'frame',children:[]})),null,'con iniciales, el marco entero');
assert.equal(bare(AvatarFrame({image:{uri:'private-image',anonymous:true},style:'frame',children:[]})),null,'anónimo: icono genérico con su marco');
assert.equal(bare(AvatarFrame({image:{uri:'broken-image'},style:'frame',children:[]})),null,'una foto que falló vuelve a las iniciales y al marco');
console.log('PASS shared Avatar: photo, removed photo initials, removed logo initials, generic locked icon, error fallback, replacement after error, frame only around initials (7/7).');
