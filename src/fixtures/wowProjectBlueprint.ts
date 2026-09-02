import type { Entity, Relationship } from "../domain/model";

export type CompanyBlueprintFixture = {
  companyName: string;
  companySummary: string;
  entities: Array<{
    ref: string;
    name: string;
    type: Entity["type"];
    description: string;
    role?: string;
    team?: string;
    critical: boolean;
  }>;
  relationships: Array<{
    fromRef: string;
    toRef: string;
    type: Relationship["type"];
    group?: string;
    label?: string;
  }>;
};

export const wowProjectBlueprint: CompanyBlueprintFixture = {
  companyName: "Wow Project",
  companySummary:
    "A three-location beauty-salon network in Barcelona. Central operations coordinate appointments, payments, client records, staffing, stock, opening access, incident response, and recovery while each salon retains an accountable local manager and documented fallbacks.",
  entities: [
    {
      ref: "founder",
      name: "Sofia Moreno",
      type: "person",
      role: "Founder",
      team: "Leadership",
      description:
        "Owns commercial policy and is one of two payout-account approvers.",
      critical: true,
    },
    {
      ref: "ops-lead",
      name: "Elena Ruiz",
      type: "person",
      role: "Regional operations lead",
      team: "Operations",
      description:
        "Coordinates continuity, location managers, staffing, and supplier escalation.",
      critical: true,
    },
    {
      ref: "finance-lead",
      name: "Mateo Costa",
      type: "person",
      role: "Finance lead",
      team: "Finance",
      description:
        "Reconciles salon payouts and maintains payment-provider access.",
      critical: true,
    },
    {
      ref: "systems-admin",
      name: "Imani Vidal",
      type: "person",
      role: "Systems administrator",
      team: "Operations",
      description:
        "Administers booking, client-record, scheduling, and recovery access.",
      critical: true,
    },
    {
      ref: "central-manager",
      name: "Lucia Ferrer",
      type: "person",
      role: "Central salon manager",
      team: "Salon management",
      description:
        "Runs the Central salon and holds one part of its opening-key custody.",
      critical: true,
    },
    {
      ref: "gracia-manager",
      name: "Carla Navarro",
      type: "person",
      role: "Gracia salon manager",
      team: "Salon management",
      description:
        "Runs the Gracia salon and can cover another location's opening routine.",
      critical: true,
    },
    {
      ref: "eixample-manager",
      name: "Nora Pujol",
      type: "person",
      role: "Eixample salon manager",
      team: "Salon management",
      description:
        "Runs the Eixample salon and maintains local incident readiness.",
      critical: true,
    },
    {
      ref: "floating-manager",
      name: "Amir Soler",
      type: "person",
      role: "Floating duty manager",
      team: "Salon management",
      description:
        "Provides scheduled cross-location management and same-day absence cover.",
      critical: false,
    },
    {
      ref: "front-desk-team",
      name: "Front desk team",
      type: "team",
      description:
        "Shared reception team that books visits, receives clients, and closes checkout.",
      critical: true,
    },
    {
      ref: "stylist-team",
      name: "Stylist team",
      type: "team",
      description:
        "Cross-location service team whose availability drives appointment capacity.",
      critical: true,
    },
    {
      ref: "continuity-team",
      name: "Continuity response team",
      type: "team",
      description:
        "Operations, systems, and duty-management group activated during disruption.",
      critical: true,
    },
    {
      ref: "central-salon",
      name: "Wow Central",
      type: "location",
      description:
        "Flagship salon with eight chairs, product stock, reception, and a staff entrance.",
      critical: true,
    },
    {
      ref: "gracia-salon",
      name: "Wow Gracia",
      type: "location",
      description:
        "Neighbourhood salon with six chairs and its own local opening procedure.",
      critical: true,
    },
    {
      ref: "eixample-salon",
      name: "Wow Eixample",
      type: "location",
      description:
        "High-volume salon with extended hours and a separate network connection.",
      critical: true,
    },
    {
      ref: "booking-pos",
      name: "Booking and point-of-sale",
      type: "service",
      description:
        "Shared appointment calendar, deposits, checkout, refunds, and service catalogue.",
      critical: true,
    },
    {
      ref: "client-records",
      name: "Client records",
      type: "service",
      description:
        "Stores consultation notes, treatment history, consent, and contact preferences.",
      critical: true,
    },
    {
      ref: "staff-scheduling",
      name: "Staff scheduling",
      type: "service",
      description:
        "Publishes shifts, availability, leave, cross-location cover, and manager duty.",
      critical: true,
    },
    {
      ref: "inventory-system",
      name: "Inventory control",
      type: "service",
      description:
        "Tracks professional products, retail stock, minimum levels, and reorder status.",
      critical: true,
    },
    {
      ref: "identity-vault",
      name: "Shared access vault",
      type: "service",
      description:
        "Stores role-based operational credentials without exposing secret values in this map.",
      critical: true,
    },
    {
      ref: "product-supplier",
      name: "Professional product supplier",
      type: "vendor",
      description:
        "Primary supplier for colour, treatment, hygiene, and retail product stock.",
      critical: true,
    },
    {
      ref: "payment-processor",
      name: "Payment processor",
      type: "vendor",
      description:
        "Processes card transactions, refunds, deposits, and settlement reports.",
      critical: true,
    },
    {
      ref: "telecom-provider",
      name: "Telecom provider",
      type: "vendor",
      description:
        "Provides primary broadband for the three salons and central monitoring.",
      critical: true,
    },
    {
      ref: "booking-admin",
      name: "Booking administrator account",
      type: "account",
      description:
        "Role account for configuration, refunds, exports, and staff permissions.",
      critical: true,
    },
    {
      ref: "payout-account",
      name: "Payout account",
      type: "account",
      description:
        "Receives provider settlements and exposes reconciliation statements.",
      critical: true,
    },
    {
      ref: "continuity-playbook",
      name: "Salon continuity playbook",
      type: "document",
      description:
        "Versioned opening, service-outage, staff-cover, customer-message, and escalation steps.",
      critical: true,
    },
    {
      ref: "key-register",
      name: "Physical key register",
      type: "document",
      description:
        "Records key custody, seal numbers, permitted handovers, and latest review date.",
      critical: true,
    },
    {
      ref: "recovery-runbook",
      name: "Client-data recovery runbook",
      type: "document",
      description:
        "Describes backup ownership, restore order, validation, and privacy escalation.",
      critical: true,
    },
    {
      ref: "incident-channel",
      name: "Incident coordination channel",
      type: "communication-channel",
      description:
        "Shared operational channel for managers, systems, finance, and customer-response decisions.",
      critical: true,
    },
    {
      ref: "customer-updates",
      name: "Customer update channel",
      type: "communication-channel",
      description:
        "Approved SMS and email path for appointment disruption and recovery notices.",
      critical: true,
    },
    {
      ref: "dual-custody-keys",
      name: "Dual-custody key sets",
      type: "recovery-mechanism",
      description:
        "Sealed spare keys split between regional operations and the floating duty manager.",
      critical: true,
    },
    {
      ref: "backup-internet",
      name: "Backup mobile internet",
      type: "recovery-mechanism",
      description:
        "Tested mobile routers allow booking, checkout, and incident coordination during broadband loss.",
      critical: true,
    },
    {
      ref: "offline-ledger",
      name: "Offline appointment ledger",
      type: "recovery-mechanism",
      description:
        "Printed daily schedule and numbered payment log support controlled offline operation.",
      critical: true,
    },
    {
      ref: "booking-workflow",
      name: "Book and check out a visit",
      type: "workflow",
      description:
        "Takes an appointment from availability and consent through payment and receipt.",
      critical: true,
    },
    {
      ref: "opening-workflow",
      name: "Open a salon",
      type: "workflow",
      description:
        "Opens the premises, confirms staffing and systems, and releases the first appointments.",
      critical: true,
    },
    {
      ref: "closing-workflow",
      name: "Close a salon",
      type: "workflow",
      description:
        "Closes tills, secures client records and premises, and records unresolved exceptions.",
      critical: true,
    },
    {
      ref: "staff-cover-workflow",
      name: "Arrange same-day staff cover",
      type: "workflow",
      description:
        "Rebalances appointments and qualified staff across locations after an absence.",
      critical: true,
    },
    {
      ref: "stock-workflow",
      name: "Restock salon products",
      type: "workflow",
      description:
        "Reviews minimum levels, approves an order, receives stock, and updates availability.",
      critical: true,
    },
    {
      ref: "incident-workflow",
      name: "Coordinate an operational incident",
      type: "workflow",
      description:
        "Establishes command, assesses impact, informs salons and clients, and records recovery.",
      critical: true,
    },
    {
      ref: "payout-workflow",
      name: "Reconcile payouts and refunds",
      type: "workflow",
      description:
        "Matches settlements to sales, resolves refund exceptions, and approves the monthly close.",
      critical: true,
    },
    {
      ref: "data-recovery-workflow",
      name: "Recover client and booking data",
      type: "workflow",
      description:
        "Restores service data in a documented order and validates access before reopening.",
      critical: true,
    },
  ],
  relationships: [
    {
      fromRef: "central-salon",
      toRef: "central-manager",
      type: "owned-by",
      group: "location-owner",
      label: "local manager",
    },
    {
      fromRef: "central-salon",
      toRef: "floating-manager",
      type: "owned-by",
      group: "location-owner",
      label: "scheduled manager cover",
    },
    {
      fromRef: "gracia-salon",
      toRef: "gracia-manager",
      type: "owned-by",
      group: "location-owner",
      label: "local manager",
    },
    {
      fromRef: "gracia-salon",
      toRef: "floating-manager",
      type: "owned-by",
      group: "location-owner",
      label: "scheduled manager cover",
    },
    {
      fromRef: "eixample-salon",
      toRef: "eixample-manager",
      type: "owned-by",
      group: "location-owner",
      label: "local manager",
    },
    {
      fromRef: "eixample-salon",
      toRef: "floating-manager",
      type: "owned-by",
      group: "location-owner",
      label: "scheduled manager cover",
    },
    {
      fromRef: "booking-pos",
      toRef: "booking-admin",
      type: "administered-by",
      group: "platform-admin",
      label: "role account",
    },
    {
      fromRef: "booking-pos",
      toRef: "systems-admin",
      type: "administered-by",
      group: "platform-admin",
      label: "named administrator",
    },
    {
      fromRef: "client-records",
      toRef: "systems-admin",
      type: "administered-by",
      group: "records-admin",
      label: "primary administrator",
    },
    {
      fromRef: "client-records",
      toRef: "ops-lead",
      type: "administered-by",
      group: "records-admin",
      label: "continuity administrator",
    },
    {
      fromRef: "staff-scheduling",
      toRef: "ops-lead",
      type: "administered-by",
      group: "schedule-admin",
      label: "primary administrator",
    },
    {
      fromRef: "staff-scheduling",
      toRef: "floating-manager",
      type: "administered-by",
      group: "schedule-admin",
      label: "duty fallback",
    },
    {
      fromRef: "inventory-system",
      toRef: "ops-lead",
      type: "administered-by",
      group: "inventory-admin",
      label: "primary administrator",
    },
    {
      fromRef: "inventory-system",
      toRef: "central-manager",
      type: "administered-by",
      group: "inventory-admin",
      label: "location fallback",
    },
    {
      fromRef: "identity-vault",
      toRef: "systems-admin",
      type: "administered-by",
      group: "vault-admin",
      label: "primary administrator",
    },
    {
      fromRef: "identity-vault",
      toRef: "ops-lead",
      type: "administered-by",
      group: "vault-admin",
      label: "recovery administrator",
    },
    {
      fromRef: "booking-admin",
      toRef: "identity-vault",
      type: "stored-in",
      group: "credential-store",
      label: "role credential",
    },
    {
      fromRef: "booking-admin",
      toRef: "systems-admin",
      type: "accessible-by",
      group: "account-access",
      label: "primary operator",
    },
    {
      fromRef: "booking-admin",
      toRef: "ops-lead",
      type: "accessible-by",
      group: "account-access",
      label: "continuity operator",
    },
    {
      fromRef: "payout-account",
      toRef: "finance-lead",
      type: "accessible-by",
      group: "payout-approval",
      label: "finance approver",
    },
    {
      fromRef: "payout-account",
      toRef: "founder",
      type: "accessible-by",
      group: "payout-approval",
      label: "executive approver",
    },
    {
      fromRef: "payout-account",
      toRef: "identity-vault",
      type: "stored-in",
      group: "credential-store",
      label: "business credential",
    },
    {
      fromRef: "continuity-playbook",
      toRef: "ops-lead",
      type: "owned-by",
      group: "document-owner",
      label: "document owner",
    },
    {
      fromRef: "continuity-playbook",
      toRef: "continuity-team",
      type: "accessible-by",
      group: "playbook-access",
      label: "response access",
    },
    {
      fromRef: "key-register",
      toRef: "ops-lead",
      type: "owned-by",
      group: "document-owner",
      label: "custody owner",
    },
    {
      fromRef: "key-register",
      toRef: "floating-manager",
      type: "accessible-by",
      group: "register-access",
      label: "duty access",
    },
    {
      fromRef: "recovery-runbook",
      toRef: "systems-admin",
      type: "owned-by",
      group: "document-owner",
      label: "technical owner",
    },
    {
      fromRef: "recovery-runbook",
      toRef: "ops-lead",
      type: "accessible-by",
      group: "runbook-access",
      label: "continuity access",
    },
    {
      fromRef: "incident-channel",
      toRef: "continuity-team",
      type: "owned-by",
      group: "channel-owner",
      label: "response team",
    },
    {
      fromRef: "incident-channel",
      toRef: "backup-internet",
      type: "recovers-via",
      group: "channel-connectivity",
      label: "mobile connectivity",
    },
    {
      fromRef: "incident-channel",
      toRef: "telecom-provider",
      type: "depends-on",
      group: "channel-connectivity",
      label: "primary connectivity",
    },
    {
      fromRef: "customer-updates",
      toRef: "front-desk-team",
      type: "owned-by",
      group: "message-owner",
      label: "customer response",
    },
    {
      fromRef: "customer-updates",
      toRef: "incident-channel",
      type: "depends-on",
      group: "approved-message",
      label: "incident decision",
    },
    {
      fromRef: "dual-custody-keys",
      toRef: "ops-lead",
      type: "accessible-by",
      group: "key-custody",
      label: "first custodian",
    },
    {
      fromRef: "dual-custody-keys",
      toRef: "floating-manager",
      type: "accessible-by",
      group: "key-custody",
      label: "second custodian",
    },
    {
      fromRef: "backup-internet",
      toRef: "systems-admin",
      type: "owned-by",
      group: "recovery-owner",
      label: "technical owner",
    },
    {
      fromRef: "backup-internet",
      toRef: "floating-manager",
      type: "accessible-by",
      group: "router-access",
      label: "duty access",
    },
    {
      fromRef: "offline-ledger",
      toRef: "front-desk-team",
      type: "accessible-by",
      group: "ledger-access",
      label: "operational access",
    },
    {
      fromRef: "offline-ledger",
      toRef: "continuity-playbook",
      type: "stored-in",
      group: "ledger-storage",
      label: "controlled template",
    },
    {
      fromRef: "booking-workflow",
      toRef: "booking-pos",
      type: "depends-on",
      group: "appointment-record",
      label: "live booking path",
    },
    {
      fromRef: "booking-workflow",
      toRef: "offline-ledger",
      type: "recovers-via",
      group: "appointment-record",
      label: "offline booking path",
    },
    {
      fromRef: "booking-workflow",
      toRef: "payment-processor",
      type: "depends-on",
      group: "checkout",
      label: "card checkout",
    },
    {
      fromRef: "booking-workflow",
      toRef: "front-desk-team",
      type: "owned-by",
      group: "workflow-owner",
      label: "operational owner",
    },
    {
      fromRef: "booking-workflow",
      toRef: "client-records",
      type: "depends-on",
      group: "client-safety",
      label: "consultation record",
    },
    {
      fromRef: "opening-workflow",
      toRef: "key-register",
      type: "depends-on",
      group: "premises-access",
      label: "normal key custody",
    },
    {
      fromRef: "opening-workflow",
      toRef: "dual-custody-keys",
      type: "recovers-via",
      group: "premises-access",
      label: "sealed spare access",
    },
    {
      fromRef: "opening-workflow",
      toRef: "staff-scheduling",
      type: "depends-on",
      group: "opening-staff",
      label: "confirmed opening shift",
    },
    {
      fromRef: "opening-workflow",
      toRef: "central-manager",
      type: "owned-by",
      group: "opening-owner",
      label: "location manager",
    },
    {
      fromRef: "opening-workflow",
      toRef: "floating-manager",
      type: "owned-by",
      group: "opening-owner",
      label: "duty fallback",
    },
    {
      fromRef: "closing-workflow",
      toRef: "booking-pos",
      type: "depends-on",
      group: "close-record",
      label: "live till close",
    },
    {
      fromRef: "closing-workflow",
      toRef: "offline-ledger",
      type: "recovers-via",
      group: "close-record",
      label: "controlled offline close",
    },
    {
      fromRef: "closing-workflow",
      toRef: "central-manager",
      type: "owned-by",
      group: "closing-owner",
      label: "location manager",
    },
    {
      fromRef: "closing-workflow",
      toRef: "floating-manager",
      type: "owned-by",
      group: "closing-owner",
      label: "duty fallback",
    },
    {
      fromRef: "staff-cover-workflow",
      toRef: "staff-scheduling",
      type: "depends-on",
      group: "cover-roster",
      label: "live availability",
    },
    {
      fromRef: "staff-cover-workflow",
      toRef: "continuity-playbook",
      type: "recovers-via",
      group: "cover-roster",
      label: "offline call tree",
    },
    {
      fromRef: "staff-cover-workflow",
      toRef: "ops-lead",
      type: "owned-by",
      group: "cover-owner",
      label: "regional owner",
    },
    {
      fromRef: "staff-cover-workflow",
      toRef: "floating-manager",
      type: "owned-by",
      group: "cover-owner",
      label: "duty fallback",
    },
    {
      fromRef: "staff-cover-workflow",
      toRef: "stylist-team",
      type: "depends-on",
      group: "qualified-capacity",
      label: "qualified cover pool",
    },
    {
      fromRef: "stock-workflow",
      toRef: "inventory-system",
      type: "depends-on",
      group: "stock-record",
      label: "live stock position",
    },
    {
      fromRef: "stock-workflow",
      toRef: "product-supplier",
      type: "depends-on",
      group: "supply-route",
      label: "primary supply",
    },
    {
      fromRef: "stock-workflow",
      toRef: "ops-lead",
      type: "owned-by",
      group: "stock-owner",
      label: "regional owner",
    },
    {
      fromRef: "stock-workflow",
      toRef: "central-manager",
      type: "owned-by",
      group: "stock-owner",
      label: "location fallback",
    },
    {
      fromRef: "incident-workflow",
      toRef: "incident-channel",
      type: "communicates-through",
      group: "incident-comms",
      label: "shared coordination",
    },
    {
      fromRef: "incident-workflow",
      toRef: "customer-updates",
      type: "communicates-through",
      group: "customer-comms",
      label: "approved customer updates",
    },
    {
      fromRef: "incident-workflow",
      toRef: "continuity-team",
      type: "owned-by",
      group: "incident-owner",
      label: "response team",
    },
    {
      fromRef: "incident-workflow",
      toRef: "ops-lead",
      type: "owned-by",
      group: "incident-owner",
      label: "incident lead",
    },
    {
      fromRef: "payout-workflow",
      toRef: "payment-processor",
      type: "depends-on",
      group: "settlement-data",
      label: "settlement report",
    },
    {
      fromRef: "payout-workflow",
      toRef: "payout-account",
      type: "depends-on",
      group: "settlement-account",
      label: "received funds",
    },
    {
      fromRef: "payout-workflow",
      toRef: "finance-lead",
      type: "owned-by",
      group: "reconciliation-owner",
      label: "finance owner",
    },
    {
      fromRef: "payout-workflow",
      toRef: "founder",
      type: "owned-by",
      group: "reconciliation-owner",
      label: "executive fallback",
    },
    {
      fromRef: "data-recovery-workflow",
      toRef: "client-records",
      type: "depends-on",
      group: "recover-target",
      label: "client data service",
    },
    {
      fromRef: "data-recovery-workflow",
      toRef: "booking-pos",
      type: "depends-on",
      group: "recover-target",
      label: "booking data service",
    },
    {
      fromRef: "data-recovery-workflow",
      toRef: "recovery-runbook",
      type: "depends-on",
      group: "recovery-procedure",
      label: "documented restore order",
    },
    {
      fromRef: "data-recovery-workflow",
      toRef: "systems-admin",
      type: "owned-by",
      group: "recovery-owner",
      label: "technical owner",
    },
    {
      fromRef: "data-recovery-workflow",
      toRef: "ops-lead",
      type: "owned-by",
      group: "recovery-owner",
      label: "continuity fallback",
    },
    {
      fromRef: "front-desk-team",
      toRef: "central-salon",
      type: "required-by",
      group: "service-location",
      label: "front desk coverage",
    },
    {
      fromRef: "stylist-team",
      toRef: "central-salon",
      type: "required-by",
      group: "service-location",
      label: "service capacity",
    },
    {
      fromRef: "continuity-team",
      toRef: "continuity-playbook",
      type: "depends-on",
      group: "response-knowledge",
      label: "approved procedure",
    },
  ],
};
