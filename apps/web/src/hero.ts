/**
 * Saint-Aubin, drawn once. Vector, so it stays sharp on a phone and costs a few
 * kilobytes. The scene is decoration: nothing in it is clickable.
 */
export function heroScene(): string {
  return `<svg viewBox="0 0 390 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#79b6da"/><stop offset=".45" stop-color="#b6d7e6"/><stop offset=".78" stop-color="#ecdfc0"/><stop offset="1" stop-color="#f8ebc6"/></linearGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fbfd4"/><stop offset="1" stop-color="#cbe1e8"/></linearGradient>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1e4c8"/><stop offset="1" stop-color="#cfba92"/></linearGradient>
  </defs>
  <rect width="390" height="200" fill="url(#sky)"/>
  <circle cx="70" cy="40" r="52" fill="#fff3cc" opacity=".3"/><circle cx="70" cy="40" r="15" fill="#fffaea"/>
  <g fill="#fff" opacity=".82"><ellipse cx="200" cy="30" rx="28" ry="6"/><ellipse cx="220" cy="24" rx="17" ry="5"/><ellipse cx="320" cy="36" rx="26" ry="5" opacity=".6"/></g>
  <path d="M0 108q48-22 100-12t108 2 100-14 82 14v102H0z" fill="#a9c4a4"/>
  <path d="M0 124q62-14 120-5t120 0 150-5v86H0z" fill="#93ae8c"/>
  <g>
    <rect x="10" y="104" width="42" height="32" fill="#f6ecd4"/><path d="M5 105L31 84l26 21z" fill="#b45b3c"/><rect x="22" y="112" width="6" height="9" fill="#6f5f45"/>
    <rect x="64" y="110" width="38" height="26" fill="#f1e5c9"/><path d="M60 111l23-18 23 18z" fill="#5f7285"/><rect x="76" y="116" width="5" height="8" fill="#6f5f45"/>
    <rect x="114" y="100" width="32" height="36" fill="#f8eed8"/><path d="M109 101l21-20 21 20z" fill="#c0663d"/>
    <rect x="156" y="92" width="13" height="44" fill="#f4e8ce"/><path d="M150 93l12-32 12 32z" fill="#8d9aa3"/><path d="M162 61v-9" stroke="#5a5245" stroke-width="2"/><path d="M162 52l10 4-10 5z" fill="#b93b30"/>
    <rect x="181" y="104" width="54" height="32" fill="#f6ecd4"/><path d="M176 105l32-21 32 21z" fill="#b45b3c"/><rect x="191" y="112" width="6" height="9" fill="#6f5f45"/><rect x="213" y="112" width="6" height="9" fill="#6f5f45"/>
    <rect x="249" y="100" width="36" height="36" fill="#f1e5c9"/><path d="M244 101l23-18 23 18z" fill="#5f7285"/>
    <rect x="298" y="90" width="27" height="46" fill="#f5e9d0"/><path d="M293 91l16-30 16 30z" fill="#6f7f8c"/><circle cx="311.5" cy="105" r="7.5" fill="#fffaea" stroke="#9a8a68" stroke-width="1.6"/>
    <rect x="339" y="102" width="46" height="34" fill="#f8eed8"/><path d="M334 103l28-20 28 20z" fill="#c0663d"/><rect x="355" y="110" width="6" height="9" fill="#6f5f45"/><rect x="371" y="110" width="6" height="9" fill="#6f5f45"/>
  </g>
  <rect x="0" y="136" width="390" height="16" fill="url(#wall)"/>
  <g fill="#f2e5c9"><rect x="0" y="131" width="11" height="6"/><rect x="22" y="131" width="11" height="6"/><rect x="44" y="131" width="11" height="6"/><rect x="66" y="131" width="11" height="6"/><rect x="88" y="131" width="11" height="6"/><rect x="110" y="131" width="11" height="6"/><rect x="132" y="131" width="11" height="6"/><rect x="154" y="131" width="11" height="6"/><rect x="176" y="131" width="11" height="6"/><rect x="198" y="131" width="11" height="6"/><rect x="220" y="131" width="11" height="6"/><rect x="242" y="131" width="11" height="6"/><rect x="264" y="131" width="11" height="6"/><rect x="286" y="131" width="11" height="6"/><rect x="308" y="131" width="11" height="6"/><rect x="330" y="131" width="11" height="6"/><rect x="352" y="131" width="11" height="6"/><rect x="374" y="131" width="11" height="6"/></g>
  <rect x="0" y="152" width="390" height="48" fill="url(#water)"/>
  <g stroke="#fff" stroke-width="1.1" opacity=".5" stroke-linecap="round"><path d="M28 162h26"/><path d="M74 172h18"/><path d="M300 166h22"/><path d="M348 174h20"/></g>
  <g><rect x="132" y="152" width="128" height="22" fill="#d6c4a3"/><rect x="128" y="148" width="136" height="5" fill="#c3ae89"/>
    <path d="M146 174v-11a12 12 0 0 1 24 0v11z" fill="#8fbfd4"/><path d="M198 174v-11a12 12 0 0 1 24 0v11z" fill="#8fbfd4"/>
    <g fill="#4a3a2c"><circle cx="170" cy="144" r="2"/><circle cx="204" cy="143" r="1.8"/></g></g>
  <rect x="0" y="194" width="390" height="6" fill="#c4ac80"/>
</svg>`;
}
