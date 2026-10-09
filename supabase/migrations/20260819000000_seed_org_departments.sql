-- Departments are per-organization (organizations.departments). The app now
-- treats an organization's list as authoritative instead of always merging in a
-- hardcoded default list, so make sure no department currently in use by a user
-- disappears from the dropdowns.

-- 1. Organizations with no list at all fall back to the standard set.
UPDATE organizations
SET departments = ARRAY['Management', 'Operations', 'Administration', 'Other']::text[]
WHERE departments IS NULL
   OR cardinality(departments) = 0;

-- 2. Add any department already assigned to a user but missing from its
--    organization's list (case-insensitive match to avoid near-duplicates).
UPDATE organizations o
SET departments = o.departments || missing.depts
FROM (
  SELECT u.organization_id,
         array_agg(DISTINCT btrim(u.department)) AS depts
  FROM users u
  JOIN organizations org ON org.id = u.organization_id
  WHERE u.department IS NOT NULL
    AND btrim(u.department) <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(org.departments) AS d
      WHERE lower(btrim(d)) = lower(btrim(u.department))
    )
  GROUP BY u.organization_id
) AS missing
WHERE o.id = missing.organization_id;
