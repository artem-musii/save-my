import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  entityTypes,
  relationshipTypes,
  type Entity,
  type Proposal,
  type Scenario,
  type SimulationResult,
  type ValidationResult,
  type Workspace,
} from "../domain/model";
import { applyProposalChanges } from "../domain/graph";
import { GraphCanvas } from "./components/GraphCanvas";
import { Brand } from "./components/Brand";
import { Modal } from "./components/Modal";
import { OptionalImage } from "./components/OptionalImage";
import { WorkspaceLoading } from "./components/WorkspaceLoading";
import {
  ArrowIcon,
  BreakIcon,
  CloseIcon,
  ListIcon,
  MapIcon,
  MoreIcon,
  PersonIcon,
  RepairIcon,
  ResetIcon,
  SearchIcon,
  SiteToolsIcon,
  TrashIcon,
  VerifyIcon,
} from "./components/icons";
import { api, type Bootstrap } from "./lib/api";
import { trustDescription, trustLabel } from "./lib/trust";
import {
  registerSaveMyTools,
  type ProposalCreatedTarget,
  type WebMcpCallLog,
} from "./webmcp/registerTools";
import {
  registerSaveMyAccountTools,
  type CompanySetupMode,
} from "./webmcp/registerAccountTools";

type WorkspaceState = {
  workspace: Workspace;
  validation: ValidationResult;
  simulation: SimulationResult | null;
};
type Section = "map" | "scenarios" | "people" | "activity";
type MapMode = "baseline" | "scenario" | "proposal";
type RepairView = "before" | "after";
type ProposalComparison = Awaited<ReturnType<typeof api.compare>>;

const sectorLabel: Record<Workspace["sector"], string> = {
  studio: "App company",
  education: "EdTech company",
  hospitality: "Restaurant group",
  charter: "Private jet aggregator",
  custom: "Your company",
};

const prettyType = (value: string) =>
  value
    .split("-")
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");

