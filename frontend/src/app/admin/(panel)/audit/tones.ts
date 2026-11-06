import type { Tone } from "@/admin/ui";

export function actionTone(action: string): Tone {
  switch (action) {
    case "create":
      return "ok";
    case "update":
      return "info";
    case "delete":
      return "warn";
    case "login_failed":
    case "access_denied":
      return "bad";
    case "password_change":
    case "password_reset":
      return "violet";
    default:
      return "muted";
  }
}
