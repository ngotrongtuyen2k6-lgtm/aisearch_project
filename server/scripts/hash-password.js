const bcrypt = require('bcryptjs');

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
  console.error('Run this command in an interactive terminal.');
  process.exit(1);
}

let password = '';
process.stdout.write('Admin password: ');
process.stdin.setEncoding('utf8');
process.stdin.setRawMode(true);
process.stdin.resume();

process.stdin.on('data', chunk => {
  for (const character of chunk) {
    if (character === '\u0003' || character === '\u0004') {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\nCancelled.\n');
      process.exit(1);
    }

    if (character === '\r' || character === '\n') {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (!password) {
        console.error('Password cannot be empty.');
        process.exit(1);
      }
      console.log(`ADMIN_PASSWORD_HASH=${bcrypt.hashSync(password, 12)}`);
      process.exit(0);
    }

    if (character === '\u007f' || character === '\b') {
      if (password.length > 0) {
        password = password.slice(0, -1);
        process.stdout.write('\b \b');
      }
      continue;
    }

    password += character;
    process.stdout.write('*');
  }
});
