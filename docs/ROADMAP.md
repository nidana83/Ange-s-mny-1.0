# Feuille de route

✅ fait et testé · 🟡 fait, à valider en conditions réelles · ⏳ à faire

## Phase 1 — Fondations
- ✅ Architecture modulaire (moteur partagé, API, interface) — voir ARCHITECTURE.md
- ✅ Interface : 8 pages, thèmes clair et sombre, mobile, tablette et ordinateur, PWA installable
- ✅ Authentification, accès séparé pour Kelly (invitation), consentement de partage
- ✅ Base de données persistante avec migrations automatiques
- ✅ Tableau de bord, gestion des comptes, multi-devises (taux manuels)

## Phase 2 — Gestion budgétaire
- ✅ Revenus, charges fixes (report et rapprochement automatiques), enveloppes variables, préparation du mois
- ✅ Reste à vivre (budget par jour et par semaine, solde de fin de mois, alerte de rythme)
- ✅ Suivi hebdomadaire et mensuel

## Phase 3 — Transactions et Revolut
- ✅ Import CSV Revolut / CSV bancaire / OFX, dédoublonnage, catégorisation apprenante, règles personnalisées
- ✅ Détection des transferts internes, y compris quand les comptes sont importés séparément
- 🟡 Connexion Revolut via Enable Banking : code écrit et testé avec une banque simulée. **Il reste à créer le compte Enable Banking et à tester avec ton vrai Revolut** (voir REVOLUT.md).
- ✅ Synchronisation automatique et manuelle, historique, notification des échecs

## Phase 4 — Épargne et couple
- ✅ Objectifs d'épargne individuels et communs, date estimée d'atteinte
- ✅ Comptes de Kelly (son propre accès), budget commun, répartition 50/50, au prorata, manuelle ou par catégorie, remboursements
- ✅ Suivi du patrimoine (historique des soldes, évolution)

## Phase 5 — Intelligence financière
- ✅ Conseiller (analyses + questions en français, sans invention de données)
- ✅ Alertes paramétrables (8 types)
- ✅ Projections et simulations (3 scénarios, dépenses exceptionnelles)
- ⏳ Conseiller conversationnel avec un modèle de langage (optionnel, nécessiterait d'envoyer des données à un service externe : à décider ensemble)

## Phase 6 — Finalisation
- ✅ Tests automatiques (34) : calculs, sécurité, séparation des données, import, synchro simulée, démo isolée
- ✅ Sécurité : scrypt, sessions, CSRF, limitation des tentatives, chiffrement, journal d'audit
- ✅ Sauvegardes quotidiennes, exports CSV/JSON/PDF
- ✅ Documentation
- 🟡 Déploiement HTTPS pour le téléphone : documenté, non testé (voir DEPLOIEMENT.md)
- ⏳ Notifications push quand l'application est fermée (nécessite un service worker + serveur push)
