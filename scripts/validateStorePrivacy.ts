/**
 * Offline guard for the store privacy contract.
 *
 * It cannot inspect App Store Connect, Play Console or a compiled native
 * archive. It does catch repository regressions: an empty or incomplete Apple
 * manifest, tracking accidentally enabled, and broad Android storage
 * permissions reintroduced by a native dependency.
 *
 * Run: npm run validate:store-privacy
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type PrivacyDataEntry = {
  NSPrivacyCollectedDataType: string;
  NSPrivacyCollectedDataTypeLinked: boolean;
  NSPrivacyCollectedDataTypeTracking: boolean;
  NSPrivacyCollectedDataTypePurposes: string[];
};

type RequiredReasonEntry = {
  NSPrivacyAccessedAPIType: string;
  NSPrivacyAccessedAPITypeReasons: string[];
};

type AppConfig = {
  expo?: {
    ios?: {
      privacyManifests?: {
        NSPrivacyTracking?: boolean;
        NSPrivacyTrackingDomains?: string[];
        NSPrivacyCollectedDataTypes?: PrivacyDataEntry[];
        NSPrivacyAccessedAPITypes?: RequiredReasonEntry[];
      };
    };
    android?: { blockedPermissions?: string[] };
  };
};

const EXPECTED_DATA_TYPES = [
  'NSPrivacyCollectedDataTypeName',
  'NSPrivacyCollectedDataTypeEmailAddress',
  'NSPrivacyCollectedDataTypePhoneNumber',
  'NSPrivacyCollectedDataTypeOtherUserContactInfo',
  'NSPrivacyCollectedDataTypeCoarseLocation',
  'NSPrivacyCollectedDataTypeHealth',
  'NSPrivacyCollectedDataTypeEmailsOrTextMessages',
  'NSPrivacyCollectedDataTypePhotosorVideos',
  'NSPrivacyCollectedDataTypeOtherUserContent',
  'NSPrivacyCollectedDataTypeSearchHistory',
  'NSPrivacyCollectedDataTypeUserID',
  'NSPrivacyCollectedDataTypeDeviceID',
  'NSPrivacyCollectedDataTypeProductInteraction',
  'NSPrivacyCollectedDataTypeOtherDataTypes',
] as const;

const EXPECTED_REQUIRED_REASONS: Record<string, string[]> = {
  NSPrivacyAccessedAPICategoryFileTimestamp: ['C617.1', '0A2A.1', '3B52.1'],
  NSPrivacyAccessedAPICategoryDiskSpace: ['E174.1', '85F4.1'],
  NSPrivacyAccessedAPICategoryUserDefaults: ['CA92.1'],
  NSPrivacyAccessedAPICategorySystemBootTime: ['35F9.1'],
};

const BLOCKED_ANDROID_PERMISSIONS = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
] as const;

const releaseMode = process.argv.includes('--release');
let failures = 0;
let warnings = 0;

function check(label: string, condition: boolean, detail?: string): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${condition || !detail ? '' : `\n        ${detail}`}`);
  if (!condition) failures += 1;
}

function warnUnless(label: string, condition: boolean, detail: string): void {
  if (condition) return;
  console.log(`WARN  ${label}\n        ${detail}`);
  warnings += 1;
}

function releaseGate(label: string, condition: boolean, detail: string): void {
  if (releaseMode) check(label, condition, detail);
  else warnUnless(label, condition, detail);
}

function findPrivacyManifests(start: string): string[] {
  if (!existsSync(start)) return [];
  const manifests: string[] = [];
  const pending = [start];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name === 'PrivacyInfo.xcprivacy') manifests.push(path);
    }
  }
  return manifests;
}

const root = process.cwd();
const appJsonPath = join(root, 'app.json');
const config = JSON.parse(readFileSync(appJsonPath, 'utf8')) as AppConfig;
const manifest = config.expo?.ios?.privacyManifests;

check('app.json contains an iOS privacy manifest', Boolean(manifest));
check('cross-app tracking is disabled', manifest?.NSPrivacyTracking === false);
check(
  'tracking domain list is empty',
  Array.isArray(manifest?.NSPrivacyTrackingDomains) && manifest!.NSPrivacyTrackingDomains!.length === 0,
);

const dataEntries = manifest?.NSPrivacyCollectedDataTypes ?? [];
const dataTypes = new Set(dataEntries.map((entry) => entry.NSPrivacyCollectedDataType));
check('collected-data declaration is not empty', dataEntries.length > 0);

for (const type of EXPECTED_DATA_TYPES) {
  check(`Apple data type declared: ${type}`, dataTypes.has(type));
}
check(
  'security audit events are not mislabelled as crash/performance diagnostics',
  !dataTypes.has('NSPrivacyCollectedDataTypeOtherDiagnosticData'),
);

check(
  'Apple data types are unique',
  dataTypes.size === dataEntries.length,
  'Remove duplicate NSPrivacyCollectedDataType entries.',
);

for (const entry of dataEntries) {
  check(`${entry.NSPrivacyCollectedDataType} is linked`, entry.NSPrivacyCollectedDataTypeLinked === true);
  check(`${entry.NSPrivacyCollectedDataType} is not tracking`, entry.NSPrivacyCollectedDataTypeTracking === false);
  check(
    `${entry.NSPrivacyCollectedDataType} has a collection purpose`,
    Array.isArray(entry.NSPrivacyCollectedDataTypePurposes) && entry.NSPrivacyCollectedDataTypePurposes.length > 0,
  );
}

const otherUserContent = dataEntries.find(
  (entry) => entry.NSPrivacyCollectedDataType === 'NSPrivacyCollectedDataTypeOtherUserContent',
);
check(
  'deletion feedback has the Apple Analytics purpose',
  Boolean(otherUserContent?.NSPrivacyCollectedDataTypePurposes.includes('NSPrivacyCollectedDataTypePurposeAnalytics')),
);

const apiEntries = manifest?.NSPrivacyAccessedAPITypes ?? [];
const apiMap = new Map(apiEntries.map((entry) => [entry.NSPrivacyAccessedAPIType, new Set(entry.NSPrivacyAccessedAPITypeReasons)]));

for (const [api, reasons] of Object.entries(EXPECTED_REQUIRED_REASONS)) {
  const configured = apiMap.get(api);
  check(`required-reason API declared: ${api}`, Boolean(configured));
  for (const reason of reasons) {
    check(`${api} includes ${reason}`, Boolean(configured?.has(reason)));
  }
}

const configuredReasonCodes = new Set(
  apiEntries.flatMap((entry) => entry.NSPrivacyAccessedAPITypeReasons),
);
const installedPrivacyManifests = findPrivacyManifests(join(root, 'node_modules'));
check('installed native privacy manifests were discovered', installedPrivacyManifests.length > 0);
for (const installedManifest of installedPrivacyManifests) {
  const contents = readFileSync(installedManifest, 'utf8');
  const installedReasonCodes = [...contents.matchAll(/<string>([A-Z0-9]{4}\.[0-9])<\/string>/g)]
    .map((match) => match[1]);
  for (const reason of installedReasonCodes) {
    check(
      `installed SDK reason is aggregated: ${reason}`,
      configuredReasonCodes.has(reason),
      installedManifest,
    );
  }
}

const blocked = new Set(config.expo?.android?.blockedPermissions ?? []);
for (const permission of BLOCKED_ANDROID_PERMISSIONS) {
  check(`legacy Android permission blocked: ${permission}`, blocked.has(permission));
}

const policyPath = join(root, 'app', 'privacy-policy.tsx');
const policy = readFileSync(policyPath, 'utf8');
check('privacy policy documents authentication/security logs', policy.includes('Authentication and security logs'));
check('privacy policy documents no GPS collection', policy.includes('does not request GPS location'));
check('privacy policy documents no cross-app tracking', policy.includes('cross-app or cross-site tracking'));
check('privacy policy documents city-search disclosure', policy.includes('countries.dev'));
check('privacy policy documents external map requests', policy.includes('OpenStreetMap Foundation'));
check('privacy policy documents retained marketplace record', policy.includes('limited marketplace record'));
check('privacy policy discloses the retained internal account identifier', policy.includes('original internal account identifier'));
check('privacy policy avoids claiming exit feedback is anonymous', policy.includes('indirectly identifiable'));
check('privacy policy does not mislabel pseudonymous profiles as anonymised', !policy.includes('anonymised technician profile'));
check('stale offer-view collection claim was removed', !policy.includes('offer views'));
check('stale base-airport disclosure was removed', !policy.includes('base airport'));

const inventoryPath = join(root, 'docs', 'STORE_PRIVACY_DECLARATIONS.md');
check('store declaration inventory exists', existsSync(inventoryPath));
const inventory = readFileSync(inventoryPath, 'utf8');
check('release checklist includes Google Health apps declaration', inventory.includes("Health apps declaration"));

const terms = readFileSync(join(root, 'app', 'terms-of-service.tsx'), 'utf8');
releaseGate(
  'legal identity and jurisdiction are finalised',
  !policy.includes('[LEGAL_') && !terms.includes('[LEGAL_'),
  'Replace [LEGAL_ENTITY_NAME], [LEGAL_ADDRESS] and [LEGAL_JURISDICTION] before release.',
);
releaseGate(
  'public production URLs are finalised',
  !inventory.includes('<PUBLIC_DOMAIN>'),
  'Replace <PUBLIC_DOMAIN> and verify both public HTTPS pages before release.',
);
releaseGate(
  'external provider retention decisions are finalised',
  !inventory.includes('TBD —'),
  'Resolve every TBD provider-retention answer before copying the worksheet to a store console.',
);

const vercelConfig = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
  cleanUrls?: boolean;
  rewrites?: { source?: string; destination?: string }[];
};
check('public legal pages use extensionless clean URLs', vercelConfig.cleanUrls === true);
check(
  'web deployment no longer rewrites every route to the home page',
  !(vercelConfig.rewrites ?? []).some((rewrite) => rewrite.source === '/(.*)' && rewrite.destination === '/index.html'),
);
for (const [source, destination] of [
  ['/company/applications/:id', '/company/applications/[id]'],
  ['/company/chats/:id', '/company/chats/[id]'],
  ['/company/direct-offers/:id', '/company/direct-offers/[id]'],
  ['/company/offers/:id', '/company/offers/[id]'],
  ['/company/technician/:id', '/company/technician/[id]'],
  ['/technician/chats/:id', '/technician/chats/[id]'],
  ['/technician/direct-offers/:id', '/technician/direct-offers/[id]'],
  ['/technician/offers/:id', '/technician/offers/[id]'],
] as const) {
  check(
    `dynamic web route preserved: ${source}`,
    (vercelConfig.rewrites ?? []).some((rewrite) => rewrite.source === source && rewrite.destination === destination),
  );
}

const deleteFunction = readFileSync(join(root, 'supabase', 'functions', 'delete-account', 'index.ts'), 'utf8');
check('account deletion checks Storage failures', deleteFunction.includes('storageErr'));
check('account deletion enumerates the technician Storage folder', deleteFunction.includes('listTechnicianStoragePaths(bucket, techProfile.id)'));
check('account deletion does not trust document-row paths with service_role', !deleteFunction.includes(".select('storage_path')"));
check('account deletion verifies the Storage folder is empty', deleteFunction.includes('remainingPaths.length > 0'));

const publicDeletionPage = readFileSync(join(root, 'app', 'delete-account.tsx'), 'utf8');
const supportPage = readFileSync(join(root, 'app', 'support.tsx'), 'utf8');
check('public deletion page discloses the limited retained record', publicDeletionPage.includes('limited record'));
check('public deletion page avoids promising deletion of all associated data', !publicDeletionPage.includes('all associated personal data'));
check('support page avoids promising deletion of every record', !supportPage.includes('erase all your personal data'));
check('support links to the public deletion flow', supportPage.includes("router.push('/delete-account'"));
const authenticatedDeletionPage = readFileSync(join(root, 'app', 'account', 'delete.tsx'), 'utf8');
check(
  'authenticated deletion copy does not promise removal of all personal information',
  !authenticatedDeletionPage.includes('all personal information'),
);

// Documents vive en el grupo (you) desde la fase 8 (la URL no cambia).
const documentsPage = readFileSync(join(root, 'app', 'technician', '(you)', 'documents.tsx'), 'utf8');
const medicalConsentIndex = documentsPage.indexOf("consent_type: 'medical_document'");
const documentUploadIndex = documentsPage.indexOf('const { storagePath, error: storageError } = await uploadDocumentToStorage(');
check(
  'medical consent is recorded before the file upload begins',
  medicalConsentIndex >= 0 && documentUploadIndex >= 0 && medicalConsentIndex < documentUploadIndex,
);
const documentRowIndex = documentsPage.indexOf('await documentRepositoryV2.add({');
const storageRollbackIndex = documentsPage.indexOf('removeDocumentFromStorage(storagePath)');
const successfulPairIndex = documentsPage.indexOf('// From this point the file and its database row both exist.');
check(
  'failed document-row creation rolls back the uploaded object',
  documentRowIndex >= 0
    && storageRollbackIndex > documentRowIndex
    && successfulPairIndex > storageRollbackIndex,
);
check(
  'a list-refresh failure cannot roll back a successful document row',
  successfulPairIndex >= 0
    && storageRollbackIndex >= 0
    && storageRollbackIndex < successfulPairIndex
    && documentsPage.indexOf('await refresh();') > successfulPairIndex,
);

const documentRepository = readFileSync(join(root, 'src', 'repositories', 'v2', 'documentRepositoryV2.ts'), 'utf8');
check(
  'individual document deletion removes the Storage object',
  documentRepository.includes('removeDocumentFromStorage(document.storagePath)'),
);

const authContext = readFileSync(join(root, 'src', 'auth', 'AuthContext.tsx'), 'utf8');
check('confirmed-email signup backfills its legal consent row', authContext.includes('ensureLegalConsent(s.user)'));
check('consent backfill uses the version the user actually saw', authContext.includes('meta.tos_version'));
check('consent backfill preserves the original acceptance time', authContext.includes('meta.tos_accepted_at'));
check('auth-state callback stays synchronous', !authContext.includes('onAuthStateChange(\n      async'));
check('authenticated hydration is deferred outside the auth callback', authContext.includes('setTimeout(() =>'));
check('token refresh does not repeat profile and consent I/O', authContext.includes("event === 'TOKEN_REFRESHED'"));
check('transient profile errors preserve a previously loaded profile', authContext.includes('if (profileLoadSucceeded) setProfile(nextProfile)'));

for (const introPath of [
  join(root, 'src', 'components', 'intro', 'IntroExperience.native.tsx'),
  join(root, 'src', 'components', 'intro', 'IntroExperience.web.tsx'),
]) {
  const intro = readFileSync(introPath, 'utf8');
  check(
    `${introPath.split(/[\\/]/).pop()} avoids an unverified encryption-at-rest claim`,
    !intro.includes('encrypted document storage'),
  );
}

for (const signupPath of [
  join(root, 'app', 'auth', 'signup', 'technician.tsx'),
  join(root, 'app', 'auth', 'signup', 'company.tsx'),
]) {
  const signup = readFileSync(signupPath, 'utf8');
  check(`${signupPath.split(/[\\/]/).slice(-2).join('/')} records the original acceptance time`, signup.includes('accepted_at: legalAcceptedAt'));
}

console.log(
  failures === 0
    ? `\nStore privacy configuration: technical repository checks pass${warnings > 0 ? '; unresolved release gates remain in docs/STORE_PRIVACY_DECLARATIONS.md' : ''}.\n`
    : `\nStore privacy configuration: ${failures} check(s) failed.\n`,
);

process.exit(failures === 0 ? 0 : 1);
