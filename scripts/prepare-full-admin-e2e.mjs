import { randomBytes, webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const encoder = new TextEncoder();
const email = "e2e-owner@rekixo.test";
const password = `E2E-${randomBytes(12).toString("hex")}9a`;
const clientEmail = "e2e-client@rekixo.test";
const otherClientEmail = "e2e-other-client@rekixo.test";
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
  JSON.stringify({ email, password, clientEmail, otherClientEmail }),
  { mode: 0o600 },
);

const artifactDir = path.join(process.cwd(), "artifacts", "full-admin-e2e");
fs.mkdirSync(artifactDir, { recursive: true });
const seed = `
DELETE FROM plot_admin_details WHERE project_id IN ('e2e-phase11','e2e-details-other');
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

INSERT INTO projects (
  id,name,slug,kind,status,public_status,publish_version,created_at,updated_at
) VALUES (
  'e2e-details-other','Other Client Details Fixture','details-other-e2e','customer','active','draft',0,
  '2026-09-24T00:00:00.000Z','2026-09-24T00:00:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET status='active',deleted_at=NULL;

INSERT INTO admin_users (
  id,email,name,login_type,login_id,project_id,role,password_hash,password_salt,
  status,must_change_password,session_version,created_at,updated_at
) VALUES (
  'e2e-phase11-client','${clientEmail}','Browser E2E Client','email','${clientEmail}',
  'e2e-phase11','client_admin','${b64(hash)}','${b64(salt)}',
  'active',0,1,'2026-09-24T00:00:00.000Z','2026-09-24T00:00:00.000Z'
), (
  'e2e-details-other-client','${otherClientEmail}','Other Browser E2E Client','email','${otherClientEmail}',
  'e2e-details-other','client_admin','${b64(hash)}','${b64(salt)}',
  'active',0,1,'2026-09-24T00:00:00.000Z','2026-09-24T00:00:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  password_hash=excluded.password_hash,password_salt=excluded.password_salt,
  status='active',must_change_password=0,session_version=1;

INSERT INTO project_memberships (user_id,project_id,role,status,is_primary,created_at,updated_at)
VALUES
  ('e2e-phase11-client','e2e-phase11','client_admin','active',1,'2026-09-24T00:00:00.000Z','2026-09-24T00:00:00.000Z'),
  ('e2e-details-other-client','e2e-details-other','client_admin','active',1,'2026-09-24T00:00:00.000Z','2026-09-24T00:00:00.000Z')
ON CONFLICT(user_id,project_id) DO UPDATE SET status='active';

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

INSERT INTO plots (project_id,id,sqft,sqm,sqyd,dimensions,road,status,notes,featured,inventory_active,updated_at)
VALUES
  ('e2e-details-other','P-1',2000,185.806,222.222,'40 x 50 ft','30 ft road','sold','Other client duplicate plot ID',0,1,'2026-09-24T00:00:00.000Z'),
  ('e2e-details-other','OTHER-ONLY',2000,185.806,222.222,'40 x 50 ft','30 ft road','sold','Other client unique plot ID',0,1,'2026-09-24T00:00:00.000Z')
ON CONFLICT(project_id,id) DO NOTHING;

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
