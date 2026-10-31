import { esc } from '../html.ts';
import { seal } from '../icons.ts';

export function lostHouseTemplate(): string {
  return `<div class="gate">
  <div class="gate-card">
    ${seal(38)}
    <h1>Cette ville a déjà son joueur</h1>
    <p>La maison Brigue est liée à un jeton. Collez-le pour reprendre la partie.</p>
    <form id="resume-form">
      <label for="token-input">Votre jeton</label>
      <input id="token-input" name="token" autocomplete="off" spellcheck="false" required />
      <button class="btn wide" type="submit">Reprendre</button>
    </form>
    <p class="gate-error" id="gate-error" hidden></p>
    <p class="gate-note">Le jeton est la seule clé de cette maison : sans lui, elle ne peut pas être retrouvée.</p>
  </div>
</div>`;
}

export function failureTemplate(title: string, message: string): string {
  return `<div class="gate">
  <div class="gate-card">
    ${seal(38)}
    <h1>${esc(title)}</h1>
    <p>${esc(message)}</p>
    <button class="btn wide" id="retry" type="button">Réessayer</button>
    <p class="gate-note">La ville vit sur le serveur. Le shell de l'application reste disponible hors ligne.</p>
  </div>
</div>`;
}

export function tokenDialogTemplate(token: string): string {
  return `<div class="overlay" id="token-overlay" role="dialog" aria-modal="true" aria-labelledby="token-title">
  <div class="dialog">
    ${seal(34)}
    <h2 id="token-title">Votre jeton</h2>
    <p>Il ne sera plus affiché. Notez-le : c'est la seule façon de retrouver cette maison depuis un autre appareil.</p>
    <code id="token-value">${esc(token)}</code>
    <div class="dialog-actions">
      <button class="btn" id="copy-token" type="button">Copier</button>
      <button class="btn outline" id="close-token" type="button">J'ai noté</button>
    </div>
  </div>
</div>`;
}
