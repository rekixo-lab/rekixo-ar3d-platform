import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id:text("id").primaryKey(), name:text("name").notNull(), slug:text("slug").notNull().unique(),
  publicHost:text("public_host"), adminHost:text("admin_host"), kind:text("kind").notNull().default("customer"), status:text("status").notNull().default("active"), deletedAt:text("deleted_at"),
  publicStatus:text("public_status").notNull().default("draft"), publishedAt:text("published_at"),
  publishVersion:integer("publish_version").notNull().default(0),
  createdAt:text("created_at").notNull(), updatedAt:text("updated_at").notNull()
},table=>({publicHostUnique:uniqueIndex("projects_public_host_unique").on(table.publicHost),adminHostUnique:uniqueIndex("projects_admin_host_unique").on(table.adminHost)}));

export const projectDomains = sqliteTable("project_domains", {
  host:text("host").primaryKey(),
  projectId:text("project_id").notNull().references(()=>projects.id),
  kind:text("kind").notNull(),
  publicPrimary:integer("public_primary",{mode:"boolean"}).notNull().default(false),
  adminPrimary:integer("admin_primary",{mode:"boolean"}).notNull().default(false),
  status:text("status").notNull().default("active"),
  createdAt:text("created_at").notNull(),
  updatedAt:text("updated_at").notNull()
},table=>({projectKindIndex:index("idx_project_domains_project_kind").on(table.projectId,table.kind,table.status)}));

export const plots = sqliteTable("plots", { projectId:text("project_id").notNull().references(()=>projects.id), id:text("id").notNull(), sqft:real("sqft").notNull(), sqm:real("sqm").notNull(), sqyd:real("sqyd").notNull(), dimensions:text("dimensions").notNull(), road:text("road").notNull(), front:real("front"), depth:real("depth"), back:real("back"), depth2:real("depth2"), dimensionUnit:text("dimension_unit"), frontEdgeIndex:integer("front_edge_index"), depthEdgeIndex:integer("depth_edge_index"), backEdgeIndex:integer("back_edge_index"), depth2EdgeIndex:integer("depth2_edge_index"), frontLabel:text("front_label"), depthLabel:text("depth_label"), backLabel:text("back_label"), depth2Label:text("depth2_label"), sideDimensions:text("side_dimensions"), edgeSemantics:text("edge_semantics"), polygon:text("polygon").notNull().default(""), status:text("status").notNull().default("available"), notes:text("notes").notNull().default(""), featured:integer("featured",{mode:"boolean"}).notNull().default(false), inventoryActive:integer("inventory_active",{mode:"boolean"}).notNull().default(true), updatedAt:text("updated_at").notNull() },table=>({pk:primaryKey({columns:[table.projectId,table.id]})}));

// Private client-admin records are deliberately separate from publicly serialized plots.
// Existing projects need no backfill: an absent row means empty details at revision 0.
export const plotAdminDetails = sqliteTable("plot_admin_details", {
  projectId:text("project_id").notNull(),
  plotId:text("plot_id").notNull(),
  ownerName:text("owner_name"),
  bookingAmountPaise:integer("booking_amount_paise"),
  currency:text("currency").notNull().default("INR"),
  brokerName:text("broker_name"),
  revision:integer("revision").notNull().default(1),
  updatedAt:text("updated_at").notNull(),
  updatedBy:text("updated_by").notNull()
},table=>({
  pk:primaryKey({columns:[table.projectId,table.plotId]}),
  plotForeignKey:foreignKey({columns:[table.projectId,table.plotId],foreignColumns:[plots.projectId,plots.id]}).onDelete("restrict").onUpdate("restrict"),
  ownerLength:check("plot_admin_details_owner_length",sql`${table.ownerName} IS NULL OR length(${table.ownerName}) <= 120`),
  brokerLength:check("plot_admin_details_broker_length",sql`${table.brokerName} IS NULL OR length(${table.brokerName}) <= 120`),
  amountBounds:check("plot_admin_details_amount_bounds",sql`${table.bookingAmountPaise} IS NULL OR (typeof(${table.bookingAmountPaise}) = 'integer' AND ${table.bookingAmountPaise} BETWEEN 0 AND 1000000000000)`),
  currencyInr:check("plot_admin_details_currency_inr",sql`${table.currency} = 'INR'`),
  revisionPositive:check("plot_admin_details_revision_positive",sql`typeof(${table.revision}) = 'integer' AND ${table.revision} BETWEEN 1 AND 9007199254740991`)
}));
export const plotEdgeMeasurements = sqliteTable("plot_edge_measurements", {
  projectId:text("project_id").notNull().references(()=>projects.id),
  plotId:text("plot_id").notNull(),
  role:text("role").notNull(),
  segmentIndex:integer("segment_index").notNull().default(0),
  edgeIndex:integer("edge_index"),
  pointCount:integer("point_count"),
  length:real("length"),
  unit:text("unit"),
  rawLabel:text("raw_label"),
  roadFrontage:integer("road_frontage",{mode:"boolean"}).notNull().default(false),
  roadAccess:text("road_access"),
  sourceRef:text("source_ref"),
  sourceRawText:text("source_raw_text"),
  confidence:text("confidence").notNull().default("high"),
  verified:integer("verified",{mode:"boolean"}).notNull().default(false),
  updatedAt:text("updated_at").notNull()
},table=>({
  pk:primaryKey({columns:[table.projectId,table.plotId,table.role,table.segmentIndex]}),
  projectPlotIndex:index("idx_plot_edge_measurements_project_plot").on(table.projectId,table.plotId)
}));

