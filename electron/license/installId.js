import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const FILE_NAME = '.installation-id';

export function getInstallId() {
  const directory = path.join(
    app.getPath('userData'),
    'POS'
  );

  fs.mkdirSync(directory, {
    recursive: true,
  });

  const file = path.join(
    directory,
    FILE_NAME
  );

  if (fs.existsSync(file)) {
    const id = fs.readFileSync(file, 'utf8').trim();

    if (id) {
      return id;
    }
  }

  const id = crypto.randomUUID();

  fs.writeFileSync(file, id, 'utf8');

  return id;
}