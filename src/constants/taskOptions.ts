/**
 * Task classification options (visit/round types, follow-up types, task
 * categories) are configured per organization on the `organizations` row
 * (round_types, follow_up_types, advisory_types) and edited from
 * Settings > Organization.
 *
 * The defaults below are industry-neutral fallbacks used only when an
 * organization has not configured its own list yet. The column names keep
 * their historical names (round_type / advisory_type) for compatibility with
 * existing rows, but the UI labels are generic.
 */
export const DEFAULT_ROUND_TYPES = [
  'Scheduled Visit',
  'Follow-up Visit',
  'Urgent Visit',
  'Site Inspection',
  'Consultation',
];

export const DEFAULT_FOLLOW_UP_TYPES = [
  'Progress Update',
  'Issue Resolution',
  'Report Review',
  'General Check-in',
];

export const DEFAULT_ADVISORY_TYPES = [
  'General',
  'Administrative',
  'Communication',
  'Policy',
  'Safety',
  'Urgent',
];

/** UI labels for the three lists (DB column names stay unchanged). */
export const TASK_OPTION_LABELS = {
  roundTypes: 'Visit Type',
  followUpTypes: 'Follow-up Type',
  advisoryTypes: 'Task Category',
} as const;

const normalize = (values?: string[] | null) =>
  Array.from(
    new Map(
      (values || [])
        .map((value) => (value || '').trim())
        .filter(Boolean)
        .map((value) => [value.toLowerCase(), value])
    ).values()
  );

export const normalizeTaskOptions = normalize;

const withDefaults = (values: string[] | null | undefined, defaults: string[]) => {
  const configured = normalize(values);
  return configured.length > 0 ? configured : [...defaults];
};

export const withDefaultRoundTypes = (values?: string[] | null) =>
  withDefaults(values, DEFAULT_ROUND_TYPES);

export const withDefaultFollowUpTypes = (values?: string[] | null) =>
  withDefaults(values, DEFAULT_FOLLOW_UP_TYPES);

export const withDefaultAdvisoryTypes = (values?: string[] | null) =>
  withDefaults(values, DEFAULT_ADVISORY_TYPES);

/**
 * Options for a <select>: the organization's list plus the currently stored
 * value (if any) so that editing an older task never silently drops a value
 * that is no longer in the configured list.
 */
export const optionsWithCurrent = (options: string[], current?: string | null) => {
  const value = (current || '').trim();
  if (!value) return options;
  const exists = options.some((option) => option.toLowerCase() === value.toLowerCase());
  return exists ? options : [...options, value];
};
