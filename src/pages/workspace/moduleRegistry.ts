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
  professional: {
    customers: lazy(() => import("@/pages/pro/CustomersPage")),
    events: lazy(() => import("@/pages/pro/ProEventsPage")),
    quotes: lazy(() => import("@/pages/pro/QuotesPage")),
    contracts: lazy(() => import("@/pages/pro/ContractsPage")),
    calendar: lazy(() => import("@/pages/pro/CalendarPage")),
    finance: lazy(() => import("@/pages/pro/FinancePage")),
    suppliers: lazy(() => import("@/pages/personal/SuppliersPage")),
    tasks: lazy(() => import("@/pages/pro/ProTasksPage")),
    catalog: lazy(() => import("@/pages/catalog/CatalogPage")),
    packages: lazy(() => import("@/pages/catalog/PackagesPage")),
  },
  business: {
    // Comunes con Profesional
    customers: lazy(() => import("@/pages/pro/CustomersPage")),
    events: lazy(() => import("@/pages/pro/ProEventsPage")),
    quotes: lazy(() => import("@/pages/pro/QuotesPage")),
    contracts: lazy(() => import("@/pages/pro/ContractsPage")),
    calendar: lazy(() => import("@/pages/pro/CalendarPage")),
    finance: lazy(() => import("@/pages/pro/FinancePage")),
    suppliers: lazy(() => import("@/pages/personal/SuppliersPage")),
    tasks: lazy(() => import("@/pages/pro/ProTasksPage")),
    catalog: lazy(() => import("@/pages/catalog/CatalogPage")),
    packages: lazy(() => import("@/pages/catalog/PackagesPage")),
    // Alquiler e inventario
    inventory: lazy(() => import("@/pages/business/InventoryPage")),
    reservations: lazy(() => import("@/pages/business/RentalsPage")),
    availability: lazy(() => import("@/pages/business/AvailabilityPage")),
    deliveries: lazy(() => import("@/pages/business/DeliveriesPage")),
    returns: lazy(() => import("@/pages/business/ReturnsPage")),
    maintenance: lazy(() => import("@/pages/business/MaintenancePage")),
    team: lazy(() => import("@/pages/business/TeamPage")),
    // Salones y locales
    venues: lazy(() => import("@/pages/venues/VenuesPage")),
    venue_rates: lazy(() => import("@/pages/venues/RatesPage")),
    bookings: lazy(() => import("@/pages/venues/BookingsPage")),
    venue_calendar: lazy(() => import("@/pages/venues/OccupancyPage")),
  },
};

/** En Profesional, estos módulos viven dentro de cada evento (no en el menú principal). */
export const EVENT_SCOPED: Partial<Record<WorkspaceKind, string[]>> = {
  professional: ["guests", "invitations", "seating", "schedule", "budget"],
  business: ["guests", "invitations", "seating", "schedule", "budget"],
};

export const modulePage = (kind: WorkspaceKind, key: string): Page | undefined => MODULE_PAGES[kind]?.[key];
