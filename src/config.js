// Deployment settings of the web app. Only this file changes between the GitHub Pages site and a
// local checkout – the API lives on a Cloudflare Worker (worker/), see README §6.
export const config = {
  // Address of the Worker after the first deploy (Cloudflare → Workers & Pages → analyze-api → URL).
  // Empty string = no server: the app runs locally only (phase 1 behaviour).
  apiBase: 'https://analyze-api.balthasar.workers.dev',
  // Public address of the app – used for the short links analyze.wicki.aero/v/<id>.
  appUrl: 'https://analyze.wicki.aero',
};
