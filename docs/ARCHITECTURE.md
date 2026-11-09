# Architecture

## Vue d'ensemble

```
Navigateur (React + TypeScript, PWA)          Serveur Node.js (Express + TypeScript)           Données
┌───────────────────────────────┐  HTTPS   ┌───────────────────────────────────┐        ┌──────────────────────┐
│ 8 pages · thème clair/sombre  │ ───────► │ Authentification · sessions        │ ─────► │ SQLite (WAL)         │
│ calculs instantanés (shared/) │  cookie  │ Contrôle d'accès par personne      │        │ data/anges-mny.db    │
│ graphiques Recharts           │  HttpOnly│ Import CSV/OFX · synchro bancaire  │        │ sauvegardes/jour     │
└───────────────────────────────┘          │ Journal d'audit · sauvegardes      │        └──────────────────────┘
                                           └──────────────┬────────────────────┘
                                                          │ JWT RS256 (lecture seule)
                                                          ▼
                                             Enable Banking (agrégateur DSP2) → Revolut
```

Le moteur de calcul (`src/shared/`) est **pur et partagé** : les mêmes fonctions servent au serveur et à l'interface.
Les calculs sont donc instantanés à l'écran, testés une seule fois et cohérents partout.

## Choix techniques (et pourquoi)

| Sujet | Proposé dans le cahier des charges | Retenu | Justification |
|---|---|---|---|
| Frontend | React / Next.js + TS | **React + Vite + TypeScript** | Une application personnelle derrière une authentification n'a pas besoin du rendu serveur ni du SEO de Next.js. Vite donne une SPA légère, installable en PWA, servie par la même API. |
| Interface | Tailwind + composants | **CSS à jetons de design** (variables CSS) | Palette noir/anthracite/gris/blanc + or champagne, thèmes clair et sombre, impression PDF : tout passe par une vingtaine de variables. Aucune dépendance de build en plus. Tailwind reste possible plus tard. |
| Backend | API sécurisée | **Express 5 + TypeScript** | Simple, éprouvé et testable (supertest). Validation explicite de chaque entrée. |
| Base | PostgreSQL | **SQLite (better-sqlite3, mode WAL)** | Pour 2 utilisateurs auto-hébergés : zéro administration, transactions ACID, sauvegarde = copie d'un fichier (faite chaque jour). Tout l'accès aux données passe par `Repo` (`src/server/db.ts`) : migrer vers PostgreSQL ne touche qu'un fichier, le jour où l'application doit tourner sur plusieurs serveurs. |
| Auth | Système sécurisé | **Comptes locaux, scrypt, sessions en base** | Pas de dépendance à un fournisseur tiers ; voir SECURITE.md. |
| Graphiques | Bibliothèque moderne | **Recharts** | Composants React déclaratifs, responsives, thémables par variables CSS. |
| Banque | API officielle / Open Banking | **Enable Banking** (interface `BankProvider`) | Revolut n'a pas d'API publique pour les comptes personnels ; voir REVOLUT.md. L'interface permet d'ajouter un autre agrégateur. |

## Modules

```
src/shared/          Moteur pur (aucune E/S)
  types.ts           Modèle de données (montants en centimes)
  analytics.ts       Budgets, charges, reste à vivre, bilans mensuels/annuels, patrimoine
  couple.ts          Contributions, répartition, remboursements, qui doit combien
  alerts.ts          Alertes paramétrables
  recurring.ts       Détection des paiements récurrents
  advisor.ts         Conseiller (analyses + questions en français)
  projections.ts     Scénarios prudent / équilibré / optimiste
  categorize.ts      Catégorisation, doublons, transferts internes
  importers/         CSV Revolut, CSV bancaire FR, OFX
src/server/
  app.ts             Routes API, contrôle d'accès, CSRF, audit
  auth.ts            Mots de passe (scrypt), jetons, limitation des tentatives
  db.ts              Schéma, migrations, Repo, vue filtrée par utilisateur
  pipeline.ts        Import : empreinte → doublons → catégorie → transferts
  sync.ts            Synchronisation bancaire + planificateur
  providers/         Connecteurs bancaires (Enable Banking)
  demo.ts            Jeu de données fictif (base séparée en mémoire)
src/client/          Interface React (pages, composants, thème)
tests/               Vitest : domaine + API
```

## Modèle de données (principales tables)

- `users` (une ligne par personne : `ange` / `kelly`, consentement de partage horodaté), `sessions`, `invitations`, `audit_log`
- `accounts` (propriétaire : `ange` | `kelly` | `joint`), `transactions` (statuts : réalisée / en attente / annulée / exclue ; drapeau « dépense commune »), `attachments`
- `categories`, `category_rules`, `person_budgets` (budgets **par personne**, par défaut et par mois)
- `fixed_charges` (+ `charge_months` : statut par mois), `goals`, `balance_snapshots`, `archives`
- `bank_connections` (secret de session chiffré), `sync_runs`
- `settings` : préférences par personne (`p:<personne>:<clé>`) et réglages du couple (`couple`)

Les migrations sont automatiques au démarrage (ajout de colonnes sans perte de données).

## Gestion des erreurs

- Côté serveur : erreurs métier typées (400/403/404/409/429) avec un message en français ; les erreurs internes sont journalisées mais leur détail n'est jamais renvoyé au client.
- Synchronisation : chaque exécution est historisée ; un échec déclenche une alerte dans l'interface et une notification de l'appareil si elle est autorisée.
- Côté client : chaque appel API en échec affiche un message ; une session expirée renvoie vers l'écran de connexion.
