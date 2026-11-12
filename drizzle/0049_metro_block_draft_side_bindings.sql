-- METRO CITY additive side binding storage; canonical plot measurements/statuses untouched.
ALTER TABLE metro_block_plot_maps ADD COLUMN side_bindings TEXT NOT NULL DEFAULT '';
ALTER TABLE metro_block_published_maps ADD COLUMN side_bindings TEXT NOT NULL DEFAULT '';
