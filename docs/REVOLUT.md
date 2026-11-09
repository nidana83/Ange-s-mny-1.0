# Connexion Revolut — étude et mise en place

## 1. Ce qui est réellement possible (novembre 2026)

| Option | Comptes personnels ? | Verdict |
|---|---|---|
| **Revolut Business API** | ❌ Réservée aux comptes Business | Inutilisable pour un compte perso |
| **API Open Banking de Revolut (DSP2)** | ✅ mais réservée aux prestataires agréés (AISP) | Accès direct impossible pour un particulier |
| **Agrégateur Open Banking agréé** (Enable Banking, Tink, TrueLayer, Powens, Salt Edge…) | ✅ | ✅ **Solution retenue** |
| GoCardless Bank Account Data (ex-Nordigen) | — | Plus d'inscriptions depuis mi-2025 |
| Scraping / saisie des identifiants Revolut | — | ❌ **Exclu** : contourne la sécurité bancaire, interdit |
| **Import CSV / OFX** | ✅ | ✅ Toujours disponible (solution de repli) |

**Choix : Enable Banking.** C'est un prestataire agréé, couvert par la DSP2, et Revolut fait partie des banques prises en charge dans l'EEE.
Son mode **« restricted production »** permet de relier ses **propres** comptes pour un usage individuel non commercial ([documentation](https://enablebanking.com/docs/api/linked-accounts/)).
Vérifie les conditions tarifaires actuelles lors de l'inscription.

Garanties :
- Tu t'authentifies **chez Revolut** (biométrie / app). Ange's MNY ne voit jamais tes identifiants.
- L'accès est en **lecture seule** (AIS : soldes et opérations). Aucune initiation de paiement n'est codée.
- Le consentement dure **180 jours au maximum**, puis l'app te demande de le renouveler. Tu peux le révoquer à tout moment depuis la page Comptes ou depuis l'app Revolut.
- Sans action de ta part, la DSP2 limite l'accès aux données à **4 fois par jour**. C'est pourquoi la synchro automatique tourne toutes les 6 h ; tu peux aussi la lancer manuellement.
- L'identifiant de session est **chiffré** (AES-256-GCM) dans la base locale.

## 2. Mise en place (≈ 10 minutes)

1. Crée un compte sur <https://enablebanking.com/cp/applications> et ajoute une application :
   - environnement **Production** ;
   - URL de redirection : `http://localhost:5173/api/bank/callback` (en dev) ou l'URL publique de ton instance ;
   - l'assistant génère une **clé privée** : télécharge le fichier `.pem`.
2. Place la clé dans `data/enablebanking.pem` (ce fichier est ignoré par git).
3. Copie `.env.example` vers `.env`, puis renseigne :
   ```
   ENABLE_BANKING_APP_ID=<identifiant de l'application>
   ENABLE_BANKING_KEY_PATH=./data/enablebanking.pem
   ENABLE_BANKING_REDIRECT_URL=http://localhost:5173/api/bank/callback
   ```
4. Dans le portail, clique sur **« Activate by linking accounts »** et relie ton compte Revolut. L'application passe alors en mode restreint actif.
5. Relance `npm run dev`. Dans Ange's MNY, ouvre **Paramètres → Comptes & synchro → Connecter Revolut**, choisis « Mes comptes » ou « Compte commun » et le pays, puis valide chez Revolut.
   Les comptes (devises, espaces) sont créés automatiquement et synchronisés sur 12 mois d'historique.

> ⚠️ Mets les coffres/« espaces » Revolut dans le type *Coffre* et décoche « compter dans le reste à vivre » si l'agrégateur les expose comme comptes. Selon les pays, certains coffres ne sont pas exposés par l'API Open Banking : importe-les alors via CSV.

## 3. Comptes de Kelly

- Kelly a **son propre accès** à Ange's MNY. Ange l'invite depuis Paramètres → Profil.
- Elle connecte **elle-même** son Revolut, depuis son accès, en s'authentifiant chez Revolut. Personne ne peut connecter la banque de l'autre.
- Ses comptes restent **privés** : Ange ne les voit que si Kelly active « Partager mes comptes » (consentement horodaté, révocable à tout moment, effet immédiat). Même partagés, ils restent en lecture seule pour Ange.

## 4. Repli : import de relevés

Dans l'app Revolut : **Compte → ⋯ → Relevé → Excel/CSV**, choisis la période et exporte.
Dans Ange's MNY : **Opérations → Importer**. Le fichier Revolut mélange parfois compte courant et épargne (colonne *Product*) : importe chaque sous-compte vers le bon compte.
Les doublons sont ignorés automatiquement. Tu peux donc réimporter des périodes qui se chevauchent sans risque.
