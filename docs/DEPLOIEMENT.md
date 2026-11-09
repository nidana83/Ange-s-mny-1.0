# Déploiement et utilisation sur téléphone

## Sur ton ordinateur (le plus simple)

```bash
npm install
npm run build
cp .env.example .env    # puis adapte les valeurs
npm start               # http://127.0.0.1:4310
```

## Sur ton téléphone (Android / iOS)

Pour utiliser l'application depuis un téléphone, elle doit être servie en **HTTPS** depuis une machine allumée en permanence.
Par exemple : un mini-PC ou un Raspberry Pi chez toi, ou un petit serveur privé (VPS) en Europe.

Exemple avec le reverse proxy **Caddy**, qui gère automatiquement le certificat HTTPS :

```
# /etc/caddy/Caddyfile
mny.ton-domaine.fr {
  reverse_proxy 127.0.0.1:4310
}
```

Et dans `.env` :

```
COOKIE_SECURE=true
HOST=127.0.0.1
ENABLE_BANKING_REDIRECT_URL=https://mny.ton-domaine.fr/api/bank/callback
```

Sur le téléphone, ouvre l'adresse, puis :
- **iPhone** : Partager → « Sur l'écran d'accueil » ;
- **Android** : menu ⋮ → « Installer l'application ».

L'application s'ouvre alors en plein écran, comme une app native.

> ⚠️ Cette configuration HTTPS est documentée mais **n'a pas été testée** dans l'environnement de développement (pas de nom de domaine disponible).
> N'expose jamais le port 4310 directement sur Internet : passe toujours par le reverse proxy HTTPS.

## Sauvegardes

- Automatiques : chaque jour dans `BACKUP_DIR` (par défaut `data/backups`), les `BACKUP_KEEP` dernières (14) conservées.
- Restauration : arrête le serveur, remplace `data/anges-mny.db` par une sauvegarde, puis redémarre.
- Garde aussi une copie de `data/secret.key` : sans elle, les connexions bancaires devront être refaites (les données financières, elles, restent lisibles).
