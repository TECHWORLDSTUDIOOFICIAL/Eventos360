export type WorkspaceKind = "personal" | "professional" | "business";
export type MemberRole = "owner" | "admin" | "manager" | "staff" | "viewer" | "collaborator";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "suspended" | "canceled";
export type AccessCodePurpose = "signup" | "renewal" | "platform_admin";
export type PlatformRole = "owner" | "admin" | "support";

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  phone: string | null;
  must_change_password: boolean;
  is_disabled: boolean;
}

export interface MyWorkspace {
  id: string;
  kind: WorkspaceKind;
  name: string;
  role: MemberRole;
  is_disabled: boolean;
  subscription_status: SubscriptionStatus | null;
  period_end: string | null;
  plan_name: string | null;
  primary_specialty: string | null;
}

export interface WorkspaceModule {
  module_key: string;
  label: string;
  sort: number;
}

export interface Plan {
  id: string;
  key: string;
  kind: WorkspaceKind;
  name: string;
  description: string | null;
  price: number;
  currency_code: string;
  duration_days: number;
  is_active: boolean;
  is_public: boolean;
  sort: number;
}

export interface Feature {
  key: string;
  name: string;
  description: string | null;
  value_type: "boolean" | "limit";
  sort: number;
}

export interface PlanEntitlement {
  plan_id: string;
  feature_key: string;
  is_enabled: boolean;
  limit_value: number | null;
}

export interface Specialty {
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
}
