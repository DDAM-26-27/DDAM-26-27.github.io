/** Generates ADMIN_PASSWORD_HASH for AUTH_MODE=local. Usage: npm run hash-password -- 'your password' */
import { hashPassword } from '../server/crypto';

const pw = process.argv[2];
if (!pw || pw.length < 12) {
  console.error('Usage: npm run hash-password -- "<password of at least 12 characters>"');
  process.exit(1);
}
console.log(await hashPassword(pw));