export const settings = sqliteTable("settings", { projectId:text("project_id").notNull().references(()=>projects.id), key:text("key").notNull(), value:text("value").notNull(), updatedAt:text("updated_at").notNull() },table=>({pk:primaryKey({columns:[table.projectId,table.key]})}));

export const projectPublicSnapshots = sqliteTable("project_public_snapshots", {
  projectId:text("project_id").primaryKey().references(()=>projects.id,{onDelete:"cascade"}),
  publishVersion:integer("publish_version").notNull(),
  projectName:text("project_name").notNull(),
  engineProjectId:text("engine_project_id"),
  engineSlug:text("engine_slug"),
  engineLinkStatus:text("engine_link_status"),
  enginePublicEnabled:integer("engine_public_enabled",{mode:"boolean"}).notNull().default(false),
  enginePublicUrl:text("engine_public_url"),
  createdAt:text("created_at").notNull()
});

export const publishedPlots = sqliteTable("published_plots", {
  projectId:text("project_id").notNull().references(()=>projects.id,{onDelete:"cascade"}),
  id:text("id").notNull(),
  sqft:real("sqft").notNull(),
  sqm:real("sqm").notNull(),
  sqyd:real("sqyd").notNull(),
  dimensions:text("dimensions").notNull(),
  road:text("road").notNull(),
  front:real("front"),
  depth:real("depth"),
  back:real("back"),
  depth2:real("depth2"),
  dimensionUnit:text("dimension_unit"),
  frontEdgeIndex:integer("front_edge_index"),
  depthEdgeIndex:integer("depth_edge_index"),
  backEdgeIndex:integer("back_edge_index"),
  depth2EdgeIndex:integer("depth2_edge_index"),
  frontLabel:text("front_label"),
  depthLabel:text("depth_label"),
  backLabel:text("back_label"),
  depth2Label:text("depth2_label"),
  sideDimensions:text("side_dimensions"),
  edgeSemantics:text("edge_semantics"),
  polygon:text("polygon").notNull().default(""),
  status:text("status").notNull().default("available"),
  featured:integer("featured",{mode:"boolean"}).notNull().default(false),
  updatedAt:text("updated_at")
},table=>({pk:primaryKey({columns:[table.projectId,table.id]})}));

export const publishedPlotEdgeMeasurements = sqliteTable("published_plot_edge_measurements", {
  projectId:text("project_id").notNull().references(()=>projects.id,{onDelete:"cascade"}),
  plotId:text("plot_id").notNull(),
  role:text("role").notNull(),
  segmentIndex:integer("segment_index").notNull().default(0),
  edgeIndex:integer("edge_index"),
  pointCount:integer("point_count"),
  length:real("length"),
  unit:text("unit"),
  rawLabel:text("raw_label"),
  roadFrontage:integer("road_frontage",{mode:"boolean"}).notNull().default(false),
  roadAccess:text("road_access")
},table=>({
  pk:primaryKey({columns:[table.projectId,table.plotId,table.role,table.segmentIndex]}),
  projectPlotIndex:index("idx_published_edge_measurements_project_plot").on(table.projectId,table.plotId)
}));

export const publishedSettings = sqliteTable("published_settings", {
  projectId:text("project_id").notNull().references(()=>projects.id,{onDelete:"cascade"}),
  key:text("key").notNull(),
  value:text("value").notNull()
},table=>({pk:primaryKey({columns:[table.projectId,table.key]})}));

