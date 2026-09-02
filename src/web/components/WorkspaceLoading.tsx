import { Brand } from "./Brand";

export function WorkspaceLoading({ label }: { label: string }) {
  return (
    <main className="loading-shell" aria-busy="true" aria-live="polite">
      <aside className="loading-sidebar" aria-hidden="true">
        <Brand />
        <i />
        <i />
        <i />
        <i />
      </aside>
      <section className="loading-workspace">
        <header>
          <span className="eyebrow">Local continuity workspace</span>
          <strong>{label}</strong>
        </header>
        <div className="loading-toolbar" aria-hidden="true">
          <i />
          <i />
        </div>
        <div className="loading-graph" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </section>
    </main>
  );
}
