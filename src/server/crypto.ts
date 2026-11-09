import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Chiffrement AES-256-GCM des secrets stockés (identifiants de session Open Banking).
 * Aucun identifiant ou mot de passe bancaire n'est jamais stocké : l'authentification
 * se fait chez la banque (SCA), l'application ne conserve qu'un identifiant de session révocable.
 */
export class SecretBox {
  private key: Buffer;

  constructor(keyHex: string | undefined, keyFile: string) {
    if (keyHex) this.key = Buffer.from(keyHex, 'hex');
    else if (fs.existsSync(keyFile)) this.key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
    else {
      this.key = crypto.randomBytes(32);
      fs.mkdirSync(path.dirname(keyFile), { recursive: true });
      fs.writeFileSync(keyFile, this.key.toString('hex'), { mode: 0o600 });
    }
    if (this.key.length !== 32) throw new Error('MNY_SECRET_KEY doit faire 32 octets (64 caractères hexadécimaux).');
  }

  seal(plain: string): string {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), enc].map((x) => x.toString('base64')).join('.');
  }

  open(sealed: string): string {
    const [iv, tag, enc] = sealed.split('.').map((x) => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  }
}
