# Sécurité et confidentialité

## Authentification

- Comptes locaux : identifiant + mot de passe (10 caractères minimum, avec au moins une lettre et un chiffre).
- Mots de passe hachés avec **scrypt** (N = 2¹⁵, sel aléatoire de 16 octets), comparaison en temps constant.
- **Limitation des tentatives** : 8 essais par IP sur 15 minutes. Les échecs sont journalisés.
- Sessions : jeton aléatoire de 256 bits, stocké **haché** (SHA-256) en base. Cookie `HttpOnly`, `SameSite=Lax`, `Secure` derrière HTTPS (`COOKIE_SECURE=true`). Expiration glissante de 30 jours.
- Changer de mot de passe **déconnecte toutes les autres sessions**.
- **CSRF** : toute écriture exige l'en-tête `X-MNY`, qu'un site tiers ne peut pas poser sans CORS (et aucun CORS n'est autorisé).

## Séparation stricte des données

| Donnée | Ange | Kelly |
|---|---|---|
| Comptes, opérations, objectifs et charges d'Ange | lecture + écriture | **rien**, sauf si Ange active le partage (alors lecture seule) |
| Comptes, opérations, objectifs et charges de Kelly | **rien**, sauf si Kelly active le partage (alors lecture seule) | lecture + écriture |
| Comptes et objectifs communs | lecture + écriture | lecture + écriture |
| Budgets, préférences, alertes, archives | personnels | personnels |
| Répartition des dépenses communes | partagée | partagée |

- Le filtrage se fait **côté serveur** (`Repo.state` et contrôles de chaque route) : une donnée non autorisée n'est jamais envoyée au navigateur.
- Le partage est un **consentement explicite et horodaté**, que seule la personne concernée peut donner ou retirer depuis son propre accès. Le retrait prend effet immédiatement.
- Personne ne peut créer, modifier ou connecter la banque de l'autre. Kelly connecte elle-même son Revolut.
- Ces règles sont vérifiées par des tests automatiques (`tests/api.test.ts` → « Séparation des données du couple »).

## Données bancaires

- Aucun identifiant ni mot de passe bancaire n'est jamais demandé ni stocké. L'authentification se fait chez Revolut (DSP2/SCA).
- L'identifiant de session Open Banking est **chiffré au repos** (AES-256-GCM). La clé vient de `MNY_SECRET_KEY` ou de `data/secret.key` (droits 600).
- Clé privée de l'application Enable Banking : fichier hors dépôt, chemin fourni par variable d'environnement.
- **Lecture seule** : aucune route ni méthode d'initiation de paiement n'existe dans le code.

## Protection de l'API

- Validation de chaque entrée : types, formats de date et de mois, montants entiers en centimes, listes de valeurs autorisées, longueurs maximales.
- Justificatifs : seuls PDF, JPG, PNG, WEBP et HEIC sont acceptés, 5 Mo maximum. Ils sont servis avec `nosniff` et une CSP `sandbox`.
- En-têtes : `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cache-Control: no-store` sur l'API, HSTS derrière HTTPS.
- L'API n'écoute que sur `127.0.0.1` par défaut.

## Journalisation

`audit_log` enregistre :
- connexions et échecs, déconnexions ;
- changements de mot de passe, invitations, activation et retrait du partage ;
- ajouts et suppressions de comptes, connexions bancaires, synchronisations manuelles ;
- **modifications d'opérations (avant/après)**, justificatifs, règles ;
- exports, archivages, effacements.

Chaque personne consulte son propre journal dans **Analyses → Comptabilité → Corrections & sécurité**.

## Sauvegardes

- Sauvegarde automatique quotidienne de la base (`data/backups`, les 14 dernières conservées) ; sauvegarde manuelle depuis Paramètres → Données.
- Pense à copier régulièrement `data/backups` hors de la machine (disque externe, stockage chiffré).

## RGPD

- **Minimisation** : seules les données nécessaires au service sont stockées ; aucun traceur, aucune analyse tierce.
- **Hébergement** : sur ta propre machine ou ton serveur. Le seul tiers est l'agrégateur bancaire, et uniquement si tu actives la connexion.
- **Droit d'accès et de portabilité** : export JSON complet et CSV des opérations.
- **Droit à l'effacement** : « Supprimer mon accès et mes données » (Paramètres → Profil). Les comptes communs restent accessibles à l'autre personne.
- **Consentement** : le partage entre partenaires est opt-in et révocable.
