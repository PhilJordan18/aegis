import { useI18n } from '../../i18n/useI18n'

/**
 * Who talks to whom (handoff §4.5, claims S1–S4): one labelled SVG with three notes from 768 px, an
 * ordered list of three sentences below it. Product names and protocols are not translated.
 */
export function SystemDiagram() {
  const { m } = useI18n()
  const s = m.landing.system
  return (
    <div className="lp-sys">
      <svg className="lp-sys__diagram" viewBox="0 0 1120 400" role="img" aria-label={s.alt}>
        <g aria-hidden="true">
          <rect className="lp-sys__node" x="40" y="60" width="230" height="84" rx="12" />
          <text x="60" y="94">Aegis Mobile</text>
          <text className="lp-sys__t2" x="60" y="116">
            {s.mobileRole}
          </text>
          <rect className="lp-sys__node" x="40" y="256" width="230" height="84" rx="12" />
          <text x="60" y="290">Aegis Manager</text>
          <text className="lp-sys__t2" x="60" y="312">
            {s.managerRole}
          </text>
          <rect className="lp-sys__node lp-sys__node--authority" x="400" y="150" width="270" height="100" rx="12" />
          <text x="420" y="186">Aegis Control</text>
          <text className="lp-sys__t2" x="420" y="208">
            {s.controlRole}
          </text>
          <text className="lp-sys__t2" x="420" y="230">
            {s.controlDuty}
          </text>
          <rect className="lp-sys__node lp-sys__node--private" x="400" y="300" width="270" height="56" rx="12" />
          <text x="420" y="334">PostgreSQL</text>
          <text className="lp-sys__t2" x="652" y="334" textAnchor="end">
            {s.databaseRole}
          </text>
          <rect className="lp-sys__node" x="740" y="150" width="130" height="100" rx="12" />
          <text x="760" y="186">Broker</text>
          <text className="lp-sys__t2" x="760" y="208">
            MQTT · TLS
          </text>
          <rect className="lp-sys__node" x="930" y="40" width="160" height="84" rx="12" />
          <text x="950" y="74">Hub</text>
          <text className="lp-sys__t2" x="950" y="96">
            {s.hubRole}
          </text>
          <rect className="lp-sys__node" x="930" y="200" width="160" height="60" rx="12" />
          <text x="950" y="236">{s.compartmentA1}</text>
          <rect className="lp-sys__node" x="930" y="296" width="160" height="60" rx="12" />
          <text x="950" y="332">{s.compartmentA2}</text>
          <path className="lp-sys__edge" d="M270 102 H340 Q360 102 360 122 V180 Q360 200 380 200 H400" />
          <text className="lp-sys__mono" x="290" y="92">
            HTTPS
          </text>
          <path className="lp-sys__edge" d="M270 298 H340 Q360 298 360 278 V220 Q360 200 380 200 H400" />
          <text className="lp-sys__mono" x="290" y="326">
            HTTPS
          </text>
          <path className="lp-sys__edge" d="M535 250 V300" />
          <path className="lp-sys__edge" d="M670 200 H740" />
          <text className="lp-sys__mono" x="676" y="190">
            MQTT
          </text>
          <path className="lp-sys__edge" d="M870 200 H905 Q920 200 920 185 V97 Q920 82 930 82" />
          <text className="lp-sys__mono" x="878" y="150">
            TLS
          </text>
          {/* The A2 run goes around A1 so that no cable crosses a compartment or its label. */}
          <path className="lp-sys__edge lp-sys__edge--cable" d="M1076 124 V200" />
          <text className="lp-sys__mono" x="950" y="166">
            {s.cable}
          </text>
          <path className="lp-sys__edge lp-sys__edge--cable" d="M1090 100 H1104 V326 H1090" />
          <text className="lp-sys__mono" x="950" y="282">
            {s.cable}
          </text>
        </g>
      </svg>
      <div className="lp-sys__notes">
        {(['clients', 'hub', 'cable'] as const).map((id) => (
          <p key={id}>
            <b>{s.notes[id].lead}</b> {s.notes[id].text}
          </p>
        ))}
      </div>
      <ol className="lp-sys__list">
        {(['clients', 'control', 'hub'] as const).map((id) => (
          <li key={id}>
            <b>{s.list[id].lead}</b> {s.list[id].text}
          </li>
        ))}
      </ol>
    </div>
  )
}
