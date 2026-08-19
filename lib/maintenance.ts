import type { BadgeTone } from "@/components/ui";

/**
 * What the product knows about a maintenance request's state, in one place.
 *
 * These three facts were written out three times each — the sidebar badge counted one way, the
 * tenant's screen counted another, and the office and the tenant coloured the same status from
 * separate ternaries. Nothing had drifted yet, which is exactly when to stop.
 */

/** A request that still needs someone: what the sidebar badge counts, and the tenant follows up on. */
export const MAINTENANCE_OPEN_STATUSES = ["open", "in_progress"] as const;

/** Every state a request can be in — the list the office's status control offers. */
export const MAINTENANCE_STATUSES = ["open", "in_progress", "resolved", "cancelled"] as const;

export const isMaintenanceOpen = (status: string): boolean =>
  (MAINTENANCE_OPEN_STATUSES as readonly string[]).includes(status);

const STATUS_TONE: Record<string, BadgeTone> = {
  open: "warning",
  in_progress: "info",
  resolved: "success",
  cancelled: "neutral",
};

const URGENCY_TONE: Record<string, BadgeTone> = {
  emergency: "danger",
  urgent: "warning",
  normal: "neutral",
};

/** The office and the tenant must see one colour for one status, or they are reading two systems. */
export const maintenanceStatusTone = (status: string): BadgeTone => STATUS_TONE[status] ?? "neutral";
export const maintenanceUrgencyTone = (urgency: string): BadgeTone => URGENCY_TONE[urgency] ?? "neutral";
