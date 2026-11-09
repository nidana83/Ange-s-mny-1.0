# ANGE'S MNY
*Your money. Your control. Your future.*

Application de gestion, de suivi, d'analyse et de projection financière, pour Ange, pour Kelly et pour leurs finances communes.
Chaque personne a son propre accès. Les données sont persistantes (SQLite) et les calculs se font en centimes.
L'accès bancaire passe par l'Open Banking, en **lecture seule**.

## Démarrage

```bash
npm install
npm run dev        # API sur 127.0.0.1:4310 + interface sur http://localhost:5173
npm test           # 34 tests : moteur de calcul, sécurité, séparation des données, API
npm run build && npm start   # version de production servie sur http://127.0.0.1:4310
```

1. Au premier lancement, **crée ton accès** (identifiant + mot de passe).
2. Dans **Paramètres → Profil**, génère un **code d'invitation** pour Kelly. Elle crée son propre accès avec ce code.
3. Ajoute tes comptes (**Paramètres → Comptes**) : connexion Revolut, import CSV/OFX ou saisie manuelle.
4. Renseigne ton revenu et ton jour de paie (**Paramètres → Revenus & préférences**).

Pour découvrir l'application sans tes données : menu utilisateur → **Explorer le mode démo**.
Les données fictives vivent dans une base séparée, en mémoire, et ne se mélangent jamais aux données réelles.

## Les 8 pages

| Page | Contenu |
|---|---|
| **Accueil** | Les réponses du matin : ce que je possède, dépensé ce mois-ci, reste à payer, ce que je peux dépenser (par jour et par semaine), respect du budget, progression de l'épargne, estimation à 6 mois, points à surveiller |
| **Transactions** | Liste chronologique ; recherche par commerçant ou par montant ; filtres date, compte, catégorie, personne, type et statut ; catégorisation avec apprentissage ; opération manuelle ; exclusion ou annulation ; commentaires ; justificatifs (PDF/photo) ; historique des corrections ; paiements récurrents ; import CSV/OFX |
| **Budget** | Reste à vivre détaillé, revenus, charges fixes (reportées et rapprochées automatiquement), enveloppes variables, paiements récurrents détectés |
| **Épargne** | Épargne individuelle et commune, évolution, plan mensuel, objectifs avec date estimée d'atteinte |
| **Projections** | Scénarios prudent, équilibré et optimiste à 3 mois, 6 mois, 1, 3 et 5 ans ; hypothèses modifiables ; dépenses exceptionnelles |
| **Couple** | Mes finances, celles de Kelly (si elle les partage) et le commun ; répartition 50/50, au prorata des revenus, manuelle ou par catégorie ; contributions ; remboursements ; qui doit combien |
| **Analyses** | Bilans hebdomadaire, mensuel et annuel (export PDF), tendances 3/6/12 mois, comptabilité (journal, registre, historique des soldes, archives, journal des corrections), conseiller |
| **Paramètres** | Profil et sécurité, partage, invitation, comptes et synchronisation, revenus et paie, devises, thème, catégories, règles, notifications, exports, sauvegardes, effacement RGPD |

Règle d'or : un virement entre deux comptes d'une même personne, ou entre les comptes du couple, **n'est jamais compté comme une dépense ni comme un revenu**.
Il peut en revanche être une *contribution* au compte commun ou un *remboursement* entre vous.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) : choix techniques justifiés, modèle de données, modules
- [docs/SECURITE.md](docs/SECURITE.md) : authentification, séparation des données, chiffrement, RGPD
- [docs/REVOLUT.md](docs/REVOLUT.md) : connexion Revolut (étude et mise en place)
- [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) : utiliser l'application sur téléphone (HTTPS), sauvegardes
- [docs/ROADMAP.md](docs/ROADMAP.md) : état d'avancement des phases 1 à 6
