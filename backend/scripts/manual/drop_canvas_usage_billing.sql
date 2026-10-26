-- Run only after all old application instances and cached canvas pages have
-- been replaced. The application no longer reads or writes these tables.
DROP TABLE IF EXISTS canvas_usage_reservations;
DROP TABLE IF EXISTS canvas_usage_plans;
