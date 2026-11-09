import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { Card, ScopeToggle } from '../components/ui';
import { answerQuestion, generateInsights, type Answer } from '../../shared/advisor';

const ICON = { good: '✅', info: '💡', warn: '⚠️', danger: '🚨' } as const;

export function Advisor() {
  const { state, today, scope } = useStore();
  const insights = useMemo(() => generateInsights(state, today, scope), [state, today, scope]);
  const [msgs, setMsgs] = useState<{ from: 'user' | 'bot'; text: string; details?: string[] }[]>([
    { from: 'bot', text: `Bonjour ${state.settings.userName} ! Je suis ton conseiller Ange's MNY. Je réponds uniquement à partir de tes données réelles ; quand je fais une projection, je te le précise.` },
  ]);
  const [q, setQ] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [msgs]);

  const ask = (question: string) => {
    if (!question.trim()) return;
    const a: Answer = answerQuestion(question, state, today, scope);
    setMsgs((m) => [...m, { from: 'user', text: question }, { from: 'bot', text: a.text, details: a.details }]);
    setQ('');
  };
  const suggestions = [
    'Combien puis-je dépenser aujourd\'hui ?',
    'Est-ce que je peux me permettre un achat de 150 € ?',
    'Combien ai-je dépensé en restauration ce mois-ci ?',
    `Combien avons-nous économisé avec ${state.settings.partnerName} ?`,
    'Combien me restera-t-il à la fin du mois ?',
    'Est-ce que mon budget est équilibré ?',
    'Comment économiser 100 € supplémentaires par mois ?',
    'Où en sont mes objectifs ?',
  ];

  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Conseiller financier</h1><p className="muted">Analyse automatique de tes données et réponses à tes questions.</p></div>
        <ScopeToggle />
      </div>
      <div className="grid g2">
        <Card title="Pose ta question">
          <div className="chat">
            {msgs.map((m, i) => (
              <div key={i} className={`bubble ${m.from}`}>
                {m.text}
                {m.details && <ul>{m.details.map((d) => <li key={d}>{d}</li>)}</ul>}
              </div>
            ))}
            <div ref={end} />
          </div>
          <form className="row gap-s" style={{ marginTop: 14 }} onSubmit={(e) => { e.preventDefault(); ask(q); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex. : Est-ce que je peux me permettre un achat de 80 € ?" />
            <button className="btn btn-primary" type="submit">Envoyer</button>
          </form>
          <div className="chips" style={{ marginTop: 12 }}>
            {suggestions.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}
          </div>
        </Card>
        <Card title="Analyse de ta situation" subtitle={`${insights.length} observation(s) — mises à jour à chaque nouvelle opération`}>
          <div className="stack-s">
            {insights.map((i) => (
              <div key={i.id} className={`insight ${i.level}`}>
                <span className="insight-icon">{ICON[i.level]}</span>
                <div><strong>{i.title}</strong><p className="small muted">{i.detail}</p></div>
              </div>
            ))}
            {!insights.length && <p className="muted">Rien de particulier à signaler pour l'instant. 🌿</p>}
          </div>
          <p className="small muted" style={{ marginTop: 14 }}>
            ℹ️ Les conseils sont calculés localement à partir de tes opérations, budgets et objectifs. Ils ne constituent pas un conseil en investissement réglementé.
          </p>
        </Card>
      </div>
    </div>
  );
}
