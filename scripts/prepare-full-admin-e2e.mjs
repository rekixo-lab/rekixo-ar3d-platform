import { randomBytes, webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const encoder = new TextEncoder();
const email = "e2e-owner@rekixo.test";
const password = `E2E-${randomBytes(12).toString("hex")}9a`;
const salt = randomBytes(16);
const key = await webcrypto.subtle.importKey(
  "raw",
  encoder.encode(password),
  "PBKDF2",
  false,
  ["deriveBits"],
);
const hash = new Uint8Array(
  await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256,
  ),
);
const b64 = (value) => Buffer.from(value).toString("base64");
const sessionSecret = randomBytes(32);

fs.writeFileSync(
  ".dev.vars",
  [
    "PANEL_MODE=super",
    `ADMIN_EMAIL=${email}`,
    `ADMIN_PASSWORD_SALT=${b64(salt)}`,
    `ADMIN_PASSWORD_HASH=${b64(hash)}`,
    `SESSION_SECRET=${b64(sessionSecret)}`,
    "CLIENT_PLATFORM_HOST=localhost",
    "CLIENT_FALLBACK_HOST=localhost",
    "CLIENT_SHARED_ADMIN_HOST=localhost",
    "",
  ].join("\n"),
);
fs.writeFileSync(
  "/tmp/rekixo-phase11-auth.json",
  JSON.stringify({ email, password }),
  { mode: 0o600 },
);

const artifactDir = path.join(process.cwd(), "artifacts", "full-admin-e2e");
fs.mkdirSync(artifactDir, { recursive: true });
const seed = `
DELETE FROM published_plot_edge_measurements WHERE project_id='e2e-phase11';
DELETE FROM published_plots WHERE project_id='e2e-phase11';
DELETE FROM published_settings WHERE project_id='e2e-phase11';
DELETE FROM project_public_snapshots WHERE project_id='e2e-phase11';
DELETE FROM plot_edge_measurements WHERE project_id='e2e-phase11';
DELETE FROM plot_pricing WHERE project_id='e2e-phase11';
DELETE FROM settings WHERE project_id='e2e-phase11';
DELETE FROM plots WHERE project_id='e2e-phase11';

INSERT INTO projects (
  id,name,slug,kind,status,public_status,publish_version,created_at,updated_at
) VALUES (
  'e2e-phase11','Phase 11 E2E Project','phase-11-e2e','customer','active','draft',0,
  '2026-09-24T00:00:00.000Z','2026-09-24T00:00:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  slug=excluded.slug,
  kind='customer',
  status='active',
  public_status='draft',
  published_at=NULL,
  publish_version=0,
  public_host=NULL,
  admin_host=NULL,
  deleted_at=NULL,
  updated_at=excluded.updated_at;

INSERT INTO plots (
  project_id,id,sqft,sqm,sqyd,dimensions,road,
  front,depth,back,depth2,dimension_unit,
  polygon,status,notes,featured,inventory_active,updated_at
) VALUES (
  'e2e-phase11','P-1',1000,92.903,111.111,'20 x 50 ft','30 ft road',
  20,50,20,50,'ft',
  '','available','Phase 11 browser fixture',0,1,'2026-09-24T00:00:00.000Z'
), (
  'e2e-phase11','P-2',1000,92.903,111.111,'20 x 50 ft','30 ft road',
  20,50,20,50,'ft',
  '','available','Adjacent-boundary browser fixture',0,1,'2026-09-24T00:00:00.000Z'
);

INSERT INTO settings (project_id,key,value,updated_at) VALUES
  ('e2e-phase11','projectName','Phase 11 E2E Project','2026-09-24T00:00:00.000Z'),
  ('e2e-phase11','brandName','Rekixo E2E','2026-09-24T00:00:00.000Z'),
  ('e2e-phase11','brandShort','R11','2026-09-24T00:00:00.000Z'),
  ('e2e-phase11','location','Test City','2026-09-24T00:00:00.000Z'),
  ('e2e-phase11','address','Phase 11 Test Address','2026-09-24T00:00:00.000Z'),
  ('e2e-phase11','phone1','+911234567890','2026-09-24T00:00:00.000Z'),
  ('e2e-phase11','whatsapp','+911234567890','2026-09-24T00:00:00.000Z'),
  ('e2e-phase11','shareTitle','Phase 11 Customer Website','2026-09-24T00:00:00.000Z'),
  ('e2e-phase11','shareDescription','End-to-end browser regression project','2026-09-24T00:00:00.000Z'),
  ('e2e-phase11','shareImage','e2e-share-ready','2026-09-24T00:00:00.000Z'),
  ('e2e-phase11','shareVersion','1','2026-09-24T00:00:00.000Z'),
  ('e2e-phase11','publicSiteEnabled','1','2026-09-24T00:00:00.000Z'),
  ('e2e-phase11','pricingEnabled','0','2026-09-24T00:00:00.000Z'),
  ('e2e-phase11','customerCallEnabled','1','2026-09-24T00:00:00.000Z');
`;
fs.writeFileSync(path.join(artifactDir, "seed.sql"), seed.trimStart());
console.log("Prepared isolated Phase 11 local E2E environment");
