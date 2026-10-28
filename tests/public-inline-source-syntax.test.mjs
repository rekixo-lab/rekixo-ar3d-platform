import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const html=readFileSync("public/project/index.html","utf8");

test("each inline public customer script parses as valid browser JavaScript",()=>{
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(x=>x[1]).filter(x=>x.trim());
  assert.ok(scripts.length>=4,"expected inline public runtime blocks");
  for(const [index,source] of scripts.entries())
    assert.doesNotThrow(()=>new vm.Script(source,{filename:"public/project/index.html:inline-"+index}),
      "invalid inline customer JS block "+index);
});
