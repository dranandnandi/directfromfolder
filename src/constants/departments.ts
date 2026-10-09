export const DEFAULT_DEPARTMENTS = ['Management', 'Operations', 'Administration', 'Other'];

const normalize = (departments?: string[] | null) =>
  Array.from(
    new Map(
      (departments || [])
        .map((dept) => (dept || '').trim())
        .filter(Boolean)
        .map((dept) => [dept.toLowerCase(), dept])
    ).values()
  );

/**
 * Departments are configured per organization (organizations.departments).
 * The defaults are only a fallback for organizations that have not set up
 * their own list yet — once an organization has departments, its list wins so
 * admins can fully add/rename/remove them from Settings > Organization.
 */
export const withDefaultDepartments = (departments?: string[] | null) => {
  const configured = normalize(departments);
  return configured.length > 0 ? configured : [...DEFAULT_DEPARTMENTS];
};

export const normalizeDepartments = normalize;
