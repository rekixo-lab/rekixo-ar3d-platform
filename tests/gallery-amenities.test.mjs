import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";

const read=(path)=>readFileSync(path,"utf8");

test("additive gallery category migration retains legacy Gallery images",()=>{
  const db=new DatabaseSync(":memory:");
  try{
    db.exec("CREATE TABLE gallery(project_id TEXT NOT NULL,id TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0); INSERT INTO gallery(project_id,id,sort_order) VALUES ('one','old',1),('two','other',1);");
    db.exec(read("drizzle/0044_client_gallery_amenities.sql"));
    assert.deepEqual(db.prepare("SELECT category FROM gallery ORDER BY id").all().map(x=>x.category),["gallery","gallery"]);
    db.prepare("INSERT INTO gallery(project_id,id,sort_order,category) VALUES (?,?,?,?)").run("one","new",2,"amenity");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gallery WHERE project_id=? AND category=?").get("one","amenity").n,1);
    assert.throws(()=>db.prepare("INSERT INTO gallery(project_id,id,category) VALUES (?,?,?)").run("one","invalid","other"));
  }finally{db.close()}
});

test("20-image independent limits exist in UI and atomic server upload",()=>{
  const admin=read("app/admin-dashboard.tsx"),api=read("app/api/gallery/route.ts");
  assert.match(admin,/slots=20-mediaItems\.length/);
  assert.match(admin,/mediaItems\.length\}\/20 uploaded/);
  assert.match(admin,/\["amenities",Building2,"Amenities"\]/);
  assert.match(admin,/data\.append\("category",mediaCategory\)/);
  assert.match(api,/MAX_IMAGES_PER_CATEGORY=20/);
  assert.match(api,/WHERE \(SELECT COUNT\(\*\) FROM gallery WHERE project_id=\? AND category=\?\)<20/);
  assert.match(api,/image\/jpeg","image\/png","image\/webp/);
  assert.match(api,/sameOrigin\(request\)/);
});

test("admin and customer public endpoints return strictly separate project media",()=>{
  const admin=read("app/api/data/route.ts");
  const publicMedia=read("app/api/public-gallery/route.ts");
  const publicData=read("app/api/public-data/route.ts");
  const html=read("public/project/index.html");
  assert.match(admin,/amenities: galleryRows\.filter\(\(row\) => row\.category === "amenity"\)/);
  assert.match(admin,/gallery: galleryRows\.filter\(\(row\) => row\.category === "gallery"\)/);
  assert.match(publicMedia,/eq\(gallery\.projectId,projectId\),eq\(gallery\.category,category\)/);
  assert.match(publicData,/eq\(gallery\.category, "gallery"\)/);
  assert.match(html,/category=amenity/);
  assert.match(html,/openFullImage\(source,caption\)/);
  assert.match(html,/defaults\.hidden=true/);
});
