const apps = [];

export function initializeApp(options = {}) {
  const existing = apps[0];
  if (existing) return existing;
  const app = { name: '[DEFAULT]', options };
  apps.push(app);
  return app;
}

export function getApps() {
  return apps.slice();
}

export function getApp() {
  if (!apps.length) throw new Error('Aplicativo ainda não inicializado.');
  return apps[0];
}