export const plotPricing = sqliteTable("plot_pricing", {
  projectId:text("project_id").notNull().references(()=>projects.id),
  plotId:text("plot_id").notNull(),
  pricingType:text("pricing_type").notNull().default("rate"),
  unit:text("unit").notNull().default("sqyd"),
  rate:real("rate"),
  fixedPrice:real("fixed_price"),
  currency:text("currency").notNull().default("INR"),
  updatedAt:text("updated_at").notNull()
},table=>({
  pk:primaryKey({columns:[table.projectId,table.plotId]}),
  projectIndex:index("idx_plot_pricing_project").on(table.projectId)
}));
export const gallery = sqliteTable("gallery", { projectId:text("project_id").notNull().references(()=>projects.id), id:text("id").notNull(), objectKey:text("object_key").notNull().unique(), filename:text("filename").notNull(), contentType:text("content_type").notNull(), caption:text("caption").notNull().default(""), sortOrder:integer("sort_order").notNull().default(0), createdAt:text("created_at").notNull() },table=>({pk:primaryKey({columns:[table.projectId,table.id]})}));
export const loginAttempts = sqliteTable("login_attempts", { key:text("key").primaryKey(), attempts:integer("attempts").notNull().default(0), windowStart:integer("window_start").notNull() });
export const adminUsers = sqliteTable("admin_users", {
  id:text("id").primaryKey(), email:text("email").notNull().unique(), name:text("name").notNull(),
  loginType:text("login_type").notNull().default("email"),
  loginId:text("login_id"),
  mobile:text("mobile"),
  projectId:text("project_id").notNull().references(()=>projects.id),
  role:text("role").notNull().default("client_admin"), passwordHash:text("password_hash").notNull(),
  passwordSalt:text("password_salt").notNull(), status:text("status").notNull().default("active"),
  mustChangePassword:integer("must_change_password",{mode:"boolean"}).notNull().default(true),
  sessionVersion:integer("session_version").notNull().default(1), passwordChangedAt:text("password_changed_at"),
  createdAt:text("created_at").notNull(), updatedAt:text("updated_at").notNull(), lastLoginAt:text("last_login_at")
},table=>({
  loginIdIndex:uniqueIndex("idx_admin_users_login_id").on(table.loginId),
  mobileIndex:index("idx_admin_users_mobile").on(table.mobile)
}));
export const projectMemberships = sqliteTable("project_memberships", {
  userId:text("user_id").notNull().references(()=>adminUsers.id),
  projectId:text("project_id").notNull().references(()=>projects.id),
  role:text("role").notNull().default("client_admin"),
  status:text("status").notNull().default("active"),
  isPrimary:integer("is_primary",{mode:"boolean"}).notNull().default(false),
  createdAt:text("created_at").notNull(), updatedAt:text("updated_at").notNull()
},table=>({pk:primaryKey({columns:[table.userId,table.projectId]}),projectStatusIndex:index("idx_project_memberships_project_status").on(table.projectId,table.status)}));
export const auditLogs = sqliteTable("audit_logs", {
  id:text("id").primaryKey(), actorId:text("actor_id").notNull(), actorEmail:text("actor_email").notNull(),
  action:text("action").notNull(), projectId:text("project_id"), targetId:text("target_id"), details:text("details").notNull().default("{}"), createdAt:text("created_at").notNull()
},table=>({projectCreatedIndex:index("idx_audit_logs_project_created").on(table.projectId,table.createdAt)}));

