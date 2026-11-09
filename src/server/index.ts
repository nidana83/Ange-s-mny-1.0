import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, Repo } from './db';
import { SecretBox } from './crypto';
import { EnableBankingProvider } from './providers/enablebanking';
import { createApp } from './app';
import { startScheduler } from './sync';

// Chargement minimal du fichier .env (sans dépendance)
const envFile = path.resolve('.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = Number(process.env.PORT || 4310);
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || './data/anges-mny.db';

const repo = new Repo(openDb(DB_PATH));
const box = new SecretBox(process.env.MNY_SECRET_KEY, path.join(path.dirname(DB_PATH), 'secret.key'));
const provider = new EnableBankingProvider(
  process.env.ENABLE_BANKING_APP_ID,
  process.env.ENABLE_BANKING_KEY_PATH,
  process.env.ENABLE_BANKING_REDIRECT_URL || `http://localhost:5173/api/bank/callback`,
);

const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
const app = createApp({ repo, box, provider, cookieSecure: process.env.COOKIE_SECURE === 'true', backupDir });

// Sauvegarde automatique quotidienne de la base (14 dernières conservées) + purge des sessions expirées
const dailyMaintenance = async () => {
  try {
    repo.purgeSessions();
    const f = await repo.backup(backupDir, Number(process.env.BACKUP_KEEP || 14));
    console.log(`💾 Sauvegarde : ${f}`);
  } catch (e) {
    console.error('Échec de la sauvegarde automatique', e);
  }
};
void dailyMaintenance();
setInterval(dailyMaintenance, 24 * 3_600_000).unref();

// En production, l'API sert aussi l'interface compilée
const dist = path.resolve('dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, HOST, () => {
  console.log(`Ange's MNY API → http://${HOST}:${PORT}`);
  console.log(provider.isConfigured() ? '🔗 Connexion Open Banking configurée (Enable Banking).' : 'ℹ️  Connexion bancaire non configurée : import CSV/OFX disponible (voir docs/REVOLUT.md).');
});
startScheduler(repo, box, provider, Number(process.env.SYNC_INTERVAL_HOURS || 6));
