import { render } from 'preact';

import { App } from './app.tsx';
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('missing #app');
}

render(<App />, app);