// Mirrors the already-applied additive migration 0009_rekixo_geo_mapper.sql.
// No core project/plot table is altered by these declarations.
export const geoProjectSettings = sqliteTable("geo_project_settings", {
  projectId:text("project_id").primaryKey(),
  draftRevision:integer("draft_revision").notNull().default(0),
  publishedRevision:integer("published_revision").notNull().default(0),
  publicEnabled:integer("public_enabled",{mode:"boolean"}).notNull().default(false),
  publishedAt:text("published_at"),
  updatedAt:text("updated_at").notNull()
});
export const geoControlPoints = sqliteTable("geo_control_points", {
  projectId:text("project_id").notNull(), id:text("id").notNull(),
  sourceX:real("source_x").notNull(), sourceY:real("source_y").notNull(),
  longitude:real("longitude").notNull(), latitude:real("latitude").notNull(),
  label:text("label").notNull().default(""), sortOrder:integer("sort_order").notNull().default(0),
  updatedAt:text("updated_at").notNull()
},table=>({pk:primaryKey({columns:[table.projectId,table.id]}),projectSortIndex:index("idx_geo_control_points_project_sort").on(table.projectId,table.sortOrder)}));
export const geoFeatures = sqliteTable("geo_features", {
  projectId:text("project_id").notNull(), id:text("id").notNull(), name:text("name").notNull().default(""),
  layer:text("layer").notNull().default("default"), geometryType:text("geometry_type").notNull(), geometry:text("geometry").notNull(),
  linkedPlotId:text("linked_plot_id"), source:text("source").notNull().default("manual"), properties:text("properties").notNull().default("{}"),
  updatedAt:text("updated_at").notNull()
},table=>({pk:primaryKey({columns:[table.projectId,table.id]}),projectLayerIndex:index("idx_geo_features_project_layer").on(table.projectId,table.layer,table.name),projectPlotIndex:index("idx_geo_features_project_plot").on(table.projectId,table.linkedPlotId)}));
export const geoSources = sqliteTable("geo_sources", {
  projectId:text("project_id").notNull(), id:text("id").notNull(), filename:text("filename").notNull(), contentType:text("content_type").notNull(),
  sizeBytes:integer("size_bytes").notNull(), sha256:text("sha256").notNull(), objectKey:text("object_key").notNull(), createdAt:text("created_at").notNull()
},table=>({pk:primaryKey({columns:[table.projectId,table.id]}),projectCreatedIndex:index("idx_geo_sources_project_created").on(table.projectId,table.createdAt)}));
export const geoVersions = sqliteTable("geo_versions", {
  projectId:text("project_id").notNull(), version:integer("version").notNull(), snapshot:text("snapshot").notNull(), createdAt:text("created_at").notNull()
},table=>({pk:primaryKey({columns:[table.projectId,table.version]}),projectCreatedIndex:index("idx_geo_versions_project_created").on(table.projectId,table.createdAt)}));


// Global platform configuration, isolated from per-project settings.
// The Google Maps browser key is intentionally platform-scoped because one restricted
// browser key powers Super Admin Geo Labs across current and future client projects.
export const platformSettings = sqliteTable("platform_settings", {
  key:text("key").primaryKey(),
  value:text("value").notNull(),
  updatedAt:text("updated_at").notNull(),
  updatedBy:text("updated_by").notNull().default("")
});


// Cross-repository Rekixo AR3D integration metadata only.
// Engine model/scene data stays in the isolated rekixo-3d-production D1.
export const project3dLinks = sqliteTable("project_3d_links", {
  platformProjectId:text("platform_project_id").primaryKey().references(()=>projects.id,{onDelete:"cascade"}),
  engineProjectId:text("engine_project_id").notNull(),
  engineSlug:text("engine_slug").notNull(),
  status:text("status").notNull().default("active"),
  publicEnabled:integer("public_enabled",{mode:"boolean"}).notNull().default(false),
  publicUrl:text("public_url").notNull(),
  updatedBy:text("updated_by").notNull().default(""),
  createdAt:text("created_at").notNull(),
  updatedAt:text("updated_at").notNull()
},table=>({
  engineProjectUnique:uniqueIndex("project_3d_links_engine_project_unique").on(table.engineProjectId),
  engineSlugUnique:uniqueIndex("project_3d_links_engine_slug_unique").on(table.engineSlug),
  statusIndex:index("project_3d_links_status").on(table.status,table.publicEnabled)
}));


