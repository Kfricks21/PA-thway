// PA-thway — Student Hub configuration.
//
// The Hub talks to the Flask server in this repo (server/hub.py). Same origin
// when the app is served by that server, so the default needs no editing.
//
// Set API_BASE only if the app is hosted somewhere other than the server —
// e.g. developing the client on localhost:5173 against a deployed API:
//   API_BASE: 'https://pa-thway.onrender.com'
//
// Leave it as '' in production. If the server is unreachable the Hub falls back
// to on-device mode: everything works, but a cohort is shared only between
// windows on the same device.

window.PATHWAY_CONFIG = {
  API_BASE: '',

  // How often the Hub re-checks for new posts, in ms, while it is open.
  POLL_MS: 5000,
};
