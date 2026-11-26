import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { WorkspaceKind } from "@/lib/types";

type Page = LazyExoticComponent<ComponentType>;

/** Pantallas implementadas por modalidad. Lo demás muestra el aviso de "en desarrollo". */
export const MODULE_PAGES: Partial<Record<WorkspaceKind, Record<string, Page>>> = {
  personal: {
    my_event: lazy(() => import("@/pages/personal/MyEventPage")),
    guests: lazy(() => import("@/pages/personal/GuestsPage")),
    invitations: lazy(() => import("@/pages/personal/InvitationsPage")),
    budget: lazy(() => import("@/pages/personal/BudgetPage")),
    suppliers: lazy(() => import("@/pages/personal/SuppliersPage")),
    seating: lazy(() => import("@/pages/personal/SeatingPage")),
    schedule: lazy(() => import("@/pages/personal/SchedulePage")),
    tasks: lazy(() => import("@/pages/personal/TasksPage")),
    inspiration: lazy(() => import("@/pages/personal/InspirationPage")),
  },
};

export const modulePage = (kind: WorkspaceKind, key: string): Page | undefined => MODULE_PAGES[kind]?.[key];
