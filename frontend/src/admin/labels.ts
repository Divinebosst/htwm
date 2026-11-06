/* Plain-language names for permissions, shown on the Staff and My account pages. */

export const PERMISSION_LABELS: Record<string, string> = {
  "dashboard.view": "See the dashboard",
  "events.edit": "Add and edit events",
  "services.edit": "Edit service times",
  "prayer.view": "Read prayer requests",
  "prayer.view_private": "Read private prayer requests",
  "prayer.edit": "Update prayer requests",
  "gifts.view": "See gifts",
  "gifts.edit": "Confirm gifts",
  "giving.edit": "Edit giving categories",
  "settings.view": "See church settings",
  "settings.edit_contact": "Edit contact details",
  "settings.edit_payment": "Edit payment details",
  "users.view": "See staff accounts",
  "users.edit": "Add and manage staff accounts",
  "audit.view": "Read the audit log",
};

export const ROLE_SUMMARY: Record<string, string> = {
  system_admin: "Everything, including payment details and all staff accounts.",
  admin: "Runs the church office: events, gifts, contact details and Pastor or Caretaker accounts.",
  pastor: "Events, service times and every prayer request. Can see gifts.",
  caretaker: "Keeps events and service times up to date.",
};

export function niceField(name: string) {
  const s = name.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