// Project Admin Studio — additive private configuration. Never part of public plot snapshots.
export const projectAdminFeatures = sqliteTable("project_admin_features",{
  projectId:text("project_id").notNull().references(()=>projects.id,{onDelete:"restrict"}),
  featureKey:text("feature_key").notNull(),
  enabled:integer("enabled").notNull().default(0),
  updatedAt:text("updated_at").notNull()
},t=>({pk:primaryKey({columns:[t.projectId,t.featureKey]})}));
export const projectDealStages=sqliteTable("project_deal_stages",{
  projectId:text("project_id").notNull().references(()=>projects.id,{onDelete:"restrict"}),
  slug:text("slug").notNull(),
  label:text("label").notNull(),
  sortOrder:integer("sort_order").notNull().default(0),
  enabled:integer("enabled").notNull().default(1),
  requiresSale:integer("requires_sale").notNull().default(0),
  updatedAt:text("updated_at").notNull()
},t=>({pk:primaryKey({columns:[t.projectId,t.slug]})}));
export const plotDealStates=sqliteTable("plot_deal_states",{
  projectId:text("project_id").notNull(),
  plotId:text("plot_id").notNull(),
  stageSlug:text("stage_slug"),
  holdUntil:text("hold_until"),
  note:text("note").notNull().default(""),
  revision:integer("revision").notNull().default(1),
  updatedAt:text("updated_at").notNull(),
  updatedBy:text("updated_by").notNull()
},t=>({
  pk:primaryKey({columns:[t.projectId,t.plotId]}),
  plotFk:foreignKey({columns:[t.projectId,t.plotId],foreignColumns:[plots.projectId,plots.id]}).onDelete("restrict"),
  stageFk:foreignKey({columns:[t.projectId,t.stageSlug],foreignColumns:[projectDealStages.projectId,projectDealStages.slug]}).onDelete("restrict")
}));
export const plotDealEvents=sqliteTable("plot_deal_events",{
  projectId:text("project_id").notNull(),id:text("id").notNull(),
  plotId:text("plot_id").notNull(),previousStage:text("previous_stage"),
  nextStage:text("next_stage"),note:text("note").notNull().default(""),
  holdUntil:text("hold_until"),actorId:text("actor_id").notNull(),
  createdAt:text("created_at").notNull()
},t=>({
  pk:primaryKey({columns:[t.projectId,t.id]}),
  plotFk:foreignKey({columns:[t.projectId,t.plotId],foreignColumns:[plots.projectId,plots.id]}).onDelete("restrict"),
  history:index("idx_plot_deal_events_history").on(t.projectId,t.plotId,t.createdAt)
}));
export const projectCustomFields=sqliteTable("project_custom_fields",{
  projectId:text("project_id").notNull().references(()=>projects.id,{onDelete:"restrict"}),
  fieldKey:text("field_key").notNull(),label:text("label").notNull(),
  fieldType:text("field_type").notNull(),choicesJson:text("choices_json").notNull().default("[]"),
  sortOrder:integer("sort_order").notNull().default(0),
  required:integer("required").notNull().default(0),
  enabled:integer("enabled").notNull().default(1),
  updatedAt:text("updated_at").notNull()
},t=>({pk:primaryKey({columns:[t.projectId,t.fieldKey]})}));
export const plotCustomValues=sqliteTable("plot_custom_values",{
  projectId:text("project_id").notNull(),plotId:text("plot_id").notNull(),
  fieldKey:text("field_key").notNull(),fieldValue:text("field_value").notNull(),
  revision:integer("revision").notNull().default(1),
  updatedAt:text("updated_at").notNull(),updatedBy:text("updated_by").notNull()
},t=>({
  pk:primaryKey({columns:[t.projectId,t.plotId,t.fieldKey]}),
  plotFk:foreignKey({columns:[t.projectId,t.plotId],foreignColumns:[plots.projectId,plots.id]}).onDelete("restrict"),
  fieldFk:foreignKey({columns:[t.projectId,t.fieldKey],foreignColumns:[projectCustomFields.projectId,projectCustomFields.fieldKey]}).onDelete("restrict"),
  plotIndex:index("idx_plot_custom_values_plot").on(t.projectId,t.plotId)
}));


export const projectPlotNoticeSettings=sqliteTable("project_plot_notice_settings",{
  projectId:text("project_id").primaryKey().references(()=>projects.id,{onDelete:"restrict"}),
  enabled:integer("enabled").notNull().default(0),updatedAt:text("updated_at").notNull()
});
export const projectPlotNotices=sqliteTable("project_plot_notices",{
  projectId:text("project_id").notNull().references(()=>projects.id,{onDelete:"restrict"}),
  id:text("id").notNull(),eventDate:text("event_date").notNull(),
  category:text("category").notNull(),label:text("label").notNull(),
  plotIdsJson:text("plot_ids_json").notNull(),
  state:text("state").notNull().default("draft"),source:text("source").notNull(),
  sourceEventId:text("source_event_id"),createdBy:text("created_by").notNull(),
  createdAt:text("created_at").notNull(),publishedAt:text("published_at"),
  updatedAt:text("updated_at").notNull()
},t=>({
  pk:primaryKey({columns:[t.projectId,t.id]}),
  sourceEventUnique:uniqueIndex("project_plot_notice_source_unique").on(t.projectId,t.sourceEventId),
  publicIndex:index("idx_project_plot_notices_public").on(t.projectId,t.state,t.eventDate,t.createdAt)
}));
