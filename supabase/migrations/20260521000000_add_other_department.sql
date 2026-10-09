ALTER TABLE organizations
  ALTER COLUMN departments SET DEFAULT ARRAY['Management', 'Medical', 'Nursing', 'Other']::text[];

UPDATE organizations
SET departments = array_append(departments, 'Other')
WHERE departments IS NOT NULL
  AND NOT ('Other' = ANY(departments));
