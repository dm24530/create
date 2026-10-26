-- Canvas billing is disabled. Remove stale admin settings now; the obsolete
-- tables are retained for rolling-deploy compatibility and can be dropped
-- later with scripts/manual/drop_canvas_usage_billing.sql.
DELETE FROM settings
WHERE key IN ('default_canvas_usage_count', 'canvas_usage_enforcement_enabled');
