# ANGE'S MNY
*Your money. Your control. Your future.*

Application personnelle de gestion, de suivi, d'analyse et de projection financière, pour moi et pour le couple.
Données persistantes (SQLite locale), calculs en centimes, graphiques interactifs, connexion Revolut via l'Open Banking.

## Démarrage

```bash
npm install
npm run dev        # API sur 127.0.0.1:4310 + interface sur http://localhost:5173
npm test           # tests du moteur de calcul et de l'API
npm run build && npm start   # version de production servie sur http://127.0.0.1:4310
```

Au premier lancement, tu peux ajouter tes comptes, importer un relevé ou charger des **données de démo** (supprimables en un clic).

## Fonctionnalités

| Module | Contenu |
|---|---|
| **Tableau de bord** | Patrimoine, solde disponible, revenus et dépenses du mois, charges restantes, budget variable restant, épargne, indicateur « dans le budget », comparaison avec le mois précédent, plus grosses dépenses, prochaines charges, estimation de fin de mois |
| **Reste à vivre** | Solde − charges fixes restantes − épargne programmée − engagements = **dépensable jusqu'à la paie** ; − enveloppes variables = **reste à vivre**. Budget par jour et par semaine, solde prévisionnel, alerte de rythme, simulateur « puis-je me le permettre ? » |
| **Préparer mon mois** | A. Charges fixes (fréquence, date, compte, catégorie, statut payé/à venir, report automatique, rapprochement automatique des prélèvements) · B. Enveloppes variables personnalisables avec barres de progression · C. Épargne : plan mensuel et objectifs (individuels ou communs, date estimée d'atteinte) |
| **Opérations** | Recherche et filtres, recatégorisation avec apprentissage, marquage des transferts internes, saisie manuelle, import CSV (Revolut, banques FR) et OFX |
| **Suivi & bilans** | Vue hebdomadaire (semaines trop dépensières), bilan mensuel automatique, tendances sur 3, 6 et 12 mois |
| **Conseiller** | Analyses automatiques et questions-réponses en français, fondées uniquement sur tes données ; les projections sont toujours signalées comme des estimations |
| **Projections** | Scénarios prudent, équilibré et optimiste à 3 mois, 6 mois, 1 an, 3 ans et 5 ans ; hypothèses modifiables ; dépenses exceptionnelles ; financement des objectifs |
| **Comptes & synchro** | Connexion Open Banking (lecture seule), synchronisation automatique et manuelle, historique, notification des échecs, consentement de Kelly |

Les **transferts internes** (coffres, comptes du couple, change de devises) sont détectés automatiquement : par libellé, ou par paire d'opérations opposées entre comptes suivis. Ils ne comptent ni comme dépenses ni comme revenus.

Le sélecteur **Moi / Couple** recalcule tous les écrans sur tes comptes perso et communs, ou sur l'ensemble des comptes autorisés.

## Connexion Revolut
Voir **[docs/REVOLUT.md](docs/REVOLUT.md)** : l'étude des options réelles et le guide de mise en place d'Enable Banking (agrégateur DSP2 agréé).
Aucun identifiant Revolut n'est jamais demandé.

## Architecture

```
src/shared/      moteur pur, testé (types, analytics, advisor, projections, import CSV/OFX, catégorisation)
src/server/      API Express + SQLite (better-sqlite3), pipeline d'import, synchro, connecteur Enable Banking
src/client/      React + Recharts (pages, composants)
tests/           Vitest : moteur + API (supertest, banque simulée)
docs/            Revolut / Open Banking
```

- Tous les montants sont des **entiers en centimes**.
- `BankProvider` est une interface : on peut ajouter un autre agrégateur sans toucher au reste.
- Sécurité : API liée à `127.0.0.1`, secrets bancaires chiffrés en AES-256-GCM (clé dans `data/secret.key` ou `MNY_SECRET_KEY`), en-têtes de sécurité, aucune route d'écriture vers la banque.
- Sauvegarde : export JSON complet et export CSV des opérations dans les Paramètres.
