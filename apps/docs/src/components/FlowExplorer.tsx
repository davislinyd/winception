import { useEffect, useMemo, useRef, useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

interface Flow { id: string; title: string; steps: string[] }
interface FlowData { schemaVersion: number; animations: Record<string, Flow[]> }

export function FlowExplorer(): React.JSX.Element {
  const { i18n } = useDocusaurusContext();
  const locale = i18n.currentLocale;
  const zh = locale === 'zh-TW';
  const url = useBaseUrl('/data/flows.json');
  const [flows, setFlows] = useState<Flow[]>([]);
  const [flowId, setFlowId] = useState('installation');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => { void (async () => {
    const response = await fetch(url);
    const data = JSON.parse(await response.text()) as FlowData;
    setFlows(data.animations[locale] ?? []);
  })(); }, [locale, url]);
  const flow = useMemo(() => flows.find((item) => item.id === flowId) ?? flows[0], [flowId, flows]);
  useEffect(() => {
    if (!playing || !flow || reducedMotion) return undefined;
    timer.current = setInterval(() => setStep((current) => current >= flow.steps.length - 1 ? 0 : current + 1), 1800);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [flow, playing, reducedMotion]);
  useEffect(() => { setStep(0); setPlaying(false); }, [flowId, locale]);
  if (!flow) return <section className="interactive-card"><p>{zh ? '正在載入流程…' : 'Loading flows…'}</p></section>;
  return (
    <section className="interactive-card" aria-labelledby="flow-title">
      <h2 id="flow-title">{zh ? '可控制的流程動畫' : 'Controllable flow animation'}</h2>
      <p>{zh ? '來源是 canonical flow-source.json。可播放、暫停或逐步操作；減少動態效果模式不會自動播放。' : 'Generated from canonical flow-source.json. Play, pause or step manually; reduced-motion mode disables autoplay.'}</p>
      <div className="flow-tabs" role="tablist" aria-label={zh ? '流程' : 'Flows'}>{flows.map((item) => <button key={item.id} role="tab" aria-selected={item.id === flow.id} onClick={() => setFlowId(item.id)}>{item.title}</button>)}</div>
      <ol className="flow-steps" aria-live="polite">{flow.steps.map((label, index) => <li key={label} className={index === step ? 'is-active' : index < step ? 'is-complete' : ''} aria-current={index === step ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
      <div className="flow-controls">
        <button type="button" onClick={() => setStep((current) => Math.max(0, current - 1))}>{zh ? '上一步' : 'Previous'}</button>
        <button type="button" disabled={reducedMotion} aria-pressed={playing} onClick={() => setPlaying((value) => !value)}>{playing ? (zh ? '暫停' : 'Pause') : (zh ? '播放' : 'Play')}</button>
        <button type="button" onClick={() => setStep((current) => Math.min(flow.steps.length - 1, current + 1))}>{zh ? '下一步' : 'Next'}</button>
      </div>
      {reducedMotion && <p role="status">{zh ? '系統偏好減少動態效果：請使用上一步／下一步。' : 'Reduced motion is enabled; use Previous and Next.'}</p>}
    </section>
  );
}
