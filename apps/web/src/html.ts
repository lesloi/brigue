const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Names and titles come from the server; never let them become markup. */
export function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (character) => ENTITIES[character] ?? character);
}
