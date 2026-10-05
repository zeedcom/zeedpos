import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';

import { getInstallId } from './installId.js';

const FIREBASE_DATABASE_URL =
  'https://zeedcomapp-default-rtdb.europe-west1.firebasedatabase.app/';

const FIREBASE_LICENSE_PATH =
  '/licenses/zeedops';

const LICENSE_FILE = path.join(
  app.getPath('userData'),
  'POS',
  '.license'
);

function ensureDirectory() {
  fs.mkdirSync(
    path.dirname(LICENSE_FILE),
    { recursive: true }
  );
}

function saveLocalLicense(licenseKey, machineId) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Secure storage is not available.'
    );
  }

  ensureDirectory();

  const data = {
    licenseKey,
    machineId,
    activatedAt: new Date().toISOString(),
  };

  const encrypted =
    safeStorage.encryptString(
      JSON.stringify(data)
    );

  fs.writeFileSync(
    LICENSE_FILE,
    encrypted
  );
  app.quit();
}

function loadLocalLicense() {
  if (!fs.existsSync(LICENSE_FILE)) {
    return null;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Secure storage is not available.'
    );
  }

  try {
    const encrypted =
      fs.readFileSync(LICENSE_FILE);

    const decrypted =
      safeStorage.decryptString(
        encrypted
      );

    return JSON.parse(decrypted);

  } catch (error) {
    console.error(
      'Failed to read local license:',
      error
    );

    return null;
  }
}

function getLicenseUrl(licenseKey) {
  return (
    `${FIREBASE_DATABASE_URL}/` +
    `${FIREBASE_LICENSE_PATH}/` +
    `${encodeURIComponent(licenseKey)}.json`
  );
}


/*
 * Check local license.
 *
 * This function does NOT use Firebase.
 *
 * Therefore subsequent application
 * launches work completely offline.
 */
export function validateLocalLicense() {
  try {
    const license =
      loadLocalLicense();

    if (!license) {
      return {
        valid: false,
        reason: 'NOT_ACTIVATED',
      };
    }

    const machineId =
      getInstallId();

    if (
      license.machineId !== machineId
    ) {
      return {
        valid: false,
        reason: 'WRONG_MACHINE',
      };
    }

    if (!license.licenseKey) {
      return {
        valid: false,
        reason: 'INVALID_LICENSE',
      };
    }

    return {
      valid: true,
      license,
    };

  } catch (error) {
    console.error(
      'Local license validation error:',
      error
    );

    return {
      valid: false,
      reason: 'LICENSE_ERROR',
      message: error.message,
    };
  }
}


/*
 * Activate license.
 *
 * Firebase is contacted ONLY during
 * activation.
 */
export async function activateLicense(
  licenseKey
) {
  const key =
    String(licenseKey || '').trim();

  if (!key) {
    throw new Error(
      'License key is required.'
    );
  }

  const machineId =
    getInstallId();

  const url =
    getLicenseUrl(key);

 

  let response;

  try {
    response =
      await fetch(url);
  } catch (error) {
    console.error(
      'Firebase connection error:',
      error
    );

    throw new Error(
      'Cannot connect to Firebase. Please check your Internet connection.'
    );
  }

  if (!response.ok) {
    throw new Error(
      `Firebase returned HTTP ${response.status}.`
    );
  }

  const license =
    await response.json();

  /*
   * License does not exist.
   */
  if (license === null) {
    throw new Error(
      'Invalid license key.'
    );
  }

  /*
   * License already activated
   * on this machine.
   */
  if (
    license.machineId === machineId
  ) {
    saveLocalLicense(
      key,
      machineId
    );

    return {
      valid: true,

      license: {
        licenseKey: key,
        machineId,
      },
    };
  }

  /*
   * License activated on another
   * machine.
   */
  if (
  license.machineId &&
  license.machineId !== machineId
) {
  throw new Error(
    'This license is already activated on another computer.'
  );
}

  /*
   * License is available.
   *
   * Claim it.

    */

  let updateResponse;

  try {
    updateResponse =
      await fetch(url, {
        method: 'PATCH',

        headers: {
          'Content-Type':
            'application/json',
        },

        body: JSON.stringify({
          machineId,
        }),
      });

  } catch (error) {
    console.error(
      'Firebase activation connection error:',
      error
    );

    throw new Error(
      'Could not connect to Firebase while activating the license.'
    );
  }

  if (!updateResponse.ok) {
    throw new Error(
      `Firebase activation failed: HTTP ${updateResponse.status}.`
    );
  }

  /*
   * Save locally only after Firebase
   * accepted the activation.
   */
  saveLocalLicense(
    key,
    machineId
  );



  return {
    valid: true,

    license: {
      licenseKey: key,
      machineId,
    },
  };
}