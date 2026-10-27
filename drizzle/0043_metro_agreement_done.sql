-- Metro City-only presentation and Agreement Done flag. No plot, sale, geometry, or snapshot edits.
-- Verified tenant identity prevents other projects, including another project named Metro City, from opting in accidentally.
INSERT OR IGNORE INTO project_custom_fields
(project_id,field_key,label,field_type,choices_json,sort_order,required,enabled,updated_at)
SELECT id,'agreement_done','Agreement Done','checkbox','[]',35,0,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM projects WHERE id='c024a562-634d-4e49-b647-43209f6e450b'
AND slug='metro-city-c024a5' AND name='Metro City' AND status='active';

-- Existing completed current stages should show completed on the customer site.
-- Do not infer agreement completion from booked inventory or customer announcement drafts.
INSERT OR IGNORE INTO plot_custom_values
(project_id,plot_id,field_key,field_value,revision,updated_at,updated_by)
SELECT state.project_id,state.plot_id,'agreement_done','true',1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),'metro_agreement_migration'
FROM plot_deal_states state
JOIN plots p ON p.project_id=state.project_id AND p.id=state.plot_id AND p.inventory_active=1
JOIN project_custom_fields f ON f.project_id=state.project_id AND f.field_key='agreement_done' AND f.field_type='checkbox' AND f.enabled=1
JOIN projects project ON project.id=state.project_id
WHERE project.id='c024a562-634d-4e49-b647-43209f6e450b' AND project.slug='metro-city-c024a5'
AND project.name='Metro City' AND project.status='active'
AND state.stage_slug IN ('agreement_done','registered');
