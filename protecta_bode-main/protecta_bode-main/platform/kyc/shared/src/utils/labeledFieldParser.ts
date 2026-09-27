/**
 * Extract "LABEL: value" style fields from a block of raw OCR / barcode text.
 *
 * Used to pick structured address fields (village, parish, sub-county, district)
 * out of raw_text lines like:
 *   VILLAGE: UPPER NSOOBA
 *   PARISH: MULAGO III
 *   S.COUNTY: KAWEMPE DIVISION
 *   DISTRICT: KAMPALA
 *
 * Also tolerates the real-world OCR output from Uganda's NIRA card, where the
 * printed labels come back garbled and the separator is a bare space rather than
 * a colon:
 *   VELAGE UPPER NSOOBA          (VILLAGE)
 *   PARISH MULAGO                (PARISH)
 *   A.COUNTY KAWENPE DIVISION    (SUB-COUNTY)
 *   COUNTK KAWEMPE DIVISION      (COUNTY)
 *   DISTRICT KAMPALA             (DISTRICT)
 *
 * Returns only fields whose label was actually present in the text.
 */
export interface UgAddressFields {
  address?: string;
  district?: string;
  sub_county?: string;
  parish?: string;
  village?: string;
}

type AddressKey = keyof UgAddressFields;

/**
 * OCR-tolerant label aliases for the address block. Keys are the canonical field;
 * values are the printed variants PaddleOCR returns for the same label. Matching is
 * exact (after punctuation is stripped) so we never mis-read an unrelated line as an
 * address field - the aliases list is bounded and specific to Ugandan ID labels.
 */
const LABEL_ALIASES: Record<AddressKey, string[]> = {
  village: ['village', 'velage', 'vilage', 'villag', 'villge', 'vill', 'ville', 'vilaje', 'vellaqe'],
  parish: ['parish', 'parrsh', 'parah', 'parih', 'prish', 'prah', 'parash'],
  sub_county: [
    'scounty', 's.county', 'subcounty', 'sub.county', 'sub-county', 'sub county',
    'acounty', 'a.county', 'county', 'cnty', 'co.unt', 's.c', 's.count',
  ],
  district: ['district', 'distrct', 'distric', 'districk', 'distr', 'disctrict', 'disttrict', 'distnt', 'dstrct'],
  address: ['address', 'addr', 'adres', 'addres'],
};

/** Strip everything non-alpha and uppercase for comparison. */
function normLabel(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '');
}

/** True when `candidate` is a known OCR alias for `field`. */
function isAliasOf(candidate: string, field: AddressKey): boolean {
  const n = normLabel(candidate);
  if (!n) return false;
  for (const alias of LABEL_ALIASES[field]) {
    if (normLabel(alias) === n) return true;
  }
  return false;
}

/**
 * Match a leading label on a single, already-trimmed line.
 * Handles "LABEL VALUE", "LABEL: VALUE", "LABEL - VALUE" and multi-word labels
 * (S.COUNTY / SUB-COUNTY). Returns the canonical field + the remainder as the value.
 */
function matchLeadingLabel(line: string): { key: AddressKey | null; value: string } {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length === 0) return { key: null, value: '' };

  // Labels are one or two tokens (e.g. "S.COUNTY", "SUB-COUNTY", "A.COUNTY").
  // Try the widest (2-token) label first so "SUB COUNTY" is not miscut as "SUB".
  for (const count of [2, 1]) {
    if (tokens.length < count) continue;
    const candidate = tokens.slice(0, count).join(' ').trim();
    for (const field of Object.keys(LABEL_ALIASES) as AddressKey[]) {
      if (!isAliasOf(candidate, field)) continue;
      const value = tokens
        .slice(count)
        .join(' ')
        .replace(/^[:=\-]+/, '')
        .replace(/^\s+/, '')
        .trim();
      return { key: field, value };
    }
  }

  return { key: null, value: '' };
}

/**
 * Parse labeled fields from arbitrary raw text.
 * Handles lines like `LABEL:VALUE`, `LABEL: VALUE`, `LABEL - VALUE` and, for
 * Ugandan IDs, `LABEL VALUE` (space-separated). Reads each recognized label and
 * takes the remainder of its line as the value. Previously it read until the next
 * known label; the line-local approach is more robust for the Ugandan layout where
 * values can themselves contain words that look like labels (e.g. "COUNTY").
 */
export function extractLabeledFields(rawText: string): UgAddressFields {
  const out: UgAddressFields = {};
  if (!rawText) return out;

  const lines = rawText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Skip lines that are clearly machine-readable code (MRZ rows) - they are
    // long runs of A-Z/0-9/< with no spaces and never carry address labels.
    if (/^[A-Z0-9<]{20,}$/.test(line)) continue;

    const { key, value } = matchLeadingLabel(line);

    // Value on the same line is the common case (Ugandan cards print
    // "PARISH MULAGO"). Fall back to the next non-empty, non-MRZ line when a
    // label is followed by a blank (e.g. "VILLAGE:" then the value row below).
    let resolved = value;
    if (key && !resolved) {
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (!nextLine) continue;
        if (/^[A-Z0-9<]{20,}$/.test(nextLine)) break;
        const next = matchLeadingLabel(nextLine);
        if (next.key) break; // reached the next label - stop
        resolved = nextLine;
        break;
      }
    }

    if (key && resolved && !(out as any)[key]) {
      (out as any)[key] = resolved.replace(/\s+/g, ' ').trim();
    }
  }

  return out;
}

/**
 * Merge extracted labeled address fields into a QR payload, filling in any
 * blank fields without overwriting ones already populated.
 */
export function mergeLabeledAddressFields<T extends UgAddressFields>(
  payload: T,
  rawText: string | undefined | null,
): T {
  if (!rawText) return payload;
  const labeled = extractLabeledFields(rawText);
  const merged: any = { ...payload };
  for (const k of ['address', 'district', 'sub_county', 'parish', 'village'] as const) {
    if (!merged[k] && labeled[k]) {
      merged[k] = labeled[k];
    }
  }
  // If address is still missing, build a composite from the Ugandan address parts
  if (!merged.address) {
    const parts = [merged.village, merged.parish, merged.sub_county, merged.district]
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
    if (parts.length > 0) {
      merged.address = parts.join(', ');
    }
  }
  return merged;
}
