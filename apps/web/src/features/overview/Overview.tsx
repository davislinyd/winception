import type { SystemState } from '../../../../../packages/contracts/src/index.js';

export function Overview({ state }: { state: SystemState }): React.JSX.Element {
  return (
    <section aria-labelledby="overview-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Deployment host</p>
          <h2 id="overview-title">System overview</h2>
        </div>
        <span className="timestamp">Updated {new Date(state.updatedAt).toLocaleTimeString()}</span>
      </div>
      <div className="metric-grid">
        <Metric label="Privileged Agent" value={state.services.agent} tone={state.services.agent === 'connected' ? 'good' : 'bad'} />
        <Metric label="Deployment ingress" value={state.services.deploymentIngress} tone={state.services.deploymentIngress === 'stopped' ? 'neutral' : 'warn'} />
        <Metric label="Active deployments" value={String(state.fleet.activeRuns)} tone={state.fleet.activeRuns === 0 ? 'good' : 'warn'} />
        <Metric label="Active operations" value={String(state.operations.filter((operation) => operation.status === 'running').length)} tone="neutral" />
      </div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }): React.JSX.Element {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong className={`tone-${tone}`}>{value}</strong>
    </article>
  );
}
