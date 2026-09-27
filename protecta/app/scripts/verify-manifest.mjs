import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

/** SDK validation doesn't cover every command/settings/field reference. */
export const verifyManifest = (appPath) => {
  const manifest = JSON.parse(
    readFileSync(path.join(appPath, '.twenty/output/manifest.json'), 'utf8'),
  );
  const components = new Set(
    manifest.frontComponents.map((item) => item.universalIdentifier),
  );
  const functions = new Set(
    manifest.logicFunctions.map((item) => item.universalIdentifier),
  );
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.frontComponentUniversalIdentifier)
      assert(
        components.has(value.frontComponentUniversalIdentifier),
        `Missing UI component ${value.frontComponentUniversalIdentifier}`,
      );
    for (const child of Object.values(value)) visit(child);
  };
  visit(manifest);

  const fields = [
    ...manifest.fields,
    ...manifest.objects.flatMap((object) => object.fields ?? []),
  ];
  const fieldIdentifiers = new Set(
    fields.map((field) => field.universalIdentifier),
  );
  const reservedFieldNames = new Set(['event', 'type']);
  for (const field of fields) {
    assert(
      !reservedFieldNames.has(field.name),
      `Field name "${field.name}" is reserved; use a distinct name.`,
    );

    if (field.type === 'FILES') {
      const maxNumberOfValues = field.universalSettings?.maxNumberOfValues;
      assert(
        Number.isInteger(maxNumberOfValues) &&
          maxNumberOfValues > 0 &&
          maxNumberOfValues <= 60,
        `FILES field "${field.name}" must set universalSettings.maxNumberOfValues to an integer from 1 to 60.`,
      );
    }

    if (field.type === 'SELECT' || field.type === 'MULTI_SELECT') {
      for (const option of field.options ?? []) {
        assert(
          /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(option.value),
          `Option "${option.value}" on field "${field.name}" must use UPPER_CASE_SNAKE_CASE.`,
        );
      }
    }
  }

  for (const view of manifest.views) {
    for (const field of view.fields ?? []) {
      assert(
        fieldIdentifiers.has(field.fieldMetadataUniversalIdentifier),
        `View "${view.name}" references missing field metadata ${field.fieldMetadataUniversalIdentifier}.`,
      );
    }
  }

  const constants = readFileSync(
    path.join(appPath, 'src/constants/universal-identifiers.ts'),
    'utf8',
  );
  const ids = new Map(
    [...constants.matchAll(/export const (\w+)\s*=\s*'([^']+)'/g)].map(
      (match) => [match[1], match[2]],
    ),
  );
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(file);
        continue;
      }
      if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
      for (const match of readFileSync(file, 'utf8').matchAll(
        /logicFunctionUniversalIdentifier:\s*(\w+)/g,
      )) {
        assert(
          functions.has(ids.get(match[1])),
          `Queued worker ${match[1]} referenced by ${file} is missing`,
        );
      }
    }
  };
  scan(path.join(appPath, 'src'));
  console.log(
    `Verified ${components.size} UI components, ${functions.size} functions, field settings and view field references.`,
  );
};
