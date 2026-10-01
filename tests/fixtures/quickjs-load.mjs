// Evaluate a plugin file in QuickJS (the engine family Figma's plugin sandbox
// is built on) with a stand-in `figma` global. Prints "OK" or the error.
// Run in its own process: jest cannot host QuickJS's wasm module loader.
import fs from "node:fs";
import { getQuickJS } from "quickjs-emscripten";

const QuickJS = await getQuickJS();
const vm = QuickJS.newContext();
const stub =
  "var __h={get:function(t,k){return new Proxy(function(){},__h)},apply:function(){return new Proxy(function(){},__h)}};" +
  "var figma=new Proxy(function(){},__h);var __html__='';var console={log:function(){},warn:function(){},error:function(){}};" +
  "var setTimeout=function(){return 0};var clearTimeout=function(){};var setInterval=function(){return 0};var clearInterval=function(){};\n";
const res = vm.evalCode(stub + fs.readFileSync(process.argv[2], "utf8"), "code.js");
if (res.error) {
  console.log("ERROR " + JSON.stringify(vm.dump(res.error)));
  res.error.dispose();
  vm.dispose();
  process.exit(1);
}
res.value.dispose();
vm.dispose();
console.log("OK");
