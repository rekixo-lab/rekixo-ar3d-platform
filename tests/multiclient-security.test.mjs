import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const source=path=>readFile(new URL(path,import.meta.url),"utf8");

test("multiple staff admins do not disable or delete the whole project",async()=>{
  const users=await source("../app/api/admin/users/route.ts");
  assert.doesNotMatch(users,/SELECT id FROM admin_users WHERE project_id=.*client admin pehle se/);
  assert.match(users,/COUNT\(\*\) AS total FROM admin_users WHERE project_id/);
  assert.match(users,/client\.admin_removed/);
  const toggle=users.slice(users.indexOf('if(action==="toggle")'),users.indexOf('if(action==="domains")'));
  assert.doesNotMatch(toggle,/UPDATE projects SET status/);
});

test("client mutations are tenant scoped and audited",async()=>{
  const [data,gallery]=await Promise.all([source("../app/api/data/route.ts"),source("../app/api/gallery/route.ts")]);
  assert.match(data,/session\.role === "super_admin"\s*\? requestedProjectId\s*:\s*session\.projectId/);
  assert.match(data,/project\.plot_updated/);
  assert.match(data,/project\.settings_updated/);
  assert.match(gallery,/projects\/\$\{projectId\}\/\$\{category===/);
  assert.match(gallery,/category===\"amenity\"\?\"amenities\":\"gallery\"/);
  assert.match(gallery,/project\.\$\{category\}_uploaded/);
  assert.match(gallery,/project\.gallery_deleted/);
});

test("branding is project configurable and credentials auto-clear",async()=>{
  const [dashboard,manager,website]=await Promise.all([source("../app/admin-dashboard.tsx"),source("../app/client-admin-manager.tsx"),source("../public/project/index.html")]);
  for(const key of ["brandName","brandShort","template","accentColor"])assert.match(dashboard,new RegExp(key));
  assert.match(manager,/5\*60\*1000/);
  assert.match(website,/dataset\.template/);
});
