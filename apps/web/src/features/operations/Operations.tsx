import type { OperationRecord } from '../../../../../packages/contracts/src/index.js';

export function Operations({ operations }: { operations: OperationRecord[] }): React.JSX.Element {
  return (
    <section aria-labelledby="operations-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Audit trail</p>
          <h2 id="operations-title">Recent operations</h2>
        </div>
      </div>
      {operations.length === 0 ? <p className="empty-state">No v2 operations have been recorded.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Operation</th><th>Resources</th><th>Status</th><th>Started</th></tr></thead>
            <tbody>{operations.map((operation) => (
              <tr key={operation.id}>
                <td>{operation.label}</td>
                <td>{operation.resources.join(', ') || 'read-only'}</td>
                <td><span className={`status status-${operation.status}`}>{operation.status}</span></td>
                <td>{new Date(operation.startedAt).toLocaleString()}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