const proposalChangeSummary = (proposal: Proposal) => {
  const newItems = proposal.changes.filter(
    (change) => change.op === "add-entity",
  ).length;
  const newPaths = proposal.changes.filter(
    (change) => change.op === "add-relationship",
  ).length;
  const updates = proposal.changes.filter(
    (change) => change.op === "update-entity",
  ).length;
  const parts = [
    newItems ? `${newItems} new item${newItems === 1 ? "" : "s"}` : "",
    newPaths ? `${newPaths} new path${newPaths === 1 ? "" : "s"}` : "",
    updates ? `${updates} item update${updates === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.join(" · ") || `${proposal.changes.length} graph changes`;
};

const resolvedProposalKind = (proposal: Proposal) => {
  if (proposal.kind) return proposal.kind;
  if (proposal.idempotencyToken?.startsWith("delegation:"))
    return "DELEGATION" as const;
  if (proposal.idempotencyToken?.startsWith("schedule:"))
    return "SCHEDULE" as const;
  return undefined;
};

const relationshipPhrase: Record<(typeof relationshipTypes)[number], string> = {
  "depends-on": "depends on",
  "owned-by": "is owned by",
  "administered-by": "is administered by",
  "accessible-by": "is accessible by",
  "recovers-via": "recovers via",
  blocks: "blocks",
  "substitutes-for": "substitutes for",
  "communicates-through": "communicates through",
  "stored-in": "is stored in",
  "required-by": "is required by",
};

const formatDate = (value?: string) => {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
};

async function resizeImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is unavailable.");
  const scale = Math.max(256 / bitmap.width, 256 / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(
    bitmap,
    (256 - width) / 2,
    (256 - height) / 2,
    width,
    height,
  );
  let quality = 0.76;
  let result = canvas.toDataURL("image/webp", quality);
  while (result.length > 55_000 && quality > 0.34) {
    quality -= 0.08;
    result = canvas.toDataURL("image/webp", quality);
  }
  if (result.length > 60_000)
    throw new Error("Choose an image with less detail.");
  return result;
}

const setupPreferenceKey = (slug: string) => `save-my:setup:${slug}`;
const siteToolPromptPreamble =
  "Use SAVE MY… native WebMCP Site Tools from the current page in the built-in browser. Discover the current page’s Available Site Tools before starting, and re-check them after a tool changes the active company. WebMCP discovery and Site Tool calls are allowed; they are not browser UI automation. Do not use clicking, typing, screenshots, DOM/page scraping, or computer control as a fallback.";

function CompanyCreateDialog({
  onClose,
  onCreated,
  siteToolsReady,
  onOpenToolLog,
}: {
  onClose: () => void;
  onCreated: (
    workspace: Workspace,
    setupMode: CompanySetupMode,
  ) => void | Promise<void>;
  siteToolsReady: boolean;
  onOpenToolLog: () => void;
}) {
  const agentPromptLabelId = useId();
  const [name, setName] = useState("");
  const [businessContext, setBusinessContext] = useState("");
  const [setupMode, setSetupMode] =
    useState<CompanySetupMode>("agent-blueprint");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [agentIdempotencyKey] = useState(
    () => `company-${crypto.randomUUID()}`,
  );
  const agentPrompt = `${siteToolPromptPreamble} First call get_account_companies. Then call create_company exactly once with ${JSON.stringify(
    {
      name: name.trim() || "Company name from this prompt",
      idempotencyKey: agentIdempotencyKey,
      setupMode: "agent-blueprint",
    },
  )}. The successful tool will open the new company. Re-discover that page’s Site Tools, call get_workspace_summary, then use draft_company_blueprint once to stage a complete connected continuity map for human review. Include critical workflows, people and teams, services, vendors, accounts, devices, documents, locations, communication channels, ownership, access, alternate paths, and recovery mechanisms as relevant. Business context: ${businessContext.trim() || "Ask me for the missing business context before drafting the blueprint."} Do not apply or verify the proposal. After I review and apply it, use design_failure_scenarios to stage three to five materially different rehearsals.`;

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || pending) return;
    if (setupMode === "agent-blueprint") {
      if (!siteToolsReady) {
        setError(
          "Native Site Tools are not connected on this page. Check the tool log or create the company manually.",
        );
        return;
      }
      try {
        await navigator.clipboard.writeText(agentPrompt);
        setError("");
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2400);
      } catch {
        setError("Copy failed. Select the prompt below and copy it manually.");
      }
      return;
    }
    setPending(true);
    setError("");
    try {
      const { workspace } = await api.createWorkspace(name.trim());
      await onCreated(workspace, setupMode);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Company could not be created.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title="New company"
      description="Build it here yourself, or let the page agent create the company and stage its complete map through native Site Tools."
      onClose={onClose}
      wide
      dismissible={!pending}
    >
      <form className="stack-form company-create-form" onSubmit={create}>
        <label>
          Company name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            placeholder="Acme Studio"
          />
        </label>
        <fieldset className="company-setup-choice">
          <legend>How do you want to start?</legend>
          <label className={setupMode === "manual" ? "active" : ""}>
            <input
              type="radio"
              name="setup-mode"
              value="manual"
              checked={setupMode === "manual"}
              onChange={() => setSetupMode("manual")}
            />
            <span>
              <strong>Build manually</strong>
              <small>
                Create an empty company, then add every item and path yourself.
              </small>
            </span>
          </label>
          <label className={setupMode === "agent-blueprint" ? "active" : ""}>
            <input
              type="radio"
              name="setup-mode"
              value="agent-blueprint"
              checked={setupMode === "agent-blueprint"}
              onChange={() => setSetupMode("agent-blueprint")}
            />
            <span>
              <strong>Create with Site Tools</strong>
              <small>
                The agent calls <code>create_company</code>, then stages a full
                connected blueprint for your review.
              </small>
            </span>
          </label>
        </fieldset>
        {setupMode === "agent-blueprint" && (
          <div className="company-agent-creation">
            <label>
              Business context
              <textarea
                value={businessContext}
                onChange={(event) => setBusinessContext(event.target.value)}
                placeholder="What the company does, team shape, critical work, systems, vendors, access constraints, and recovery expectations."
                rows={4}
              />
            </label>
            <details className="agent-creation-prompt">
              <summary>Review exact Site Tool prompt</summary>
              <div className="agent-prompt-field">
                <span id={agentPromptLabelId}>
                  Prompt for this page’s agent
                </span>
                <textarea
                  aria-labelledby={agentPromptLabelId}
                  readOnly
                  value={agentPrompt}
                  rows={6}
                />
              </div>
            </details>
            <div className="company-agent-status">
              <span
                className={`tool-availability ${siteToolsReady ? "ready" : ""}`}
              >
                <i />
                {siteToolsReady
                  ? "Account Site Tools ready"
                  : "Account Site Tools unavailable"}
              </span>
              <button
                type="button"
                className="text-button"
                onClick={onOpenToolLog}
              >
                Check tools
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="split-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={!name.trim() || pending}
          >
            {pending
              ? "Creating…"
              : setupMode === "manual"
                ? "Create and add items"
                : copied
                  ? "Prompt copied — send to agent"
                  : "Copy full agent prompt"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CompanySettingsDialog({
  workspace,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  onClose: () => void;
  onSaved: (workspace: Workspace) => Promise<void>;
}) {
  const [name, setName] = useState(workspace.name);
  const [archived, setArchived] = useState(Boolean(workspace.archived));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const normalizedName = name.trim();
  const dirty =
    normalizedName !== workspace.name ||
    archived !== Boolean(workspace.archived);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!normalizedName || !dirty || pending) return;
    setPending(true);
    setError("");
    try {
      const { workspace: updated } = await api.updateWorkspace(
        workspace.slug,
        workspace.version,
        { name: normalizedName, archived },
      );
      await onSaved(updated);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Company settings could not be saved.",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      title="Company settings"
      description="Rename this private company or archive it without deleting its map, scenarios, proposals, or activity."
      onClose={onClose}
      dismissible={!pending}
    >
      <form className="stack-form company-settings-form" onSubmit={save}>
        <label>
          Company name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
          />
        </label>
        <label className="company-archive-choice">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />
          <span>
            <strong>Archive this company</strong>
            <small>
              Hide it from the active company lists. You can restore it from the
              landing page.
            </small>
          </span>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="split-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={!normalizedName || !dirty || pending}
            title={
              !dirty ? "Change the name or archive setting to save" : undefined
            }
          >
            {pending ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Landing({
  bootstrap,
  accountToolsReady,
  accountToolCalls,
  onOpen,
  onRefresh,
}: {
  bootstrap: Bootstrap | null;
  accountToolsReady: boolean;
  accountToolCalls: WebMcpCallLog[];
  onOpen: (slug: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [authOpen, setAuthOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [toolLogOpen, setToolLogOpen] = useState(false);
  const [email, setEmail] = useState("judge@savemy.systems");
  const [password, setPassword] = useState("SaveMy-Judge-2026");
  const [error, setError] = useState("");
  const [pageError, setPageError] = useState("");
  const [restoringSlug, setRestoringSlug] = useState<string>();
  const [pending, setPending] = useState<"login" | null>(null);
  const demos = bootstrap?.workspaces.filter((item) => item.fictional) ?? [];
  const personal =
    bootstrap?.workspaces.filter((item) => !item.fictional && !item.archived) ??
    [];
  const archived =
    bootstrap?.workspaces.filter((item) => !item.fictional && item.archived) ??
    [];

  const restoreCompany = async (companySlug: string) => {
    if (restoringSlug) return;
    setRestoringSlug(companySlug);
    setPageError("");
    try {
      const { workspace } = await api.workspace(companySlug);
      await api.updateWorkspace(companySlug, workspace.version, {
        archived: false,
      });
      await onRefresh();
    } catch (reason) {
      setPageError(
        reason instanceof Error
          ? reason.message
          : "The company could not be restored.",
      );
    } finally {
      setRestoringSlug(undefined);
    }
  };

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending("login");
    setError("");
    try {
      await api.login(email, password);
      await onRefresh();
      setAuthOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign in failed.");
    } finally {
      setPending(null);
    }
  };
  return (
    <main className="landing" id="top">
      <header className="landing-header">
        <Brand />
        <div className="landing-actions">
          <button
            className={`agent-status landing-agent-status ${accountToolsReady ? "ready" : ""}`}
            onClick={() => setToolLogOpen(true)}
            aria-label={`Open account Site Tool log, ${accountToolCalls.length} calls`}
          >
            <SiteToolsIcon />
            <i className="agent-ready-dot" />
            <span className="agent-status-label">
              {accountToolsReady
                ? "Site Tools · 2 ready"
                : "Manual setup available"}
            </span>
            <small>{accountToolCalls.length}</small>
          </button>
          {bootstrap?.user ? (
            <button
              className="secondary-button"
              onClick={() => setCreateOpen(true)}
            >
              Add company
            </button>
          ) : (
            <button
              className="secondary-button"
              onClick={() => setAuthOpen(true)}
            >
              Sign in
            </button>
          )}
          <button
            className="primary-button"
            onClick={() => onOpen("northstar-studio")}
          >
            Explore the demo <ArrowIcon />
          </button>
        </div>
      </header>

      <section className="landing-hero">
        <div className="hero-copy">
          <p className="eyebrow">Continuity planning for small teams</p>
          <h1>See the work that stops when someone or something disappears.</h1>
          <p>
            Map people, systems, responsibilities, and recovery paths. Rehearse
            a disruption, assign fallback owners, and save a plan your team can
            actually follow.
          </p>
          <div className="hero-actions">
            <button
              className="primary-button large"
              onClick={() => onOpen("northstar-studio")}
            >
              Open Diamond Apps <ArrowIcon />
            </button>
            <span>No account required for demos</span>
          </div>
        </div>
        <div className="hero-visual" aria-label="Continuity map preview">
          <div className="hero-orbit one">
            <img
              src="/assets/nodes/studio/01.webp"
              alt="Fictional team member"
            />
          </div>
          <div className="hero-orbit two">
            <img src="/assets/nodes/studio/04.webp" alt="Release pipeline" />
          </div>
          <div className="hero-orbit three">
            <img src="/assets/nodes/studio/10.webp" alt="Recovery key" />
          </div>
          <div className="hero-core">
            <Brand compact />
            <strong>Work stays connected</strong>
            <span>even when the plan changes</span>
          </div>
        </div>
      </section>

      {personal.length > 0 && (
        <section className="company-section">
          <header>
            <div>
              <p className="eyebrow">Your account</p>
              <h2>Your companies</h2>
            </div>
          </header>
          <div className="company-grid personal">
            {personal.map((item) => (
              <button
                className="company-card"
                key={item.slug}
                onClick={() => onOpen(item.slug)}
              >
                <div className="company-cover">
                  <img
                    src={item.cover ?? "/assets/nodes/studio/25.webp"}
                    alt=""
                  />
                </div>
                <span>{sectorLabel[item.sector]}</span>
                <strong>{item.name}</strong>
                <p>{item.tagline}</p>
                <small>
                  {item.entityCount} items · {item.scenarioCount} scenarios
                </small>
              </button>
            ))}
          </div>
        </section>
      )}

      {archived.length > 0 && (
        <section className="company-section archived-company-section">
          <header>
            <div>
              <p className="eyebrow">Stored safely</p>
              <h2>Archived companies</h2>
            </div>
            <p>Restore a company to return it to your active workspace list.</p>
          </header>
          <div className="archived-company-list">
            {archived.map((item) => (
              <article key={item.slug}>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.entityCount} items · {item.scenarioCount} scenarios
                  </small>
                </span>
                <button
                  className="secondary-button"
                  disabled={Boolean(restoringSlug)}
                  onClick={() => void restoreCompany(item.slug)}
                >
                  {restoringSlug === item.slug ? "Restoring…" : "Restore"}
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="company-section">
        <header>
          <div>
            <p className="eyebrow">Fictional examples</p>
            <h2>Choose a company to explore</h2>
          </div>
          <p>
            Each demo contains a rich baseline map and stored disruption
            scenarios.
          </p>
        </header>
        <div className="company-grid">
          {demos.map((item) => (
            <button
              className="company-card"
              key={item.slug}
              onClick={() => onOpen(item.slug)}
            >
              <div className="company-cover">
                <img src={item.cover} alt="" />
              </div>
              <span>{sectorLabel[item.sector]}</span>
              <strong>{item.name}</strong>
              <p>{item.tagline}</p>
              <small>
                {item.entityCount} items · {item.scenarioCount} scenarios
              </small>
            </button>
          ))}
        </div>
      </section>

      {authOpen && (
        <Modal
          title="Sign in to your account"
          description="Keep personal companies separate from the fictional demos."
          onClose={() => setAuthOpen(false)}
        >
          <form className="stack-form" onSubmit={login}>
            <label>
              Email
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary-button"
              type="submit"
              disabled={pending !== null}
            >
              {pending === "login" ? "Signing in…" : "Sign in"}
            </button>
            <p className="form-note">
              Local demo account: judge@savemy.systems / SaveMy-Judge-2026
            </p>
          </form>
        </Modal>
      )}
      {createOpen && (
        <CompanyCreateDialog
          onClose={() => setCreateOpen(false)}
          siteToolsReady={accountToolsReady}
          onOpenToolLog={() => setToolLogOpen(true)}
          onCreated={async (workspace, setupMode) => {
            sessionStorage.setItem(
              setupPreferenceKey(workspace.slug),
              setupMode,
            );
            await onRefresh();
            onOpen(workspace.slug);
          }}
        />
      )}
      {toolLogOpen && (
        <WebMcpLogDialog
          entries={accountToolCalls}
          ready={accountToolsReady}
          onClose={() => setToolLogOpen(false)}
        />
      )}
      {pageError && (
        <div className="toast" role="alert">
          <span>{pageError}</span>
          <button onClick={() => setPageError("")} aria-label="Dismiss">
            <CloseIcon />
          </button>
        </div>
      )}
    </main>
  );
}

function EntityEditor({
  workspace,
  entity,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  entity?: Entity | undefined;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(entity?.name ?? "");
  const [type, setType] = useState<Entity["type"]>(entity?.type ?? "person");
  const [role, setRole] = useState(entity?.role ?? "");
  const [team, setTeam] = useState(entity?.team ?? "");
  const [description, setDescription] = useState(entity?.description ?? "");
  const [image, setImage] = useState(entity?.image ?? "");
  const [critical, setCritical] = useState(Boolean(entity?.critical));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const normalizedName = name.trim();
  const normalizedRole = role.trim();
  const normalizedTeam = team.trim();
  const normalizedDescription = description.trim();
  const dirty =
    !entity ||
    normalizedName !== entity.name ||
    type !== entity.type ||
    normalizedRole !== (entity.role ?? "") ||
    normalizedTeam !== (entity.team ?? "") ||
    normalizedDescription !== (entity.description ?? "") ||
    image !== (entity.image ?? "") ||
    critical !== Boolean(entity.critical);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!normalizedName || !dirty || saving) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: normalizedName,
        type,
        role: normalizedRole,
        team: normalizedTeam,
        description: normalizedDescription,
        image,
        critical,
      };
      if (entity)
        await api.updateEntity(
          workspace.slug,
          entity.id,
          workspace.version,
          payload,
        );
      else await api.addEntity(workspace.slug, workspace.version, payload);
      await onSaved();
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Item could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={entity ? `Edit ${entity.name}` : "Add an item"}
      description="People, systems, documents, and workflows all live in the baseline map."
      onClose={onClose}
      wide
    >
      <form className="entity-form" onSubmit={save}>
        <div className="asset-picker">
          <div className="asset-preview">
            {image ? (
              <img src={image} alt="Selected asset" />
            ) : (
              <span>Add image</span>
            )}
          </div>
          <label className="secondary-button file-button">
            Upload image
            <input
              type="file"
              accept="image/*"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  setImage(await resizeImage(file));
                } catch (reason) {
                  setError(
                    reason instanceof Error ? reason.message : "Image failed.",
                  );
                }
              }}
            />
          </label>
          <small>Images are resized locally before saving.</small>
        </div>
        <div className="form-grid">
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label>
            Type
            <select
              value={type}
              onChange={(event) =>
                setType(event.target.value as Entity["type"])
              }
            >
              {entityTypes.map((item) => (
                <option value={item} key={item}>
                  {prettyType(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Role or purpose
            <input
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="Operations lead"
            />
          </label>
          <label>
            Team
            <input
              value={team}
              onChange={(event) => setTeam(event.target.value)}
              placeholder="Operations"
            />
          </label>
          <label className="full">
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
            />
          </label>
          <label className="check-row full">
            <input
              type="checkbox"
              checked={critical}
              onChange={(event) => setCritical(event.target.checked)}
            />
            Critical to at least one responsibility
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={!normalizedName || !dirty || saving}
            title={
              entity && !dirty ? "Change at least one field to save" : undefined
            }
          >
            {saving ? "Saving…" : "Save to baseline"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function SearchDialog({
  workspace,
  onClose,
  onPick,
}: {
  workspace: Workspace;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Entity[]>(
    workspace.entities.slice(0, 8),
  );
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (!query.trim()) {
        setResults(workspace.entities.slice(0, 8));
        setSearchError("");
        setSearching(false);
      } else {
        setSearching(true);
        setSearchError("");
        void api
          .search(workspace.slug, query, controller.signal)
          .then((value) => {
            setResults(value.entities);
            setSearching(false);
          })
          .catch((reason) => {
            if (controller.signal.aborted) return;
            setSearching(false);
            setResults([]);
            setSearchError(
              reason instanceof Error
                ? reason.message
                : "Search could not be completed.",
            );
          });
      }
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, workspace]);
  return (
    <Modal
      title="Search the company"
      description="Find any person, role, system, document, or workflow."
      onClose={onClose}
      wide
    >
      <div className="search-field">
        <SearchIcon />
        <input
          aria-label="Search by name, role, or description"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
          placeholder="Search by name, role, or description"
        />
      </div>
      <div className="search-results">
        {results.map((entity) => (
          <button
            key={entity.id}
            onClick={() => {
              onPick(entity.id);
              onClose();
            }}
          >
            <OptionalImage src={entity.image} />
            <span>
              <strong>{entity.name}</strong>
              <small>{entity.role ?? prettyType(entity.type)}</small>
            </span>
            <ArrowIcon />
          </button>
        ))}
        {searching && <p role="status">Searching…</p>}
        {searchError && (
          <p className="form-error" role="alert">
            Search failed: {searchError}
          </p>
        )}
        {!searching && !searchError && results.length === 0 && (
          <p>No matching items. Try a broader term.</p>
        )}
      </div>
    </Modal>
  );
}

function WebMcpLogDialog({
  entries,
  ready,
  onClose,
}: {
  entries: WebMcpCallLog[];
  ready: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Site Tool call log"
      description="Native WebMCP calls made in this company appear here with their inputs, results, and timing."
      onClose={onClose}
      wide
    >
      <div className="webmcp-call-log" aria-live="polite">
        {entries.length === 0 ? (
          <div className="webmcp-log-empty">
            <span className={`tool-availability ${ready ? "ready" : ""}`}>
              <i />
              {ready ? "Site Tools connected" : "Site Tools unavailable"}
            </span>
            <strong>No Site Tool calls were made.</strong>
            <p>
              If an agent says it created repair options but this log is empty,
              it did not call this company’s WebMCP tools. Registration events
              and manual UI actions are not recorded here.
            </p>
          </div>
        ) : (
          [...entries].reverse().map((entry) => {
            const started = new Date(entry.startedAt);
            const duration = entry.finishedAt
              ? Math.max(
                  0,
                  new Date(entry.finishedAt).getTime() - started.getTime(),
                )
              : null;
            return (
              <article className="webmcp-log-entry" key={entry.id}>
                <header>
                  <span className={`tool-call-state ${entry.status}`}>
                    {entry.status}
                  </span>
                  <div>
                    <strong>{entry.title}</strong>
                    <small>{entry.name}</small>
                  </div>
                  <time dateTime={entry.startedAt}>
                    {started.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                    {duration !== null ? ` · ${duration} ms` : ""}
                  </time>
                </header>
                <details>
                  <summary>Input</summary>
                  <pre>{entry.input}</pre>
                </details>
                {entry.output && (
                  <details>
                    <summary>Result</summary>
                    <pre>{entry.output}</pre>
                  </details>
                )}
                {entry.error && <p role="alert">{entry.error}</p>}
              </article>
            );
          })
        )}
      </div>
    </Modal>
  );
}

function AgentRepairDialog({
  workspace,
  scenario,
  ready,
  onOpenLog,
  onClose,
}: {
  workspace: Workspace;
  scenario: Scenario;
  ready: boolean;
  onOpenLog: () => void;
  onClose: () => void;
}) {
  const promptLabelId = useId();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const prompt = `${siteToolPromptPreamble} Analyze the “${scenario.name}” scenario in “${workspace.name}”. Read the authoritative workspace and simulate the scenario, then call draft_repair_options with three complete, materially different repair options. Each option must contain multiple connected graph changes spanning at least three items and restore every blocked critical workflow. At least one option should introduce and connect new recovery items where the evidence supports them. Never reference an invented item only by ID: add the entity and its relationships in the same option. Compare effort, restoration time, and residual risk. Do not apply anything.`;

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyError("");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError("Copy failed. Select the prompt and copy it manually.");
    }
  };

  return (
    <Modal
      title="Ask an agent for repair options"
      description="The agent authors the options through WebMCP. SAVE MY… validates and stores them as reversible drafts; it never generates repair content."
      onClose={onClose}
      wide
    >
      <div className="agent-repair-guide">
        <ol>
          <li>
            <span>1</span>
            <p>
              <strong>Send the prompt to the Site Tools agent</strong>
              Use the agent connected to this page, not a separate chat without
              the native company tools.
            </p>
          </li>
          <li>
            <span>2</span>
            <p>
              <strong>Confirm the tool calls</strong>
              The log should show workspace, simulation, and
              <code>draft_repair_options</code> calls.
            </p>
          </li>
          <li>
            <span>3</span>
            <p>
              <strong>Compare before applying</strong>
              Successful drafts open here as selectable options. Your baseline
              stays unchanged until you apply one.
            </p>
          </li>
        </ol>
        <div className="agent-prompt-field">
          <span id={promptLabelId}>Prompt for the Site Tools agent</span>
          <textarea
            aria-labelledby={promptLabelId}
            readOnly
            value={prompt}
            rows={6}
          />
        </div>
        <div className="agent-repair-status">
          <span className={`tool-availability ${ready ? "ready" : ""}`}>
            <i />
            {ready
              ? "Site Tools connected on this page"
              : "Site Tools unavailable here · use manual repair"}
          </span>
          {copyError && <p role="alert">{copyError}</p>}
        </div>
        <footer>
          <button className="secondary-button" onClick={onOpenLog}>
            <SiteToolsIcon />
            Check tool calls
          </button>
          <button className="primary-button" onClick={() => void copyPrompt()}>
            {copied ? "Prompt copied" : "Copy agent prompt"}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

function AgentBlueprintDialog({
  workspace,
  ready,
  onOpenLog,
  onClose,
}: {
  workspace: Workspace;
  ready: boolean;
  onOpenLog: () => void;
  onClose: () => void;
}) {
  const promptLabelId = useId();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const prompt = `${siteToolPromptPreamble} Build the first continuity map for “${workspace.name}”. Call get_workspace_summary first. Ask me only for genuinely missing business context, then call draft_company_blueprint once with one complete connected company map: critical workflows, people and teams, services, vendors, accounts, devices, documents, locations, communication channels, ownership, access, alternate paths, and recovery mechanisms as relevant. Use stable refs, connect every item, and include concrete descriptions. Do not apply or verify the proposal. After I review and apply the map, use design_failure_scenarios to propose several materially different rehearsals.`;

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyError("");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError("Copy failed. Select the prompt and copy it manually.");
    }
  };

  return (
    <Modal
      title="Stage this company with Site Tools"
      description="The native tools create a complete reversible blueprint. No browser or computer control is needed."
      onClose={onClose}
      wide
    >
      <div className="agent-repair-guide">
        <ol>
          <li>
            <span>1</span>
            <p>
              <strong>Send the prompt to the page agent</strong>
              The agent reads this exact empty workspace and authors one
              connected blueprint.
            </p>
          </li>
          <li>
            <span>2</span>
            <p>
              <strong>Confirm native calls</strong>
              The log must show <code>get_workspace_summary</code> and
              <code>draft_company_blueprint</code>, never UI automation.
            </p>
          </li>
          <li>
            <span>3</span>
            <p>
              <strong>Review the staged graph</strong>
              Inspect every new item and path before applying anything to the
              baseline.
            </p>
          </li>
        </ol>
        <div className="agent-prompt-field">
          <span id={promptLabelId}>Prompt for the page agent</span>
          <textarea
            aria-labelledby={promptLabelId}
            readOnly
            value={prompt}
            rows={9}
          />
        </div>
        <div className="agent-repair-status">
          <span className={`tool-availability ${ready ? "ready" : ""}`}>
            <i />
            {ready
              ? "Native Site Tools connected on this company"
              : "Site Tools unavailable here · use manual setup"}
          </span>
          {copyError && <p role="alert">{copyError}</p>}
        </div>
        <footer>
          <button className="secondary-button" onClick={onOpenLog}>
            <SiteToolsIcon />
            Check tool calls
          </button>
          <button className="primary-button" onClick={() => void copyPrompt()}>
            {copied ? "Prompt copied" : "Copy Site Tool prompt"}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

function AgentScenarioDialog({
  workspace,
  ready,
  onOpenLog,
  onClose,
}: {
  workspace: Workspace;
  ready: boolean;
  onOpenLog: () => void;
  onClose: () => void;
}) {
  const promptLabelId = useId();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const prompt = `${siteToolPromptPreamble} Design a useful scenario library for “${workspace.name}”. Call get_workspace_summary and search_entities to resolve exact graph IDs. Use simulate_disruption to test plausible single and compound failures, then call design_failure_scenarios once with three to five materially different, evidence-based scenario drafts. Each scenario must identify what becomes unavailable, how long it lasts, and the concrete work that must continue. Include at least one people risk, one system/vendor/access risk, and one compound failure when supported by the map. Do not invent IDs, change the baseline, claim verification, or apply repairs.`;

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyError("");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError("Copy failed. Select the prompt and copy it manually.");
    }
  };

  return (
    <Modal
      title="Design scenarios with Site Tools"
      description="The agent uses exact graph IDs and deterministic simulations to stage several reviewable rehearsals."
      onClose={onClose}
      wide
    >
      <div className="agent-repair-guide">
        <ol>
          <li>
            <span>1</span>
            <p>
              <strong>Read the active graph</strong>
              The agent resolves exact people, systems, vendors, and access
              paths before proposing failures.
            </p>
          </li>
          <li>
            <span>2</span>
            <p>
              <strong>Test before storing</strong>
              Deterministic simulations expose impact without editing the
              baseline.
            </p>
          </li>
          <li>
            <span>3</span>
            <p>
              <strong>Stage a scenario set</strong>
              One idempotent Site Tool call creates several attributable drafts
              for review.
            </p>
          </li>
        </ol>
        <div className="agent-prompt-field">
          <span id={promptLabelId}>Prompt for the page agent</span>
          <textarea
            aria-labelledby={promptLabelId}
            readOnly
            value={prompt}
            rows={8}
          />
        </div>
        <div className="agent-repair-status">
          <span className={`tool-availability ${ready ? "ready" : ""}`}>
            <i />
            {ready
              ? "Native Site Tools connected on this company"
              : "Site Tools unavailable here · create scenarios manually"}
          </span>
          {copyError && <p role="alert">{copyError}</p>}
        </div>
        <footer>
          <button className="secondary-button" onClick={onOpenLog}>
            <SiteToolsIcon />
            Check tool calls
          </button>
          <button className="primary-button" onClick={() => void copyPrompt()}>
            {copied ? "Prompt copied" : "Copy scenario prompt"}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

function ScenarioEditor({
  workspace,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  onClose: () => void;
  onSaved: (scenario: Scenario) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [days, setDays] = useState(2);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const people = workspace.entities.filter(
    (entity) => entity.type === "person" || entity.type === "team",
  );
  const systems = workspace.entities.filter(
    (entity) => entity.type !== "person" && entity.type !== "team",
  );
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || unavailable.length === 0 || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api.createScenario(
        workspace.slug,
        workspace.version,
        {
          name: name.trim(),
          context,
          durationDays: days,
          unavailableEntityIds: unavailable,
          createdBy: "human",
          draft: false,
        },
      );
      await onSaved(result.scenario);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The scenario could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };
  const renderEntities = (entities: Entity[]) =>
    entities.map((entity) => (
      <label key={entity.id}>
        <input
          type="checkbox"
          checked={unavailable.includes(entity.id)}
          onChange={(event) =>
            setUnavailable((current) =>
              event.target.checked
                ? [...current, entity.id]
                : current.filter((id) => id !== entity.id),
            )
          }
        />
        <OptionalImage src={entity.image} />
        <span>
          <strong>{entity.name}</strong>
          <small>{entity.role ?? prettyType(entity.type)}</small>
        </span>
      </label>
    ));
  return (
    <Modal
      title="Create a disruption scenario"
      description="Select one or several people and systems that become unavailable together. Your baseline stays unchanged."
      onClose={onClose}
      wide
    >
      <form className="scenario-form" onSubmit={save}>
        <div className="form-grid">
          <label>
            Scenario name
            <input
              aria-label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              placeholder="Founder and finance lead unavailable"
            />
          </label>
          <label>
            Duration in days
            <input
              type="number"
              min="1"
              max="30"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            />
          </label>
          <label className="full">
            What must continue?
            <textarea
              aria-label="Context"
              value={context}
              onChange={(event) => setContext(event.target.value)}
              rows={3}
              placeholder="Describe the deadline, customer promise, or operation that cannot stop."
            />
          </label>
        </div>
        <fieldset>
          <legend>
            Unavailable together <span>{unavailable.length} selected</span>
          </legend>
          <div className="scenario-picker-groups">
            <section>
              <h3>People and teams</h3>
              <div className="scenario-picker">{renderEntities(people)}</div>
            </section>
            <section>
              <h3>Systems, accounts, and workflows</h3>
              <div className="scenario-picker">{renderEntities(systems)}</div>
            </section>
          </div>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={!name.trim() || unavailable.length === 0 || saving}
          >
            {saving ? "Saving scenario…" : "Save and explore"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function ScenarioLibrary({
  workspace,
  activeId,
  onOpen,
  onSaved,
  onAgent,
}: {
  workspace: Workspace;
  activeId: string | undefined;
  onOpen: (scenario: Scenario) => void;
  onSaved: () => Promise<void>;
  onAgent: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const hasItems = workspace.entities.length > 0;
  return (
    <div className="section-page">
      <header className="section-heading">
        <div>
          <span className="eyebrow">Modeled separately from your baseline</span>
          <h2>Stored scenarios</h2>
          <p>Investigate an absence without changing the company map.</p>
        </div>
        <div className="section-heading-actions">
          <button
            className="secondary-button"
            onClick={onAgent}
            disabled={!hasItems}
            title={
              hasItems
                ? undefined
                : "Add company-map items before designing scenarios"
            }
          >
            <SiteToolsIcon />
            Design with agent
          </button>
          <button
            className="primary-button"
            onClick={() => setCreating(true)}
            disabled={!hasItems}
            title={
              hasItems
                ? undefined
                : "Add company-map items before creating a scenario"
            }
          >
            New scenario
          </button>
        </div>
      </header>
      <div className="scenario-grid">
        {workspace.scenarios.map((scenario) => (
          <button
            className={`scenario-card ${scenario.id === activeId ? "active" : ""} ${scenario.resolution?.status === "RESOLVED" ? "resolved" : ""} ${scenario.draft ? "draft" : ""}`}
            key={scenario.id}
            aria-pressed={scenario.id === activeId}
            onClick={() => onOpen(scenario)}
          >
            <div className="scenario-icon">
              {scenario.resolution?.status === "RESOLVED" ? (
                <VerifyIcon />
              ) : (
                <BreakIcon />
              )}
            </div>
            <span>
              {scenario.resolution?.status === "RESOLVED"
                ? "Resolved rehearsal"
                : scenario.draft
                  ? `Agent draft · ${scenario.durationDays} day rehearsal`
                  : scenario.durationDays + " day rehearsal"}
            </span>
            <strong>{scenario.name}</strong>
            <p>{scenario.context}</p>
            <div className="scenario-entities">
              {scenario.unavailableEntityIds
                .map(
                  (id) =>
                    workspace.entities.find((item) => item.id === id)?.name ??
                    id,
                )
                .join(" · ")}
            </div>
            <small>
              {scenario.resolution?.status === "RESOLVED"
                ? "Review resolution"
                : "Open scenario"}{" "}
              <ArrowIcon />
            </small>
          </button>
        ))}
      </div>
      {workspace.scenarios.length === 0 && (
        <section className="section-empty-state" role="status">
          <span className="eyebrow">No stored scenarios</span>
          <h3>
            {hasItems
              ? "Rehearse the first disruption"
              : "Build the company map first"}
          </h3>
          <p>
            {hasItems
              ? "Create one scenario yourself, or let Site Tools stage several materially different rehearsals for review."
              : "Scenarios need at least one real map item to become unavailable. Return to the continuity map and add your first item."}
          </p>
        </section>
      )}
      {creating && (
        <ScenarioEditor
          workspace={workspace}
          onClose={() => setCreating(false)}
          onSaved={async () => onSaved()}
        />
      )}
    </div>
  );
}

function DelegationDialog({
  workspace,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const people = workspace.entities.filter(
    (entity) => entity.type === "person",
  );
  const responsibilities = workspace.entities.filter(
    (entity) => entity.type === "workflow",
  );
  const [primary, setPrimary] = useState(people[0]?.id ?? "");
  const [fallback, setFallback] = useState(people[1]?.id ?? "");
  const [responsibility, setResponsibility] = useState(
    responsibilities[0]?.id ?? "",
  );
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"draft" | "baseline" | null>(null);
  const [error, setError] = useState("");
  const apply = async (agent: boolean) => {
    if (pending) return;
    setPending(agent ? "draft" : "baseline");
    setError("");
    try {
      if (agent)
        await api.draftDelegation(workspace.slug, {
          workspaceVersion: workspace.version,
          idempotencyKey: crypto.randomUUID(),
          primaryPersonId: primary,
          fallbackPersonId: fallback,
          ...(responsibility ? { responsibilityId: responsibility } : {}),
          note,
        });
      else
        await api.addRelationship(workspace.slug, workspace.version, {
          from: fallback,
          to: primary,
          type: "substitutes-for",
          label:
            note ||
            `Fallback for ${workspace.entities.find((item) => item.id === responsibility)?.name ?? "critical work"}`,
        });
      await onSaved();
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Fallback coverage could not be saved.",
      );
    } finally {
      setPending(null);
    }
  };
  return (
    <Modal
      title="Assign fallback coverage"
      description="Apply this directly or stage a review draft. Both paths are rules-based; no AI is required."
      onClose={onClose}
    >
      <div className="stack-form">
        <label>
          Primary owner
          <select
            value={primary}
            onChange={(event) => setPrimary(event.target.value)}
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fallback person
          <select
            value={fallback}
            onChange={(event) => setFallback(event.target.value)}
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Responsibility
          <select
            value={responsibility}
            onChange={(event) => setResponsibility(event.target.value)}
          >
            {responsibilities.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Coverage note
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="split-actions">
          <button
            className="secondary-button"
            onClick={() => void apply(true)}
            disabled={pending !== null || primary === fallback}
          >
            {pending === "draft" ? "Staging…" : "Stage review draft"}
          </button>
          <button
            className="primary-button"
            onClick={() => void apply(false)}
            disabled={pending !== null || primary === fallback}
          >
            {pending === "baseline" ? "Applying…" : "Apply to baseline"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ScheduleDialog({
  workspace,
  entity,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  entity: Entity;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [dueAt, setDueAt] = useState(
    entity.metadata?.dueAt?.slice(0, 10) ?? "",
  );
  const [note, setNote] = useState(entity.metadata?.rescheduleNote ?? "");
  const [mode, setMode] = useState<"human" | "agent" | "shared">(
    entity.metadata?.executionMode ?? "shared",
  );
  const [pending, setPending] = useState<"draft" | "baseline" | null>(null);
  const [error, setError] = useState("");
  const apply = async (agent: boolean) => {
    if (pending) return;
    setPending(agent ? "draft" : "baseline");
    setError("");
    try {
      if (agent)
        await api.draftSchedule(workspace.slug, {
          workspaceVersion: workspace.version,
          idempotencyKey: crypto.randomUUID(),
          entityId: entity.id,
          dueAt,
          note,
          executionMode: mode,
        });
      else
        await api.updateEntity(workspace.slug, entity.id, workspace.version, {
          metadata: {
            ...entity.metadata,
            dueAt,
            rescheduleNote: note,
            executionMode: mode,
          },
        });
      await onSaved();
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The schedule could not be saved.",
      );
    } finally {
      setPending(null);
    }
  };
  return (
    <Modal
      title={`Schedule ${entity.name}`}
      description="Update the baseline directly or stage the same change for review. No AI is required."
      onClose={onClose}
    >
      <div className="stack-form">
        <label>
          New date
          <input
            type="date"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
        </label>
        <label>
          Who can carry it
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="human">Person</option>
            <option value="agent">Agent</option>
            <option value="shared">Person with agent support</option>
          </select>
        </label>
        <label>
          Reason or constraint
          <textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="split-actions">
          <button
            className="secondary-button"
            onClick={() => void apply(true)}
            disabled={!dueAt || pending !== null}
          >
            {pending === "draft" ? "Staging…" : "Stage review draft"}
          </button>
          <button
            className="primary-button"
            onClick={() => void apply(false)}
            disabled={!dueAt || pending !== null}
          >
            {pending === "baseline" ? "Applying…" : "Apply to baseline"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ConnectionDialog({
  workspace,
  initialFromId,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  initialFromId?: string | undefined;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const initialFrom =
    workspace.entities.find((entity) => entity.id === initialFromId)?.id ??
    workspace.entities[0]?.id ??
    "";
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(
    workspace.entities.find((entity) => entity.id !== initialFrom)?.id ?? "",
  );
  const [type, setType] =
    useState<(typeof relationshipTypes)[number]>("depends-on");
  const [label, setLabel] = useState("");
  const [group, setGroup] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fromEntity = workspace.entities.find((entity) => entity.id === from);
  const toEntity = workspace.entities.find((entity) => entity.id === to);
  const groupSuggestions = [
    ...new Set(
      workspace.relationships
        .filter((relationship) => relationship.from === from)
        .map((relationship) => relationship.group)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const setFromSafely = (id: string) => {
    setFrom(id);
    if (id === to)
      setTo(workspace.entities.find((entity) => entity.id !== id)?.id ?? "");
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!from || !to || from === to || saving) return;
    setSaving(true);
    setError("");
    try {
      await api.addRelationship(workspace.slug, workspace.version, {
        from,
        to,
        type,
        ...(group.trim() ? { group: group.trim() } : {}),
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      await onSaved();
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The connection could not be added.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title="Connect two items"
      description="Add a dependency, owner, recovery route, or fallback directly to the baseline."
      onClose={onClose}
    >
      <form className="stack-form" onSubmit={save}>
        <div className="connection-preview" aria-live="polite">
          <span>Connection preview</span>
          <strong>
            {fromEntity?.name ?? "First item"}{" "}
            <em>{relationshipPhrase[type]}</em>{" "}
            {toEntity?.name ?? "second item"}
          </strong>
          <small>
            The arrow runs from the first item to the second. This becomes a
            human-declared baseline fact and is recorded in Activity.
          </small>
        </div>
        <label>
          First item
          <select
            aria-label="First item"
            value={from}
            onChange={(event) => setFromSafely(event.target.value)}
          >
            {workspace.entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name} · {prettyType(entity.type)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Relationship
          <select
            aria-label="Relationship"
            value={type}
            onChange={(event) =>
              setType(event.target.value as (typeof relationshipTypes)[number])
            }
          >
            {relationshipTypes.map((item) => (
              <option key={item} value={item}>
                {prettyType(item)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Second item
          <select
            aria-label="Second item"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          >
            {workspace.entities.map((entity) => (
              <option
                key={entity.id}
                value={entity.id}
                disabled={entity.id === from}
              >
                {entity.name} · {prettyType(entity.type)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Path group <span className="optional-label">Optional</span>
          <input
            aria-describedby="connection-group-help"
            list="connection-group-options"
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            placeholder="e.g. access, approval, authentication"
          />
          <datalist id="connection-group-options">
            {groupSuggestions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <small id="connection-group-help" className="form-note">
            Reuse an existing group when this is an alternate path for the same
            requirement. The simulator then knows either path can keep it
            available.
          </small>
        </label>
        <label>
          Plain-language label
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="e.g. recovered through"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="split-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!from || !to || from === to || saving}
          >
            {saving ? "Adding connection…" : "Add to baseline"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ManualRepairDialog({
  workspace,
  onClose,
  onCopy,
  onAdd,
  onEdit,
  onDelegate,
  onConnect,
  onSchedule,
}: {
  workspace: Workspace;
  onClose: () => void;
  onCopy: () => void;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onDelegate: () => void;
  onConnect: () => void;
  onSchedule: (id: string) => void;
}) {
  const [target, setTarget] = useState(workspace.entities[0]?.id ?? "");
  const peopleCount = workspace.entities.filter(
    (entity) => entity.type === "person",
  ).length;
  const canConnect = workspace.entities.length >= 2;
  const canDelegate = peopleCount >= 2;
  if (workspace.fictional)
    return (
      <Modal
        title="Manual repair"
        description="This fictional company is read-only so the original rehearsal stays intact."
        onClose={onClose}
      >
        <div className="manual-repair-gate">
          <span className="eyebrow">No AI required</span>
          <h3>Create a private editable copy</h3>
          <p>
            Then you can edit any item, assign fallback people, connect new
            recovery paths, and reschedule work directly in the baseline.
          </p>
          <button className="primary-button" onClick={onCopy}>
            Make editable copy
          </button>
        </div>
      </Modal>
    );
  const pickTarget = (action: "edit" | "schedule") => {
    if (!target) return;
    if (action === "edit") onEdit(target);
    else onSchedule(target);
  };
  return (
    <Modal
      title="Manual repair"
      description="Change the baseline yourself. Every edit is immediate, visible, and recorded in Activity."
      onClose={onClose}
      wide
    >
      <div className="manual-repair-layout">
        <section>
          <span className="eyebrow">Structure</span>
          <h3>Change the map</h3>
          <p>
            {canConnect
              ? "Add a person, system, document, workflow, or recovery route."
              : "Add at least two items before connecting a recovery path."}
          </p>
          <div className="repair-action-row">
            <button className="secondary-button" onClick={onAdd}>
              Add item
            </button>
            <button
              className="secondary-button"
              onClick={onConnect}
              disabled={!canConnect}
            >
              Connect items
            </button>
          </div>
        </section>
        <section>
          <span className="eyebrow">Coverage</span>
          <h3>Delegate critical work</h3>
          <p>
            {canDelegate
              ? "Choose a primary owner and a named fallback person."
              : "Add at least two people before assigning fallback coverage."}
          </p>
          <button
            className="secondary-button"
            onClick={onDelegate}
            disabled={!canDelegate}
          >
            Assign fallback
          </button>
        </section>
        <section className="manual-target-panel">
          <span className="eyebrow">Item-level changes</span>
          <h3>Edit or reschedule</h3>
          <select
            aria-label="Item to edit or reschedule"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            {workspace.entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>
          <div className="repair-action-row">
            <button
              className="secondary-button"
              onClick={() => pickTarget("schedule")}
              disabled={!target}
            >
              Reschedule
            </button>
            <button
              className="primary-button"
              onClick={() => pickTarget("edit")}
              disabled={!target}
            >
              Edit item
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

function ProposalEditor({
  workspace,
  proposal,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  proposal: Proposal;
  onClose: () => void;
  onSaved: (workspace: Workspace, proposal: Proposal) => void;
}) {
  const [title, setTitle] = useState(proposal.title);
  const relationshipChanges = proposal.changes.flatMap((change, index) =>
    change.op === "add-relationship" ? [{ change, index }] : [],
  );
  const entityChanges = proposal.changes.flatMap((change, index) =>
    change.op === "add-entity" ? [{ change, index }] : [],
  );
  const proposedEntities = entityChanges.map(({ change }) => change.entity);
  const items = [...workspace.entities, ...proposedEntities];
  const [targets, setTargets] = useState<Record<number, string>>(
    Object.fromEntries(
      relationshipChanges.map(({ change, index }) => [
        index,
        change.relationship.to,
      ]),
    ),
  );
  const [names, setNames] = useState<Record<number, string>>(
    Object.fromEntries(
      entityChanges.map(({ change, index }) => [index, change.entity.name]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await api.customizeProposal(workspace.slug, proposal.id, {
        workspaceVersion: workspace.version,
        title,
        relationshipTargets: relationshipChanges.map(({ index }) => ({
          changeIndex: index,
          to: targets[index]!,
        })),
        entityNames: entityChanges.map(({ index }) => ({
          changeIndex: index,
          name: names[index]!,
        })),
      });
      onSaved(result.workspace, result.proposal);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The option could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };
  const itemName = (id: string) =>
    items.find((item) => item.id === id)?.name ?? id;
  return (
    <Modal
      title="Adjust this option"
      description="Retarget the proposed fallback paths before applying. SAVE MY… reruns the deterministic scenario and refuses edits that reopen a blocked workflow."
      onClose={onClose}
      wide
    >
      <form className="proposal-editor" onSubmit={save}>
        <label>
          Option name
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </label>
        {entityChanges.length > 0 && (
          <section>
            <span className="eyebrow">New recovery items</span>
            {entityChanges.map(({ change, index }) => (
              <label key={index}>
                {change.entity.type.replaceAll("-", " ")}
                <input
                  value={names[index] ?? ""}
                  onChange={(event) =>
                    setNames((current) => ({
                      ...current,
                      [index]: event.target.value,
                    }))
                  }
                  required
                />
              </label>
            ))}
          </section>
        )}
        <section>
          <span className="eyebrow">Fallback paths</span>
          <div className="proposal-path-list">
            {relationshipChanges.map(({ change, index }) => (
              <label key={index}>
                <span>
                  <strong>{itemName(change.relationship.from)}</strong>
                  <small>
                    {change.relationship.label ?? change.relationship.type}
                  </small>
                </span>
                <select
                  value={targets[index]}
                  onChange={(event) =>
                    setTargets((current) => ({
                      ...current,
                      [index]: event.target.value,
                    }))
                  }
                >
                  {items
                    .filter((item) => item.id !== change.relationship.from)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </div>
        </section>
        {error && <p className="inline-error">{error}</p>}
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving || !title.trim()}>
            {saving ? "Rechecking…" : "Save adjusted option"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function PeopleView({
  workspace,
  onSelect,
  onAdd,
  onDelegate,
}: {
  workspace: Workspace;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelegate: () => void;
}) {
  const people = workspace.entities.filter(
    (entity) => entity.type === "person",
  );
  return (
    <div className="section-page">
      <header className="section-heading">
        <div>
          <span className="eyebrow">Ownership and coverage</span>
          <h2>People & roles</h2>
          <p>
            See who owns the work, where fallback coverage exists, and what
            still depends on one person.
          </p>
        </div>
        {!workspace.fictional && (
          <div className="section-heading-actions">
            <button className="secondary-button" onClick={onAdd}>
              Add person
            </button>
            <button
              className="primary-button"
              onClick={onDelegate}
              disabled={people.length < 2}
              title={
                people.length < 2
                  ? "Add at least two people before assigning fallback coverage"
                  : undefined
              }
            >
              Assign fallback
            </button>
          </div>
        )}
      </header>
      <div className="people-grid">
        {people.map((person) => {
          const responsibilities = workspace.relationships
            .filter(
              (relationship) =>
                relationship.to === person.id &&
                ["owned-by", "administered-by", "accessible-by"].includes(
                  relationship.type,
                ),
            )
            .map((relationship) =>
              workspace.entities.find(
                (entity) => entity.id === relationship.from,
              ),
            )
            .filter(Boolean) as Entity[];
          const fallbackFor = workspace.relationships
            .filter(
              (relationship) =>
                relationship.from === person.id &&
                relationship.type === "substitutes-for",
            )
            .map((relationship) =>
              workspace.entities.find(
                (entity) => entity.id === relationship.to,
              ),
            )
            .filter(Boolean) as Entity[];
          return (
            <button
              className="person-card"
              key={person.id}
              onClick={() => onSelect(person.id)}
            >
              <OptionalImage src={person.image} />
              <div>
                <span>{person.team ?? "Company"}</span>
                <strong>{person.name}</strong>
                <p>{person.role ?? person.description}</p>
              </div>
              <dl>
                <div>
                  <dt>Primary responsibilities</dt>
                  <dd>
                    {responsibilities.length
                      ? responsibilities.map((item) => item.name).join(", ")
                      : "No explicit ownership yet"}
                  </dd>
                </div>
                <div>
                  <dt>Fallback for</dt>
                  <dd>
                    {fallbackFor.length
                      ? fallbackFor.map((item) => item.name).join(", ")
                      : "Not assigned"}
                  </dd>
                </div>
              </dl>
            </button>
          );
        })}
      </div>
      {people.length === 0 && (
        <section className="section-empty-state" role="status">
          <span className="eyebrow">No people mapped</span>
          <h3>Add the owners behind critical work</h3>
          <p>
            Add people manually, then connect them to the workflows, accounts,
            and systems they own or can recover.
          </p>
          {!workspace.fictional && (
            <button className="primary-button" onClick={onAdd}>
              Add first person
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function ActivityView({ workspace }: { workspace: Workspace }) {
  return (
    <div className="section-page">
      <header className="section-heading">
        <div>
          <span className="eyebrow">Human and agent audit trail</span>
          <h2>Activity</h2>
          <p>
            Every proposal, decision, edit, and scenario remains attributable.
          </p>
        </div>
      </header>
      <div className="activity-list">
        {workspace.activity.map((entry) => (
          <article key={entry.id}>
            <span className={`actor ${entry.actor}`}>{entry.actor}</span>
            <div>
              <strong>
                {prettyType(entry.action.toLowerCase().replaceAll("_", "-"))}
              </strong>
              <p>{entry.detail}</p>
            </div>
            <time>
              {formatDate(entry.at)} · v{entry.version}
            </time>
          </article>
        ))}
      </div>
      {workspace.activity.length === 0 && (
        <section className="section-empty-state" role="status">
          <span className="eyebrow">No recorded changes</span>
          <h3>Activity will appear here</h3>
          <p>
            Manual edits, agent-authored proposals, decisions, and scenario
            changes remain attributable once they happen.
          </p>
        </section>
      )}
    </div>
  );
}

function Inspector({
  workspace,
  entity,
  simulation,
  onEdit,
  onConnect,
  onSchedule,
  onClose,
  proposed = false,
}: {
  workspace: Workspace;
  entity: Entity;
  simulation: SimulationResult | null;
  onEdit: () => void;
  onConnect: () => void;
  onSchedule: () => void;
  onClose: () => void;
  proposed?: boolean;
}) {
  const [imageUnavailable, setImageUnavailable] = useState(false);
  useEffect(() => setImageUnavailable(false), [entity.id, entity.image]);
  const hasImage = Boolean(entity.image) && !imageUnavailable;
  const connections = workspace.relationships.filter(
    (relationship) =>
      relationship.from === entity.id || relationship.to === entity.id,
  );
  const blocked = simulation?.blockedEntityIds.includes(entity.id);
  return (
    <aside
      className={`entity-inspector ${hasImage ? "has-image" : "no-image"}`}
    >
      <header>
        <span className="eyebrow">{prettyType(entity.type)}</span>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close details"
        >
          <CloseIcon />
        </button>
      </header>
      {hasImage && (
        <OptionalImage
          className="inspector-image"
          src={entity.image}
          onUnavailable={() => setImageUnavailable(true)}
        />
      )}
      <div className="inspector-summary">
        <div className="inspector-title">
          <h2>{entity.name}</h2>
          <span className={`state-pill ${entity.trust.toLowerCase()}`}>
            {proposed
              ? "Proposed · not applied"
              : blocked
                ? "Blocked in scenario"
                : trustLabel[entity.trust]}
          </span>
        </div>
        <p className="inspector-role">
          {entity.role}
          {entity.team ? ` · ${entity.team}` : ""}
        </p>
        <p>{entity.description || "No description yet."}</p>
        <footer>
          {proposed ? (
            <p>Review this staged item in the proposal before applying it.</p>
          ) : workspace.fictional ? (
            <p>Duplicate this demo to edit this item.</p>
          ) : (
            <>
              <button
                className="secondary-button"
                onClick={onConnect}
                disabled={workspace.entities.length < 2}
                title={
                  workspace.entities.length < 2
                    ? "Add another item before creating a connection"
                    : undefined
                }
              >
                Add connection
              </button>
              <button className="secondary-button" onClick={onSchedule}>
                Reschedule
              </button>
              <button className="primary-button" onClick={onEdit}>
                Edit item
              </button>
            </>
          )}
        </footer>
      </div>
      <dl className="detail-list">
        <div className="evidence-detail">
          <dt>Evidence</dt>
          <dd>
            <strong>{trustLabel[entity.trust]}</strong>
            <small>{trustDescription[entity.trust]}</small>
          </dd>
        </div>
        <div>
          <dt>Critical</dt>
          <dd>{entity.critical ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt>Scheduled</dt>
          <dd>{formatDate(entity.metadata?.dueAt)}</dd>
        </div>
        <div>
          <dt>Execution</dt>
          <dd>
            {entity.metadata?.executionMode
              ? prettyType(entity.metadata.executionMode)
              : "Human owned"}
          </dd>
        </div>
        <div>
          <dt>Connections</dt>
          <dd>{connections.length}</dd>
        </div>
      </dl>
      <section className="connection-list">
        <h3>Connected work</h3>
        {connections.length === 0 && <p>No connections yet.</p>}
        {connections.slice(0, 6).map((relationship) => {
          const otherId =
            relationship.from === entity.id
              ? relationship.to
              : relationship.from;
          const other = workspace.entities.find((item) => item.id === otherId);
          return (
            <div key={relationship.id}>
              <span>{relationship.label ?? relationship.type}</span>
              <strong>{other?.name}</strong>
            </div>
          );
        })}
      </section>
    </aside>
  );
}

function RepairPlanPanel({
  workspace,
  proposal,
  onAdjust,
  onClose,
}: {
  workspace: Workspace;
  proposal: Proposal;
  onAdjust: () => void;
  onClose: () => void;
}) {
  const proposalKind = resolvedProposalKind(proposal);
  const isAdjustable =
    proposalKind === "REPAIR" || proposalKind === "MAP_DRAFT";
  const authorLabel =
    proposal.createdBy === "agent"
      ? "Agent-authored"
      : proposal.createdBy === "human"
        ? "Human-authored"
        : "Rules-authored";
  const proposedEntities = proposal.changes.flatMap((change) =>
    change.op === "add-entity" ? [change.entity] : [],
  );
  const itemName = (id: string) =>
    [...workspace.entities, ...proposedEntities].find((item) => item.id === id)
      ?.name ?? id;
  const formatValue = (value: unknown): string => {
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (value === null || value === undefined) return "Not set";
    if (typeof value === "object")
      return Object.entries(value)
        .map(([key, nested]) => `${prettyType(key)}: ${formatValue(nested)}`)
        .join(" · ");
    return String(value);
  };

  return (
    <aside className="repair-plan-panel" aria-label="Exact proposed changes">
      <header>
        <div>
          <span className="eyebrow">What will change</span>
          <strong>{proposal.title}</strong>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Hide proposed changes"
        >
          <CloseIcon />
        </button>
      </header>
      <div className="repair-plan-scroll">
        <section className="repair-plan-rationale">
          <strong>
            {proposalKind === "REPAIR"
              ? "Why this repair"
              : "Why this proposal"}
          </strong>
          <p>{proposal.rationale}</p>
        </section>
        {proposal.tradeoff && (
          <dl className="repair-tradeoff-grid">
            <div>
              <dt>Effort</dt>
              <dd>{prettyType(proposal.tradeoff.effort)}</dd>
            </div>
            <div>
              <dt>Restore in</dt>
              <dd>{proposal.tradeoff.timeToRestoreHours}h</dd>
            </div>
            <div>
              <dt>Residual risk</dt>
              <dd>{prettyType(proposal.tradeoff.residualRisk)}</dd>
            </div>
            <div className="repair-tradeoff-summary">
              <dt>Tradeoff</dt>
              <dd>{proposal.tradeoff.summary}</dd>
            </div>
          </dl>
        )}
        <section className="repair-change-list">
          <header>
            <strong>Exact changes</strong>
            <span>{proposal.changes.length}</span>
          </header>
          <ol>
            {proposal.changes.map((change, index) => {
              if (change.op === "add-entity")
                return (
                  <li key={`${change.op}-${change.entity.id}`}>
                    <span>Add item</span>
                    <strong>{change.entity.name}</strong>
                    <p>
                      {prettyType(change.entity.type)}
                      {change.entity.role ? ` · ${change.entity.role}` : ""}
                    </p>
                    {change.entity.description && (
                      <small>{change.entity.description}</small>
                    )}
                  </li>
                );
              if (change.op === "add-relationship")
                return (
                  <li key={`${change.op}-${change.relationship.id}`}>
                    <span>Add path</span>
                    <strong>
                      {itemName(change.relationship.from)} →{" "}
                      {itemName(change.relationship.to)}
                    </strong>
                    <p>
                      {change.relationship.label ??
                        prettyType(change.relationship.type)}
                    </p>
                    <small>
                      Relationship: {prettyType(change.relationship.type)}
                      {change.relationship.group
                        ? ` · Alternate-path group: ${change.relationship.group}`
                        : ""}
                    </small>
                  </li>
                );
              return (
                <li key={`${change.op}-${change.entityId}-${index}`}>
                  <span>Update item</span>
                  <strong>{itemName(change.entityId)}</strong>
                  <dl>
                    {Object.entries(change.patch).map(([field, value]) => (
                      <div key={field}>
                        <dt>{prettyType(field)}</dt>
                        <dd>{formatValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
          </ol>
        </section>
        {proposal.assumptions.length > 0 && (
          <section className="repair-assumptions">
            <strong>Assumptions to verify</strong>
            <ul>
              {proposal.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <footer>
        <span>{authorLabel} · baseline unchanged</span>
        {isAdjustable && (
          <button className="secondary-button" onClick={onAdjust}>
            Adjust option
          </button>
        )}
      </footer>
    </aside>
  );
}

function WorkspaceApp({
  bootstrap,
  accountToolsReady,
  accountToolCalls,
  workspaceToolsRegistrationRevision,
  initialSlug,
  onHome,
  onOpen,
  onRefreshBootstrap,
  onWorkspaceToolsStatus,
}: {
  bootstrap: Bootstrap;
  accountToolsReady: boolean;
  accountToolCalls: WebMcpCallLog[];
  workspaceToolsRegistrationRevision: number;
  initialSlug: string;
  onHome: () => void;
  onOpen: (slug: string) => void;
  onRefreshBootstrap: () => Promise<void>;
  onWorkspaceToolsStatus: (
    slug: string,
    ready: boolean,
    settleWaiters?: boolean,
  ) => void;
}) {
  const [data, setData] = useState<WorkspaceState | null>(null);
  const [section, setSection] = useState<Section>("map");
  const [mapMode, setMapMode] = useState<MapMode>("baseline");
  const [repairView, setRepairView] = useState<RepairView>("after");
  const [repairComparison, setRepairComparison] =
    useState<ProposalComparison | null>(null);
  const [repairComparisonError, setRepairComparisonError] = useState("");
  const [activeScenarioId, setActiveScenarioId] = useState<string>();
  const [activeProposalId, setActiveProposalId] = useState<string>();
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [focusedIds, setFocusedIds] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [manualRepairOpen, setManualRepairOpen] = useState(false);
  const [proposalEditorOpen, setProposalEditorOpen] = useState(false);
  const [repairPlanOpen, setRepairPlanOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState<"new" | "edit" | null>(null);
  const [delegationOpen, setDelegationOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectionFromId, setConnectionFromId] = useState<string>();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [deleteConfirmSlug, setDeleteConfirmSlug] = useState<string>();
  const [deletingCompany, setDeletingCompany] = useState(false);
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<
    "apply-proposal" | "discard-proposal" | null
  >(null);
  const [webmcpReady, setWebmcpReady] = useState(false);
  const [webmcpSettled, setWebmcpSettled] = useState(false);
  const [webmcpLogOpen, setWebmcpLogOpen] = useState(false);
  const [agentRepairOpen, setAgentRepairOpen] = useState(false);
  const [agentBlueprintOpen, setAgentBlueprintOpen] = useState(false);
  const [agentScenarioOpen, setAgentScenarioOpen] = useState(false);
  const [companyCreateOpen, setCompanyCreateOpen] = useState(false);
  const [companySettingsOpen, setCompanySettingsOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountPending, setAccountPending] = useState(false);
  const [webmcpCalls, setWebmcpCalls] = useState<WebMcpCallLog[]>([]);
  const workspaceRef = useRef<Workspace | null>(null);
  const activeScenarioIdRef = useRef<string | undefined>(undefined);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const accountFirstActionRef = useRef<HTMLButtonElement>(null);
  const visibleWebmcpCalls = [...accountToolCalls, ...webmcpCalls].slice(-50);

  const load = useCallback(
    async (target?: ProposalCreatedTarget) => {
      setError("");
      try {
        const next = await api.workspace(initialSlug);
        setError("");
        setData(next);
        setSimulation((current) =>
          current &&
          next.workspace.scenarios.some(
            (item) => item.id === current.scenarioId,
          )
            ? current
            : null,
        );
        const preferredScenarioId =
          target?.scenarioId ?? activeScenarioIdRef.current;
        const preferredScenarioExists = next.workspace.scenarios.some(
          (item) => item.id === preferredScenarioId,
        );
        const pendingRepair =
          next.workspace.proposals.find(
            (item) =>
              item.status === "PROPOSED" &&
              item.kind === "REPAIR" &&
              item.id === target?.proposalId,
          ) ??
          next.workspace.proposals.find(
            (item) => item.status === "PROPOSED" && item.kind === "REPAIR",
          );
        const nextScenarioId = preferredScenarioExists
          ? preferredScenarioId
          : (pendingRepair?.scenarioId ?? next.workspace.scenarios[0]?.id);
        activeScenarioIdRef.current = nextScenarioId;
        setActiveScenarioId(nextScenarioId);
        if (target?.proposalId || (!preferredScenarioExists && pendingRepair)) {
          setActiveProposalId(pendingRepair?.id);
          setRepairView("after");
          setMapMode("proposal");
        }
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Company could not be loaded.",
        );
      }
    },
    [initialSlug],
  );
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    activeScenarioIdRef.current = undefined;
    setData(null);
    setSelectedId(undefined);
    setSection("map");
    setMapMode("baseline");
    void load();
  }, [load]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const workspace = data?.workspace;
  workspaceRef.current = workspace ?? null;
  activeScenarioIdRef.current = activeScenarioId;
  const workspaceSlug = workspace?.slug;
  const loadedProposal =
    workspace?.proposals.find(
      (item) => item.status === "PROPOSED" && item.id === activeProposalId,
    ) ??
    workspace?.proposals.find(
      (item) =>
        item.status === "PROPOSED" &&
        (!activeScenarioId ||
          !item.scenarioId ||
          item.scenarioId === activeScenarioId),
    );
  const proposalPreviewWorkspace = useMemo(() => {
    if (!workspace) return null;
    return mapMode === "proposal" && repairView === "after" && loadedProposal
      ? applyProposalChanges(workspace, loadedProposal.changes)
      : workspace;
  }, [loadedProposal, mapMode, repairView, workspace]);
  useEffect(() => {
    if (
      mapMode !== "proposal" ||
      !workspace ||
      !loadedProposal ||
      !activeScenarioId ||
      loadedProposal.kind !== "REPAIR"
    )
      return;
    let cancelled = false;
    setRepairComparison(null);
    setRepairComparisonError("");
    api
      .compare(workspace.slug, loadedProposal.id, activeScenarioId)
      .then((comparison) => {
        if (!cancelled) setRepairComparison(comparison);
      })
      .catch((reason) => {
        if (!cancelled) {
          const message =
            reason instanceof Error
              ? reason.message
              : "Repair comparison could not be loaded.";
          setRepairComparisonError(message);
          setError(message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeScenarioId, loadedProposal, mapMode, workspace]);
  useEffect(() => {
    let active = true;
    setWebmcpCalls([]);
    setWebmcpReady(false);
    setWebmcpSettled(false);
    const registration = registerSaveMyTools({
      getWorkspace: () => {
        const current = workspaceRef.current;
        if (!current) throw new Error("Workspace is not ready.");
        return current;
      },
      onFocus: (ids) => {
        setFocusedIds(ids);
        setSection("map");
      },
      onScenario: (scenario, nextSimulation, persisted) => {
        setAgentScenarioOpen(false);
        setActiveScenarioId(scenario.id);
        setSimulation(nextSimulation);
        setSection("map");
        setMapMode("scenario");
        if (persisted) void loadRef.current();
      },
      onProposalCreated: (target) => {
        setAgentBlueprintOpen(false);
        setAgentRepairOpen(false);
        if (target?.scenarioId) {
          activeScenarioIdRef.current = target.scenarioId;
          setActiveScenarioId(target.scenarioId);
        }
        if (target?.proposalId) setActiveProposalId(target.proposalId);
        setSection("map");
        setMapMode("proposal");
        setRepairPlanOpen(false);
        void loadRef.current(target);
      },
      onToolCall: (entry) => {
        setWebmcpCalls((current) => {
          const existing = current.findIndex((item) => item.id === entry.id);
          const next =
            existing === -1
              ? [...current, entry]
              : current.map((item, index) =>
                  index === existing ? entry : item,
                );
          return next.slice(-50);
        });
      },
    });
    registration.ready
      .then(() => {
        if (!active) return;
        setWebmcpReady(registration.supported);
        setWebmcpSettled(true);
      })
      .catch(() => {
        if (!active) return;
        setWebmcpReady(false);
        setWebmcpSettled(true);
      });
    return () => {
      active = false;
      registration.cleanup();
    };
  }, [workspaceToolsRegistrationRevision]);
  useEffect(() => {
    if (!workspaceSlug || !webmcpSettled) return;
    onWorkspaceToolsStatus(workspaceSlug, webmcpReady);
    return () => onWorkspaceToolsStatus(workspaceSlug, false, false);
  }, [onWorkspaceToolsStatus, webmcpReady, webmcpSettled, workspaceSlug]);
  useEffect(() => {
    if (!workspaceSlug || workspace?.entities.length !== 0) return;
    const preference = sessionStorage.getItem(
      setupPreferenceKey(workspaceSlug),
    ) as CompanySetupMode | null;
    if (!preference) return;
    sessionStorage.removeItem(setupPreferenceKey(workspaceSlug));
    if (preference === "manual") setEditorOpen("new");
    else setAgentBlueprintOpen(true);
  }, [workspace?.entities.length, workspaceSlug]);
  useEffect(() => {
    if (!accountMenuOpen) return;
    const frame = window.requestAnimationFrame(() =>
      accountFirstActionRef.current?.focus(),
    );
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
        window.requestAnimationFrame(() => accountTriggerRef.current?.focus());
      }
    };
    window.addEventListener("keydown", close);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", close);
    };
  }, [accountMenuOpen]);

  if (!workspace || !data) {
    if (error)
      return (
        <main className="loading-screen loading-error">
          <Brand />
          <span className="eyebrow">Company unavailable</span>
          <h1>We couldn’t load this company.</h1>
          <p role="alert">{error}</p>
          <div className="loading-error-actions">
            <button className="primary-button" onClick={() => void load()}>
              Try again
            </button>
            <button className="secondary-button" onClick={onHome}>
              Back to companies
            </button>
          </div>
        </main>
      );
    return <WorkspaceLoading label="Loading company map" />;
  }
  const activeScenario =
    workspace.scenarios.find((item) => item.id === activeScenarioId) ??
    workspace.scenarios[0];
  const proposal = loadedProposal ?? null;
  const proposalKind = proposal ? resolvedProposalKind(proposal) : undefined;
  const isRepairProposal = proposalKind === "REPAIR";
  const isBaselineDraft = Boolean(proposal && !isRepairProposal);
  const proposalReviewLabel =
    proposalKind === "MAP_DRAFT"
      ? "Review company map"
      : proposalKind === "DELEGATION"
        ? "Review fallback draft"
        : proposalKind === "SCHEDULE"
          ? "Review schedule draft"
          : "Review repair";
  const proposalEyebrow =
    proposalKind === "MAP_DRAFT"
      ? "Company map draft"
      : proposalKind === "DELEGATION"
        ? "Fallback coverage draft"
        : proposalKind === "SCHEDULE"
          ? "Schedule change draft"
          : "Repair preview";
  const proposalContextTitle =
    proposalKind === "MAP_DRAFT"
      ? "Agent-staged company map"
      : proposalKind === "DELEGATION"
        ? "Staged fallback coverage"
        : proposalKind === "SCHEDULE"
          ? "Staged schedule change"
          : "Scenario repair";
  const proposalOptions = workspace.proposals.filter(
    (item) =>
      item.status === "PROPOSED" &&
      item.kind === "REPAIR" &&
      item.scenarioId === activeScenario?.id &&
      (!proposal?.optionGroupId ||
        item.optionGroupId === proposal.optionGroupId),
  );
  const previewWorkspace = proposalPreviewWorkspace ?? workspace;
  const selected = previewWorkspace.entities.find(
    (item) => item.id === selectedId,
  );
  const selectedIsProposed = Boolean(
    proposal &&
    repairView === "after" &&
    proposal.changes.some(
      (change) => change.op === "add-entity" && change.entity.id === selectedId,
    ),
  );
  const repairCanBeApplied =
    !isRepairProposal ||
    Boolean(
      repairComparison &&
      !repairComparisonError &&
      repairComparison.after.blockedWorkflowIds.length === 0,
    );
  const runScenario = async (scenario: Scenario) => {
    setError("");
    try {
      const result = await api.simulate(
        workspace.slug,
        scenario,
        workspace.version,
      );
      setActiveScenarioId(scenario.id);
      setSimulation(result.simulation);
      setMapMode("scenario");
      setFocusedIds(result.simulation.smallestRelevantEntityIds);
      setSection("map");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The scenario could not be simulated.",
      );
    }
  };
  const duplicate = async () => {
    try {
      const { workspace: copy } = await api.duplicateWorkspace(workspace.slug);
      await onRefreshBootstrap();
      onOpen(copy.slug);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Sign in to create an editable copy.",
      );
    }
  };
  const resetDemo = async () => {
    setError("");
    try {
      await api.reset(workspace.slug);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The demo could not be reset.",
      );
    }
  };
  const decide = async (decision: "accept" | "reject") => {
    if (!proposal || pendingAction) return;
    if (decision === "accept" && !repairCanBeApplied) {
      setError(
        repairComparisonError ||
          "Wait for a verified zero-blocked comparison before applying this repair.",
      );
      return;
    }
    setPendingAction(
      decision === "accept" ? "apply-proposal" : "discard-proposal",
    );
    setError("");
    try {
      await api.decide(
        workspace.slug,
        proposal.id,
        decision,
        workspace.version,
      );
      const next = await api.workspace(workspace.slug);
      setData(next);
      setRepairComparison(null);
      setRepairComparisonError("");
      if (
        decision === "accept" &&
        activeScenario &&
        proposal.kind === "REPAIR"
      ) {
        const updatedScenario = next.workspace.scenarios.find(
          (item) => item.id === activeScenario.id,
        );
        if (updatedScenario) {
          const result = await api.simulate(
            next.workspace.slug,
            updatedScenario,
            next.workspace.version,
          );
          setSimulation(result.simulation);
          setMapMode("scenario");
        }
        setActiveProposalId(undefined);
      } else if (decision === "reject" && proposal.kind === "REPAIR") {
        const nextOption = next.workspace.proposals.find(
          (item) =>
            item.status === "PROPOSED" &&
            item.kind === "REPAIR" &&
            item.scenarioId === activeScenario?.id,
        );
        setActiveProposalId(nextOption?.id);
        setMapMode(nextOption ? "proposal" : "scenario");
      } else {
        setActiveProposalId(undefined);
        setMapMode("baseline");
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : decision === "accept"
            ? "The proposal could not be applied."
            : "The proposal could not be discarded.",
      );
    } finally {
      setPendingAction(null);
    }
  };
  const deleteCompany = async () => {
    if (!deleteConfirmSlug || deletingCompany) return;
    const slug = deleteConfirmSlug;
    setDeletingCompany(true);
    setError("");
    try {
      const target =
        slug === workspace.slug
          ? workspace
          : (await api.workspace(slug)).workspace;
      await api.deleteWorkspace(slug, target.version);
      setDeleteConfirmSlug(undefined);
      await onRefreshBootstrap();
      if (slug === workspace.slug) onHome();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Company could not be deleted.",
      );
    } finally {
      setDeletingCompany(false);
    }
  };
  const logout = async () => {
    if (accountPending) return;
    setAccountPending(true);
    setError("");
    try {
      await api.logout();
      setAccountMenuOpen(false);
      await onRefreshBootstrap();
      onHome();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign out failed.");
    } finally {
      setAccountPending(false);
    }
  };
  const companyPendingDeletion = deleteConfirmSlug
    ? bootstrap.workspaces.find((item) => item.slug === deleteConfirmSlug)
    : undefined;
  const visibleSimulation = (() => {
    if (mapMode === "baseline") return null;
    if (mapMode !== "proposal") return simulation;
    if (!isRepairProposal) return null;
    return repairView === "before"
      ? (repairComparison?.before ?? simulation)
      : (repairComparison?.after ?? null);
  })();
  const restoredIds = repairComparison
    ? [
        ...repairComparison.restoredEntityIds,
        ...repairComparison.restoredWorkflowIds,
      ]
    : [];
  const failureOriginNames =
    visibleSimulation?.unavailableEntityIds
      .map((id) => workspace.entities.find((item) => item.id === id)?.name)
      .filter((name): name is string => Boolean(name)) ?? [];
  const scenarioResolved = Boolean(
    activeScenario?.resolution?.status === "RESOLVED" &&
    simulation?.scenarioId === activeScenario.id &&
    simulation.blockedWorkflowIds.length === 0,
  );
  const scenarioStatusText =
    mapMode === "proposal" && proposal?.kind === "REPAIR"
      ? repairComparison
        ? repairView === "after"
          ? `Proposed outcome · ${repairComparison.after.blockedWorkflowIds.length} blocked if applied`
          : `Current failure · ${repairComparison.before.blockedWorkflowIds.length} blocked now`
        : repairComparisonError
          ? repairView === "after"
            ? "Proposed outcome · impact unavailable"
            : "Current failure · comparison unavailable"
          : repairView === "after"
            ? "Proposed outcome · calculating impact"
            : "Current failure · calculating impact"
      : scenarioResolved
        ? "Resolved · all critical workflows continue"
        : `Failure origin · ${simulation?.blockedWorkflowIds.length ?? 0} blocked`;
  const scenarioOriginText = scenarioResolved
    ? `Contained despite ${failureOriginNames.join(" + ")}`
    : failureOriginNames.join(" + ");

  return (
    <main className="app-shell">
      <aside className="app-sidebar">
        <button className="sidebar-brand" onClick={onHome}>
          <Brand />
        </button>
        <nav className="primary-nav" aria-label="Company navigation">
          <button
            className={section === "map" ? "active" : ""}
            aria-label="Continuity map"
            aria-current={section === "map" ? "page" : undefined}
            onClick={() => setSection("map")}
          >
            <MapIcon />
            <span>Continuity map</span>
          </button>
          <button
            className={section === "scenarios" ? "active" : ""}
            aria-label={`Scenarios, ${workspace.scenarios.length}`}
            aria-current={section === "scenarios" ? "page" : undefined}
            onClick={() => setSection("scenarios")}
          >
            <BreakIcon />
            <span>Scenarios</span>
            <small>{workspace.scenarios.length}</small>
          </button>
          <button
            className={section === "people" ? "active" : ""}
            aria-label="People and roles"
            aria-current={section === "people" ? "page" : undefined}
            onClick={() => setSection("people")}
          >
            <PersonIcon />
            <span>People & roles</span>
          </button>
          <button
            className={section === "activity" ? "active" : ""}
            aria-label="Activity"
            aria-current={section === "activity" ? "page" : undefined}
            onClick={() => setSection("activity")}
          >
            <ListIcon />
            <span>Activity</span>
          </button>
        </nav>
        <div className="company-switcher">
          <div className="company-switcher-heading">
            <span className="sidebar-label">Switch company</span>
            {bootstrap.user && (
              <button
                className="company-create-shortcut"
                onClick={() => setCompanyCreateOpen(true)}
                aria-label="New company"
              >
                + New
              </button>
            )}
          </div>
          {bootstrap.workspaces
            .filter((item) => !item.archived)
            .map((item) => (
              <div className="company-switch-row" key={item.slug}>
                <button
                  className={`company-open ${item.slug === workspace.slug ? "active" : ""}`}
                  aria-label={`Open ${item.name}, ${item.fictional ? "demo" : "your company"}`}
                  aria-current={
                    item.slug === workspace.slug ? "page" : undefined
                  }
                  onClick={() => onOpen(item.slug)}
                >
                  <img
                    src={item.cover ?? "/assets/nodes/studio/25.webp"}
                    alt=""
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.fictional ? "Demo" : "Your company"}</small>
                  </span>
                </button>
                {!item.fictional && (
                  <button
                    className="company-delete"
                    aria-label={`Delete ${item.name}`}
                    title={`Delete ${item.name}`}
                    onClick={() => setDeleteConfirmSlug(item.slug)}
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            ))}
        </div>
        <div className="sidebar-account-wrap">
          {accountMenuOpen && (
            <div
              className="sidebar-account-popover"
              role="dialog"
              aria-label="Account and company actions"
            >
              <span className="eyebrow">Account and companies</span>
              <button
                ref={accountFirstActionRef}
                onClick={() => {
                  setAccountMenuOpen(false);
                  onHome();
                }}
              >
                All companies
              </button>
              {bootstrap.user ? (
                <>
                  {!workspace.fictional && (
                    <button
                      onClick={() => {
                        setAccountMenuOpen(false);
                        setCompanySettingsOpen(true);
                      }}
                    >
                      Company settings
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setAccountMenuOpen(false);
                      setCompanyCreateOpen(true);
                    }}
                  >
                    New company
                  </button>
                  <button
                    disabled={accountPending}
                    onClick={() => void logout()}
                  >
                    {accountPending ? "Signing out…" : "Sign out"}
                  </button>
                </>
              ) : (
                <button onClick={onHome}>Sign in to add a company</button>
              )}
            </div>
          )}
          <button
            ref={accountTriggerRef}
            className="sidebar-account"
            onClick={() => setAccountMenuOpen((current) => !current)}
            aria-haspopup="dialog"
            aria-expanded={accountMenuOpen}
            aria-label={`${bootstrap.user?.name ?? "Guest mode"} account menu`}
          >
            <div className="avatar">{bootstrap.user ? "JA" : "G"}</div>
            <span>
              <strong>{bootstrap.user?.name ?? "Guest mode"}</strong>
              <small>{bootstrap.user?.email ?? "Demos only"}</small>
            </span>
            <MoreIcon />
          </button>
        </div>
      </aside>

      <section className="app-main">
        <header className="app-header">
          <div>
            <span className="eyebrow">
              {sectorLabel[workspace.sector]} ·{" "}
              {workspace.fictional ? "Fictional demo" : "Private company"}
            </span>
            <h1>{workspace.name}</h1>
          </div>
          <div className="header-actions">
            <button
              className="search-button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search company"
            >
              <SearchIcon />
              <span>Search company</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className={`agent-status ${webmcpReady && accountToolsReady ? "ready" : ""}`}
              onClick={() => setWebmcpLogOpen(true)}
              aria-label={`Open Site Tool call log, ${visibleWebmcpCalls.length} calls`}
              title="Open Site Tool call log"
            >
              <SiteToolsIcon />
              <i className="agent-ready-dot" />
              <span className="agent-status-label">
                {webmcpReady && accountToolsReady
                  ? `Site Tools · ${bootstrap.webmcp.tools} ready`
                  : webmcpReady
                    ? "Workspace tools connected"
                    : "Site Tools unavailable"}
              </span>
              <small>{visibleWebmcpCalls.length}</small>
            </button>
            {workspace.fictional && (
              <button
                className="secondary-button duplicate-workspace-button"
                onClick={() => void duplicate()}
              >
                <span className="duplicate-label-full">Make editable copy</span>
                <span className="duplicate-label-compact">Edit a copy</span>
              </button>
            )}
            {workspace.fictional && (
              <button
                className="icon-button"
                onClick={() => void resetDemo()}
                aria-label="Reset demo"
              >
                <ResetIcon />
              </button>
            )}
            {!workspace.fictional && (
              <button
                className="icon-button delete-current"
                onClick={() => setDeleteConfirmSlug(workspace.slug)}
                aria-label={`Delete ${workspace.name}`}
                title={`Delete ${workspace.name}`}
              >
                <TrashIcon />
              </button>
            )}
          </div>
        </header>

        {section === "map" && (
          <div className="map-page">
            <header
              className={`map-toolbar ${
                mapMode === "baseline"
                  ? "baseline-mode"
                  : isBaselineDraft
                    ? "blueprint-mode"
                    : "scenario-mode"
              }`}
            >
              <div className="segmented">
                <button
                  className={
                    mapMode === "baseline" ||
                    (mapMode === "proposal" && isBaselineDraft)
                      ? "active"
                      : ""
                  }
                  aria-pressed={
                    mapMode === "baseline" ||
                    (mapMode === "proposal" && isBaselineDraft)
                  }
                  onClick={() => {
                    setMapMode("baseline");
                    setSimulation(null);
                    setFocusedIds([]);
                  }}
                >
                  Baseline map
                </button>
                <button
                  className={
                    mapMode === "scenario" ||
                    (mapMode === "proposal" && proposal?.kind === "REPAIR")
                      ? "active"
                      : ""
                  }
                  aria-pressed={
                    mapMode === "scenario" ||
                    (mapMode === "proposal" && proposal?.kind === "REPAIR")
                  }
                  disabled={!activeScenario}
                  onClick={() =>
                    activeScenario && void runScenario(activeScenario)
                  }
                >
                  Scenario view
                </button>
              </div>
              <div
                className={`map-context ${
                  mapMode === "baseline"
                    ? "baseline-context"
                    : isBaselineDraft
                      ? "blueprint-context"
                      : "scenario-context"
                }`}
              >
                {mapMode === "baseline" ? (
                  <>
                    <VerifyIcon />
                    <span>
                      <strong>Current company</strong>
                      <small>
                        {workspace.entities.length} items ·{" "}
                        {data.validation.counts.SINGLE_POINT} single-path
                        dependencies
                      </small>
                    </span>
                  </>
                ) : isBaselineDraft && proposal ? (
                  <>
                    <VerifyIcon />
                    <span>
                      <strong>{proposalContextTitle}</strong>
                      <small>
                        {proposalChangeSummary(proposal)} · review required
                      </small>
                    </span>
                  </>
                ) : (
                  <>
                    <label className="scenario-select">
                      <span className="scenario-select-label">Scenario</span>
                      <select
                        aria-label="Active scenario"
                        value={activeScenario?.id}
                        onChange={(event) => {
                          const next = workspace.scenarios.find(
                            (item) => item.id === event.target.value,
                          );
                          if (next) void runScenario(next);
                        }}
                      >
                        {workspace.scenarios.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.resolution?.status === "RESOLVED"
                              ? `Resolved · ${item.name}`
                              : item.name}
                          </option>
                        ))}
                      </select>
                      <span className="select-chevron" aria-hidden="true">
                        ⌄
                      </span>
                    </label>
                    <span className="scenario-origin" role="status">
                      <small>{scenarioStatusText}</small>
                      <strong>{scenarioOriginText}</strong>
                    </span>
                  </>
                )}
              </div>
              <div className="map-actions">
                {mapMode === "baseline" && (
                  <button
                    className="secondary-button connect-items-button"
                    disabled={
                      !workspace.fictional && workspace.entities.length < 2
                    }
                    title={
                      !workspace.fictional && workspace.entities.length < 2
                        ? "Add at least two items before connecting them"
                        : undefined
                    }
                    onClick={() => {
                      if (workspace.fictional) setManualRepairOpen(true);
                      else {
                        setConnectionFromId(undefined);
                        setConnectionOpen(true);
                      }
                    }}
                  >
                    Connect items
                  </button>
                )}
                <button
                  className="secondary-button new-scenario-button"
                  disabled={workspace.entities.length === 0}
                  title={
                    workspace.entities.length === 0
                      ? "Add a company-map item before creating a scenario"
                      : undefined
                  }
                  onClick={() => setScenarioOpen(true)}
                >
                  New scenario
                </button>
                <button
                  className="secondary-button manual-repair-button"
                  onClick={() => setManualRepairOpen(true)}
                >
                  Manual repair
                </button>
                {mapMode === "scenario" &&
                  activeScenario &&
                  proposalOptions.length === 0 && (
                    <button
                      className="secondary-button agent-repair-button"
                      onClick={() => setAgentRepairOpen(true)}
                    >
                      <SiteToolsIcon />
                      Ask agent
                    </button>
                  )}
                {mapMode === "scenario" && scenarioResolved && (
                  <span className="scenario-resolved-badge">
                    <VerifyIcon />
                    Resolved
                  </span>
                )}
                {proposal && mapMode !== "proposal" && (
                  <button
                    className="secondary-button review-repair-button"
                    onClick={() => {
                      setRepairView("after");
                      setMapMode("proposal");
                      setRepairPlanOpen(false);
                    }}
                  >
                    <RepairIcon />
                    {proposalReviewLabel}
                  </button>
                )}
              </div>
            </header>
            {mapMode === "proposal" && proposal && (
              <section
                className="repair-preview-bar"
                aria-label={
                  isRepairProposal ? "Repair preview" : "Proposal preview"
                }
                aria-busy={pendingAction !== null}
              >
                {proposalOptions.length > 1 && (
                  <div
                    className="repair-option-picker"
                    role="tablist"
                    aria-label="Repair options"
                  >
                    {proposalOptions.map((option) => (
                      <button
                        key={option.id}
                        role="tab"
                        aria-selected={option.id === proposal.id}
                        disabled={pendingAction !== null}
                        className={option.id === proposal.id ? "active" : ""}
                        onClick={() => {
                          setActiveProposalId(option.id);
                          setRepairView("after");
                          setRepairPlanOpen(false);
                        }}
                      >
                        <span>Option {option.optionLabel}</span>
                        <strong>{option.strategy ?? option.title}</strong>
                        <small>
                          {option.tradeoff?.effort.toLowerCase()} effort ·{" "}
                          {option.tradeoff?.timeToRestoreHours}h
                        </small>
                      </button>
                    ))}
                  </div>
                )}
                <div className="repair-preview-summary">
                  <span className="eyebrow">{proposalEyebrow}</span>
                  <strong>{proposal.title}</strong>
                  <small>
                    {proposalChangeSummary(proposal)} · baseline unchanged
                  </small>
                  <button
                    className="repair-plan-toggle"
                    onClick={() => {
                      setSelectedId(undefined);
                      setRepairPlanOpen((current) => !current);
                    }}
                  >
                    <ListIcon />
                    {repairPlanOpen
                      ? "Hide exact changes"
                      : `View ${proposal.changes.length} exact changes`}
                  </button>
                </div>
                <div
                  className="repair-view-toggle"
                  role="group"
                  aria-label={
                    isRepairProposal ? "Compare repair" : "Compare proposal"
                  }
                >
                  <button
                    className={repairView === "before" ? "active" : ""}
                    aria-pressed={repairView === "before"}
                    onClick={() => setRepairView("before")}
                  >
                    <span>
                      {isRepairProposal ? "Current failure" : "Baseline"}
                    </span>
                    <strong>
                      {isRepairProposal
                        ? `${repairComparison?.before.blockedWorkflowIds.length ?? simulation?.blockedWorkflowIds.length ?? 0} blocked`
                        : `${workspace.entities.length} items`}
                    </strong>
                  </button>
                  <button
                    className={repairView === "after" ? "active" : ""}
                    aria-pressed={repairView === "after"}
                    onClick={() => setRepairView("after")}
                  >
                    <span>
                      {isRepairProposal ? "Proposed outcome" : "Draft preview"}
                    </span>
                    <strong>
                      {isRepairProposal
                        ? repairComparison
                          ? `${repairComparison.after.blockedWorkflowIds.length} blocked`
                          : repairComparisonError
                            ? "Impact unavailable"
                            : "Calculating…"
                        : proposalKind === "MAP_DRAFT"
                          ? `${proposal.changes.filter((change) => change.op === "add-entity").length} new items`
                          : `${proposal.changes.length} graph change${proposal.changes.length === 1 ? "" : "s"}`}
                    </strong>
                  </button>
                </div>
                <div className="repair-preview-actions">
                  {(proposalKind === "REPAIR" ||
                    proposalKind === "MAP_DRAFT") && (
                    <button
                      className="secondary-button"
                      disabled={pendingAction !== null}
                      onClick={() => setProposalEditorOpen(true)}
                    >
                      Adjust option
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    disabled={pendingAction !== null}
                    onClick={() => void decide("reject")}
                  >
                    {pendingAction === "discard-proposal"
                      ? "Discarding…"
                      : "Discard"}
                  </button>
                  <button
                    className="primary-button"
                    disabled={pendingAction !== null || !repairCanBeApplied}
                    title={
                      proposal.kind === "REPAIR" && !repairCanBeApplied
                        ? repairComparisonError ||
                          "Waiting for the zero-blocked impact check"
                        : undefined
                    }
                    onClick={() => void decide("accept")}
                  >
                    {pendingAction === "apply-proposal"
                      ? "Applying…"
                      : proposalKind === "MAP_DRAFT"
                        ? "Apply company map"
                        : isRepairProposal
                          ? "Apply repair"
                          : "Apply change"}
                  </button>
                </div>
              </section>
            )}
            <div className="map-workspace">
              <GraphCanvas
                workspace={workspace}
                simulation={visibleSimulation}
                layoutSimulation={
                  mapMode === "proposal"
                    ? !isRepairProposal
                      ? null
                      : (repairComparison?.before ?? simulation)
                    : simulation
                }
                proposal={proposal}
                {...(mapMode === "proposal"
                  ? { proposalPhase: repairView }
                  : {})}
                restoredIds={mapMode === "proposal" ? restoredIds : []}
                scenarioResolved={
                  mapMode === "scenario" ? scenarioResolved : false
                }
                comparisonPending={
                  mapMode === "proposal" &&
                  proposal?.kind === "REPAIR" &&
                  repairView === "after" &&
                  !repairComparison &&
                  !repairComparisonError
                }
                focusedIds={focusedIds}
                selectedId={selectedId}
                onSelect={(id) => {
                  setRepairPlanOpen(false);
                  setSelectedId(id);
                }}
              />
              {mapMode === "proposal" && proposal && repairPlanOpen && (
                <RepairPlanPanel
                  workspace={workspace}
                  proposal={proposal}
                  onAdjust={() => setProposalEditorOpen(true)}
                  onClose={() => setRepairPlanOpen(false)}
                />
              )}
              {workspace.entities.length === 0 && !proposal && (
                <section
                  className="empty-map-guide"
                  aria-label="Start the company map"
                >
                  <span className="eyebrow">
                    Empty baseline · choose a path
                  </span>
                  <h2>Build the first continuity map</h2>
                  <p>
                    Add facts yourself, or ask the Site Tools agent to stage one
                    connected company blueprint. Agent work remains a visible
                    draft until you review and apply it.
                  </p>
                  <div className="empty-map-paths">
                    <article>
                      <small>Manual</small>
                      <strong>Start with one item</strong>
                      <p>
                        Add a person, workflow, system, location, or recovery
                        path.
                      </p>
                      <button
                        className="secondary-button"
                        onClick={() => setManualRepairOpen(true)}
                      >
                        Add first item
                      </button>
                    </article>
                    <article>
                      <small>With Site Tools</small>
                      <strong>Stage the connected company</strong>
                      <p className="agent-brief">
                        “Map {workspace.name}. Ask for missing critical work,
                        owners, systems, access, and recovery paths; then stage
                        one complete blueprint. Do not apply it.”
                      </p>
                      <span
                        className={`tool-availability ${webmcpReady ? "ready" : ""}`}
                      >
                        <i />
                        {webmcpReady
                          ? "Native Site Tools available"
                          : "Site Tools unavailable · use manual setup"}
                      </span>
                      <button
                        className="primary-button"
                        onClick={() => setAgentBlueprintOpen(true)}
                      >
                        <SiteToolsIcon />
                        Use agent setup
                      </button>
                    </article>
                  </div>
                </section>
              )}
              {selected && (
                <Inspector
                  workspace={previewWorkspace}
                  entity={selected}
                  simulation={visibleSimulation}
                  proposed={selectedIsProposed}
                  onEdit={() => setEditorOpen("edit")}
                  onConnect={() => {
                    setConnectionFromId(selected.id);
                    setConnectionOpen(true);
                  }}
                  onSchedule={() => setScheduleOpen(true)}
                  onClose={() => setSelectedId(undefined)}
                />
              )}
            </div>
          </div>
        )}
        {section === "scenarios" && (
          <ScenarioLibrary
            workspace={workspace}
            activeId={activeScenario?.id}
            onOpen={(scenario) => void runScenario(scenario)}
            onSaved={load}
            onAgent={() => setAgentScenarioOpen(true)}
          />
        )}
        {section === "people" && (
          <PeopleView
            workspace={workspace}
            onAdd={() => setEditorOpen("new")}
            onSelect={(id) => {
              setSelectedId(id);
              setSection("map");
            }}
            onDelegate={() => setDelegationOpen(true)}
          />
        )}
        {section === "activity" && <ActivityView workspace={workspace} />}
      </section>

      {searchOpen && (
        <SearchDialog
          workspace={workspace}
          onClose={() => setSearchOpen(false)}
          onPick={(id) => {
            setSelectedId(id);
            setSection("map");
            setMapMode("baseline");
          }}
        />
      )}
      {webmcpLogOpen && (
        <WebMcpLogDialog
          entries={visibleWebmcpCalls}
          ready={webmcpReady}
          onClose={() => setWebmcpLogOpen(false)}
        />
      )}
      {companyCreateOpen && (
        <CompanyCreateDialog
          onClose={() => setCompanyCreateOpen(false)}
          siteToolsReady={accountToolsReady}
          onOpenToolLog={() => setWebmcpLogOpen(true)}
          onCreated={async (createdWorkspace, setupMode) => {
            sessionStorage.setItem(
              setupPreferenceKey(createdWorkspace.slug),
              setupMode,
            );
            await onRefreshBootstrap();
            onOpen(createdWorkspace.slug);
          }}
        />
      )}
      {companySettingsOpen && !workspace.fictional && (
        <CompanySettingsDialog
          workspace={workspace}
          onClose={() => setCompanySettingsOpen(false)}
          onSaved={async (updatedWorkspace) => {
            setData((current) =>
              current ? { ...current, workspace: updatedWorkspace } : current,
            );
            await onRefreshBootstrap();
            if (updatedWorkspace.archived) onHome();
          }}
        />
      )}
      {agentBlueprintOpen && workspace.entities.length === 0 && (
        <AgentBlueprintDialog
          workspace={workspace}
          ready={webmcpReady}
          onOpenLog={() => {
            setAgentBlueprintOpen(false);
            setWebmcpLogOpen(true);
          }}
          onClose={() => setAgentBlueprintOpen(false)}
        />
      )}
      {agentScenarioOpen && workspace.entities.length > 0 && (
        <AgentScenarioDialog
          workspace={workspace}
          ready={webmcpReady}
          onOpenLog={() => {
            setAgentScenarioOpen(false);
            setWebmcpLogOpen(true);
          }}
          onClose={() => setAgentScenarioOpen(false)}
        />
      )}
      {agentRepairOpen && activeScenario && (
        <AgentRepairDialog
          workspace={workspace}
          scenario={activeScenario}
          ready={webmcpReady}
          onOpenLog={() => {
            setAgentRepairOpen(false);
            setWebmcpLogOpen(true);
          }}
          onClose={() => setAgentRepairOpen(false)}
        />
      )}
      {scenarioOpen && (
        <ScenarioEditor
          workspace={workspace}
          onClose={() => setScenarioOpen(false)}
          onSaved={async (scenario) => {
            const next = await api.workspace(workspace.slug);
            setData(next);
            const result = await api.simulate(
              workspace.slug,
              scenario,
              next.workspace.version,
            );
            setActiveScenarioId(scenario.id);
            setSimulation(result.simulation);
            setMapMode("scenario");
            setFocusedIds(result.simulation.smallestRelevantEntityIds);
            setSection("map");
          }}
        />
      )}
      {manualRepairOpen && (
        <ManualRepairDialog
          workspace={workspace}
          onClose={() => setManualRepairOpen(false)}
          onCopy={() => {
            setManualRepairOpen(false);
            void duplicate();
          }}
          onAdd={() => {
            setManualRepairOpen(false);
            setEditorOpen("new");
          }}
          onEdit={(id) => {
            setSelectedId(id);
            setManualRepairOpen(false);
            setEditorOpen("edit");
          }}
          onDelegate={() => {
            setManualRepairOpen(false);
            setDelegationOpen(true);
          }}
          onConnect={() => {
            setManualRepairOpen(false);
            setConnectionFromId(undefined);
            setConnectionOpen(true);
          }}
          onSchedule={(id) => {
            setSelectedId(id);
            setManualRepairOpen(false);
            setScheduleOpen(true);
          }}
        />
      )}
      {proposalEditorOpen && proposal && (
        <ProposalEditor
          workspace={workspace}
          proposal={proposal}
          onClose={() => setProposalEditorOpen(false)}
          onSaved={(nextWorkspace, nextProposal) => {
            setData((current) =>
              current ? { ...current, workspace: nextWorkspace } : current,
            );
            setActiveProposalId(nextProposal.id);
            setRepairComparison(null);
            setRepairComparisonError("");
          }}
        />
      )}
      {editorOpen && (
        <EntityEditor
          workspace={workspace}
          entity={editorOpen === "edit" ? selected : undefined}
          onClose={() => setEditorOpen(null)}
          onSaved={load}
        />
      )}
      {delegationOpen && (
        <DelegationDialog
          workspace={workspace}
          onClose={() => setDelegationOpen(false)}
          onSaved={load}
        />
      )}
      {connectionOpen && (
        <ConnectionDialog
          workspace={workspace}
          initialFromId={connectionFromId}
          onClose={() => {
            setConnectionOpen(false);
            setConnectionFromId(undefined);
          }}
          onSaved={load}
        />
      )}
      {scheduleOpen && selected && (
        <ScheduleDialog
          workspace={workspace}
          entity={selected}
          onClose={() => setScheduleOpen(false)}
          onSaved={load}
        />
      )}
      {companyPendingDeletion && (
        <Modal
          title={`Delete ${companyPendingDeletion.name}?`}
          description="This permanently removes the company map, scenarios, proposals, and activity. This action cannot be undone."
          onClose={() => {
            if (!deletingCompany) setDeleteConfirmSlug(undefined);
          }}
        >
          <div className="delete-confirmation">
            <div className="delete-confirmation-warning">
              <TrashIcon />
              <span>
                <strong>{companyPendingDeletion.name}</strong>
                <small>Personal company and all stored workspace data</small>
              </span>
            </div>
            <div className="delete-confirmation-actions">
              <button
                className="secondary-button"
                disabled={deletingCompany}
                onClick={() => setDeleteConfirmSlug(undefined)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                disabled={deletingCompany}
                onClick={() => void deleteCompany()}
              >
                <TrashIcon />
                {deletingCompany ? "Deleting…" : "Delete company"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Dismiss">
            <CloseIcon />
          </button>
        </div>
      )}
    </main>
  );
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [bootstrapError, setBootstrapError] = useState("");
  const [accountToolsReady, setAccountToolsReady] = useState(false);
  const [accountToolCalls, setAccountToolCalls] = useState<WebMcpCallLog[]>([]);
  const [
    workspaceToolsRegistrationRevision,
    setWorkspaceToolsRegistrationRevision,
  ] = useState(0);
  const workspaceToolsReadyRef = useRef(new Set<string>());
  const workspaceToolsWaitersRef = useRef(
    new Map<string, Set<(ready: boolean) => void>>(),
  );
  const [slug, setSlug] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("workspace"),
  );
  const refresh = useCallback(async () => {
    setBootstrapError("");
    try {
      setBootstrap(await api.bootstrap());
    } catch (reason) {
      setBootstrapError(
        reason instanceof Error
          ? reason.message
          : "Companies could not be loaded.",
      );
      throw reason;
    }
  }, []);
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);
  useEffect(() => {
    const onPop = () =>
      setSlug(new URLSearchParams(window.location.search).get("workspace"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const open = useCallback((next: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("workspace", next);
    window.history.pushState({}, "", url);
    setSlug(next);
  }, []);
  const home = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("workspace");
    window.history.pushState({}, "", url);
    setSlug(null);
  }, []);
  const reportWorkspaceToolsStatus = useCallback(
    (workspaceSlug: string, ready: boolean, settleWaiters = true) => {
      if (ready) workspaceToolsReadyRef.current.add(workspaceSlug);
      else workspaceToolsReadyRef.current.delete(workspaceSlug);
      if (!settleWaiters) return;
      const waiters = workspaceToolsWaitersRef.current.get(workspaceSlug);
      if (!waiters) return;
      workspaceToolsWaitersRef.current.delete(workspaceSlug);
      waiters.forEach((resolve) => resolve(ready));
    },
    [],
  );
  const waitForWorkspaceTools = useCallback((workspaceSlug: string) => {
    if (workspaceToolsReadyRef.current.has(workspaceSlug))
      return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let timeoutId = 0;
      const finish = (ready: boolean) => {
        window.clearTimeout(timeoutId);
        const waiters = workspaceToolsWaitersRef.current.get(workspaceSlug);
        waiters?.delete(finish);
        if (waiters?.size === 0)
          workspaceToolsWaitersRef.current.delete(workspaceSlug);
        resolve(ready);
      };
      const waiters =
        workspaceToolsWaitersRef.current.get(workspaceSlug) ?? new Set();
      waiters.add(finish);
      workspaceToolsWaitersRef.current.set(workspaceSlug, waiters);
      timeoutId = window.setTimeout(() => finish(false), 10_000);
    });
  }, []);
  useEffect(() => {
    const registration = registerSaveMyAccountTools({
      onCompanyCreated: async (workspace, setupMode) => {
        sessionStorage.setItem(setupPreferenceKey(workspace.slug), setupMode);
        try {
          await refresh();
        } catch {
          return { workspaceToolsReady: false };
        }
        if (workspaceToolsReadyRef.current.has(workspace.slug)) {
          open(workspace.slug);
          return { workspaceToolsReady: true };
        }
        const toolsReady = waitForWorkspaceTools(workspace.slug);
        setWorkspaceToolsRegistrationRevision((current) => current + 1);
        open(workspace.slug);
        return { workspaceToolsReady: await toolsReady };
      },
      onToolCall: (entry) => {
        setAccountToolCalls((current) => {
          const existing = current.findIndex((item) => item.id === entry.id);
          const next =
            existing === -1
              ? [...current, entry]
              : current.map((item, index) =>
                  index === existing ? entry : item,
                );
          return next.slice(-20);
        });
      },
    });
    registration.ready
      .then(() => setAccountToolsReady(registration.supported))
      .catch(() => setAccountToolsReady(false));
    return registration.cleanup;
  }, [open, refresh, waitForWorkspaceTools]);
  if (!bootstrap) {
    if (bootstrapError)
      return (
        <main className="loading-screen loading-error">
          <Brand />
          <span className="eyebrow">Companies unavailable</span>
          <h1>We couldn’t load your companies.</h1>
          <p role="alert">{bootstrapError}</p>
          <button
            className="primary-button"
            onClick={() => void refresh().catch(() => undefined)}
          >
            Try again
          </button>
        </main>
      );
    return <WorkspaceLoading label="Loading companies" />;
  }
  if (!slug)
    return (
      <Landing
        bootstrap={bootstrap}
        accountToolsReady={accountToolsReady}
        accountToolCalls={accountToolCalls}
        onOpen={open}
        onRefresh={refresh}
      />
    );
  return (
    <WorkspaceApp
      bootstrap={bootstrap}
      accountToolsReady={accountToolsReady}
      accountToolCalls={accountToolCalls}
      workspaceToolsRegistrationRevision={workspaceToolsRegistrationRevision}
      initialSlug={slug}
      onHome={home}
      onOpen={open}
      onRefreshBootstrap={refresh}
      onWorkspaceToolsStatus={reportWorkspaceToolsStatus}
    />
  );
}
