import type { OCRData, CountryDocFormat } from '@kabila/shared';
import { applyUkDlCrossCheck, extractLabeledFields } from '@kabila/shared';
import type { FlatLine } from '../types.js';
import { logger } from '@/utils/logger.js';
import { BaseExtractor } from './BaseExtractor.js';
import { flattenLines } from '../utils/flattenLines.js';
import { parseMonthNameDate, standardizeDateFormat } from '../utils/dateUtils.js';
import { isHeaderNoise } from '../utils/nameUtils.js';
import { SPECIMEN_LABELS } from '../constants/noise.js';

type RecognitionResult = any;

/**
 * Extract the Uganda National Identification Number (NIN) from an OCR value.
 * The NIRA card prints the NIN in the "NIN CARD NO." row; PaddleOCR frequently
 * returns it merged with the neighbouring card serial (e.g.
 * "CM8808210G1JDF 021333783" -> "CM8808210G1JDF021333783"). The Uganda NIN is a
 * 14-character alphanumeric starting with "CM" or "CF", so we pull the leading
 * token matching that shape rather than the whole merged blob.
 */
function extractUgandaNin(value: string): string | null {
  const src = value.trim().toUpperCase();
  if (!src) return null;
  const standalone = src.match(/(?:^|[\s:;,.|/])(C[MF][A-Z0-9]{12})(?=$|[\s:;,.|/])/);
  if (standalone) return standalone[1];
  const lead = src.match(/\b(C[MF][A-Z0-9]{12})\b/);
  if (lead) return lead[1];
  const loose = src.match(/\b(C[MF][A-Z0-9]{10,})\b/);
  if (loose) return loose[1].slice(0, 14);
  return null;
}

export class InternationalExtractor extends BaseExtractor {

  extract(
    lines: RecognitionResult[][],
    ocrData: OCRData,
    format: CountryDocFormat,
    country: string,
  ): void {
    const flatLines = flattenLines(lines);
    const labels = format.field_labels;

    logger.info('PaddleOCR international extraction', {
      country,
      documentType: format.type,
      dateFormat: format.date_format,
      lineCount: flatLines.length,
    });

    // EU DL numbered-field format: use specialized parser
    if (this.isEUDriversLicense(flatLines, format)) {
      this.extractEUDriversLicenseData(flatLines, ocrData, format);
      ocrData.issuing_country = country;
      // UK DL: cross-check DOB against the licence number (deterministic, non-gating)
      applyUkDlCrossCheck(ocrData, country);
      return;
    }

    // Extract name: try separate surname + given name, then fall back to combined label
    {
      let surname = '';
      let givenName = '';
      let nameConf = 0;
      const surnamePatterns = labels.name.filter(p => /surname|family|last|appell|cognom|nachnam|achternaam|^mbiemri/i.test(p.source));
      const givenPatterns = labels.name.filter(p => /given|first|prénom|vornam|voornaam|^emri$/i.test(p.source));

      if (surnamePatterns.length > 0) {
        this.findField(flatLines, surnamePatterns, (value, conf) => {
          const cleaned = this.stripTrailingLabelNoise(value);
          if (cleaned && !isHeaderNoise(cleaned) && !SPECIMEN_LABELS.test(cleaned) && !this.isLabelOrNoise(cleaned)) {
            surname = cleaned;
            nameConf = Math.max(nameConf, conf);
            return;
          }
          return false;
        });
      }
      if (givenPatterns.length > 0) {
        this.findField(flatLines, givenPatterns, (value, conf) => {
          const cleaned = this.stripTrailingLabelNoise(value);
          if (cleaned && !isHeaderNoise(cleaned) && !SPECIMEN_LABELS.test(cleaned) && !this.isLabelOrNoise(cleaned)) {
            givenName = cleaned;
            nameConf = Math.max(nameConf, conf);
            return;
          }
          return false;
        });
      }

      if (surname || givenName) {
        ocrData.name = [givenName, surname].filter(Boolean).join(' ');
        ocrData.confidence_scores!.name = nameConf;
      } else {
        this.findField(flatLines, labels.name, (value, conf) => {
          const cleaned = this.stripTrailingLabelNoise(value);
          if (cleaned && !isHeaderNoise(cleaned) && !SPECIMEN_LABELS.test(cleaned) && !this.isLabelOrNoise(cleaned)) {
            ocrData.name = cleaned;
            ocrData.confidence_scores!.name = conf;
            return;
          }
          return false;
        });
      }
    }

    // Extract date of birth with country date format hint.
    // The hint is also passed into findDateField so standardizeDateFormat
    // resolves ambiguous DD/MM vs MM/DD correctly BEFORE normalizeDateWithHint
    // would see a pre-normalized YYYY-MM-DD and no-op.
    this.findDateField(flatLines, labels.date_of_birth, (value, conf) => {
      ocrData.date_of_birth = this.normalizeDateWithHint(value, format.date_format);
      ocrData.confidence_scores!.date_of_birth = conf;
    }, format.date_format);

    // Extract ID number
    this.findField(flatLines, labels.id_number, (value, conf) => {
      // Strip trailing label fragments before pattern matching
      const valueClean = this.stripTrailingLabelNoise(value);
      const cleaned = valueClean.replace(/\s+/g, '');
      if (/^[A-Z0-9\-]{4,15}$/i.test(cleaned) && !this.isLabelOrNoise(cleaned) && /\d/.test(cleaned)) {
        ocrData.document_number = cleaned;
        ocrData.confidence_scores!.document_number = conf;
        return;
      }
      // Scan the cleaned value for an alphanumeric token containing a digit.
      // The stricter pattern (leading letter + 7+ digits) handles formats like "T1K2N89G7".
      const idM =
        valueClean.match(/\b([A-Z]\d{6,12}[A-Z0-9]{0,3})\b/i) ??
        valueClean.match(/\b([A-Z]{1,3}\d[A-Z0-9]{5,14})\b/i) ??
        valueClean.match(/\b(\d{6,14})\b/);
      if (idM) {
        ocrData.document_number = idM[1];
        ocrData.confidence_scores!.document_number = conf * 0.9;
        return;
      }
      return false;
    });

    // Extract expiry date. Pass date_format hint so ambiguous dates like
    // "06-02-2028" are interpreted correctly (DMY -> 2028-02-06). The 2-line
    // window is explicitly opted into via options.windowSize=2 to handle
    // bilingual layouts where the dates sit below a two-row stacked label
    // header (French / Kreyòl).
    this.findLastDateField(
      flatLines,
      labels.expiry_date,
      (value, conf) => {
        ocrData.expiration_date = this.normalizeDateWithHint(value, format.date_format);
        ocrData.confidence_scores!.expiration_date = conf;
      },
      format.date_format,
      { windowSize: 2 },
    );

    // Extract nationality
    this.findField(flatLines, labels.nationality, (value, conf) => {
      let cleaned = value.replace(/^\*+\s*/, '').replace(/\s*\*+$/, '').trim();
      cleaned = cleaned.replace(/\s+\d{5,}$/, '').trim();
      // Strip leading compound labels like "Nom/ Siyati " from bilingual docs
      cleaned = this.stripLeadingLabelNoise(cleaned);
      const slashParts = cleaned.split('/').map(s => s.trim())
        .filter(s => s.length >= 2 && !this.isLabelOrNoise(s));
      if (slashParts.length >= 2) {
        // Prefer the longest non-label token (typically the full nationality word)
        cleaned = slashParts.reduce((a, b) => b.length > a.length ? b : a);
      } else if (slashParts.length === 1) {
        cleaned = slashParts[0];
      }
      if (cleaned.length >= 2 && cleaned.length <= 30 && !this.isLabelOrNoise(cleaned)) {
        ocrData.nationality = cleaned;
        ocrData.confidence_scores!.nationality = conf;
        return;
      }
      return false;
    });

    // Extract address
    this.findField(flatLines, labels.address, (value, conf) => {
      ocrData.address = value;
      ocrData.confidence_scores!.address = conf;
    });

    // Extract issuing authority
    this.findField(flatLines, labels.issuing_authority, (value, conf) => {
      ocrData.issuing_authority = value;
      ocrData.confidence_scores!.issuing_authority = conf;
    });

    // Extract sex - shared helper handles same-line values ("SEX: F") and the
    // stacked label-row -> value-row layout used by East-African national IDs
    // (Uganda/Kenya print "NATIONALITY  SEX  DATE OF BIRTH" above "UGA F 04.06.1990").
    this.extractSexField(flatLines, ocrData);

    // Uganda specific field extraction (NIN, Card No on front; District, Sub-county, Parish, Village on back)
    if (country === 'UG') {
      // NIN (National Identification Number: CM... / CF...). The label line is
      // "NIN CARD NO." and the value (e.g. "CM8808210G1JDF 021333783") is read
      // on the following line, often with the serial merged onto the NIN. Pull
      // just the CM/CF token so the displayed ID number is the NIN, not the
      // full merged machine string.
      this.findField(flatLines, [/nin\b/i, /national\s*id\s*no/i], (value, conf) => {
        const nin = extractUgandaNin(value);
        if (nin) {
          ocrData.document_number = nin;
          (ocrData as any).nin = nin;
          ocrData.confidence_scores!.document_number = conf;
          return;
        }
        return false;
      });

      // Card No (printed on front of Ugandan ID)
      this.findField(flatLines, [/card\s*no/i, /card\s*number/i, /serial\s*no/i], (value, conf) => {
        const cleaned = value.replace(/\s+/g, '');
        if (/^[A-Z0-9]{6,12}$/i.test(cleaned)) {
          (ocrData as any).card_number = cleaned;
          ocrData.confidence_scores!.card_number = conf;
        }
      });

      // Nationality on card is UGA / UGANDAN
      if (ocrData.nationality) {
        if (/UGA|UGANDAN/i.test(ocrData.nationality)) {
          ocrData.nationality = 'UGA';
        }
      }

      // Back ID fields: District, County / Sub-county, Parish, Village.
      // The NIRA card prints "VELAGE … / A.COUNTY …" (garbled, space-separated),
      // so a clean `findField` won't match - merge the OCR-tolerant labeled-field
      // parser as the primary source and fall back to the labelled regex below.
      if (ocrData.raw_text) {
        const labeled = extractLabeledFields(ocrData.raw_text);
        const setMaybe = (key: string, value: string | undefined) => {
          if (value && !(ocrData as any)[key]) {
            (ocrData as any)[key] = value;
            ocrData.confidence_scores![key] = ocrData.confidence_scores![key] ?? 0.85;
          }
        };
        setMaybe('village', labeled.village);
        setMaybe('parish', labeled.parish);
        setMaybe('sub_county', labeled.sub_county);
        setMaybe('district', labeled.district);
      }

      this.findField(flatLines, [/district/i], (value, conf) => {
        const cleaned = this.stripLeadingLabelNoise(value);
        if (cleaned && !this.isLabelOrNoise(cleaned)) {
          (ocrData as any).district = cleaned;
          ocrData.confidence_scores!.district = conf;
        }
      });

      this.findField(flatLines, [/sub-county/i, /sub\s*county/i, /county/i], (value, conf) => {
        const cleaned = this.stripLeadingLabelNoise(value);
        if (cleaned && !this.isLabelOrNoise(cleaned)) {
          (ocrData as any).sub_county = cleaned;
          ocrData.confidence_scores!.sub_county = conf;
        }
      });

      this.findField(flatLines, [/parish/i], (value, conf) => {
        const cleaned = this.stripLeadingLabelNoise(value);
        if (cleaned && !this.isLabelOrNoise(cleaned)) {
          (ocrData as any).parish = cleaned;
          ocrData.confidence_scores!.parish = conf;
        }
      });

      this.findField(flatLines, [/village/i], (value, conf) => {
        const cleaned = this.stripLeadingLabelNoise(value);
        if (cleaned && !this.isLabelOrNoise(cleaned)) {
          (ocrData as any).village = cleaned;
          ocrData.confidence_scores!.village = conf;
        }
      });

      // Nationality / sex / DOB: the "UGA M 30.09.1988" value row is printed with
      // the labels garbled ("NATKINALITY GEX UATE OF TH"), so a label-independent
      // scan of that row recovers all three fields.
      for (const line of flatLines) {
        const m = line.text.trim().match(
          /\b(UG(?:ANDA|ANDAN)?|UGA)\b\s+([MF])\s+(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2,4})\b/i,
        );
        if (!m) continue;
        const [, nat, sex, d1, d2, yr] = m;
        const natNorm = nat.toUpperCase().startsWith('UG') ? 'UGA' : nat.toUpperCase();
        ocrData.nationality = ocrData.nationality || natNorm;
        ocrData.sex = ocrData.sex || sex.toUpperCase();
        if (!ocrData.date_of_birth) {
          const y = yr.length === 2 ? (parseInt(yr) > 30 ? '19' + yr : '20' + yr) : yr;
          ocrData.date_of_birth = `${y}-${d2.padStart(2, '0')}-${d1.padStart(2, '0')}`;
        }
        ocrData.confidence_scores!.nationality = ocrData.confidence_scores!.nationality ?? line.confidence;
        ocrData.confidence_scores!.sex = ocrData.confidence_scores!.sex ?? line.confidence;
        ocrData.confidence_scores!.date_of_birth = ocrData.confidence_scores!.date_of_birth ?? line.confidence;
        break;
      }

      if (!ocrData.address) {
        const addrParts = [(ocrData as any).village, (ocrData as any).parish, (ocrData as any).sub_county, (ocrData as any).district, 'Uganda'].filter(Boolean);
        if (addrParts.length > 1) {
          ocrData.address = addrParts.join(', ');
          ocrData.confidence_scores!.address = 0.85;
        }
      }

      // Surname: the printed "SURNAME" label (e.g. TUTU) often OCRs as
      // "SURMAME" and is missed by the general name path above, which captures
      // only the given name (e.g. "MOSES MUGULI"). Recover it with a fuzzy
      // match and rebuild the on-card full name so the surname is not lost.
      this.findField(flatLines, [/[sS][uU][rR][mMnN][aA][mM][eE]/, /\bsurname\b/i], (v, c) => {
        const cleaned = this.stripTrailingLabelNoise(v);
        if (!cleaned || this.isLabelOrNoise(cleaned) || isHeaderNoise(cleaned)) return false;
        const existing = ocrData.name || '';
        const already = existing && new RegExp(`\\b${cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(existing);
        if (already) return false;
        (ocrData as any).surname = cleaned;
        ocrData.name = existing ? `${cleaned} ${existing}` : cleaned;
        (ocrData as any).full_name = ocrData.name;
        ocrData.confidence_scores!.surname = c;
        ocrData.confidence_scores!.name = ocrData.confidence_scores!.name ?? c;
        return;
      });
    }

    ocrData.issuing_country = country;
  }

  // ── Date normalization with country hint ─────────────────

  private normalizeDateWithHint(dateStr: string, hint: 'DMY' | 'MDY' | 'YMD'): string {
    const monthNameResult = parseMonthNameDate(dateStr);
    if (monthNameResult) return monthNameResult;

    const m = dateStr.match(/(\d{1,4})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
    if (!m) return dateStr;

    let [, p1, p2, p3] = m;

    if (p1.length === 4) return `${p1}-${p2.padStart(2, '0')}-${p3.padStart(2, '0')}`;

    if (hint === 'YMD' && p1.length === 2) {
      const yy = parseInt(p1);
      p1 = String(yy > 30 ? 1900 + yy : 2000 + yy);
    } else if (p3.length === 2) {
      const yy = parseInt(p3);
      p3 = String(yy > 30 ? 1900 + yy : 2000 + yy);
    }

    switch (hint) {
      case 'DMY': return `${p3}-${p2.padStart(2, '0')}-${p1.padStart(2, '0')}`;
      case 'MDY': return `${p3}-${p1.padStart(2, '0')}-${p2.padStart(2, '0')}`;
      case 'YMD': return `${p1}-${p2.padStart(2, '0')}-${p3.padStart(2, '0')}`;
    }
  }

  // ── EU Driving License ──────────────────────────────────────

  // Trailing characters are optional and diacritics are accepted in their plain form:
  // worn cards, cropped photos and ordinary OCR slips routinely drop the final glyph
  // or flatten an umlaut, and losing one character should not disable extraction.
  private static EU_DL_HEADER = /F[ÜU]HRERSCHEIN?|PERMIS\s*DE\s*CONDUIRE?|DRIVING\s*LICEN[CS]E?|PATENTE?|RIJBEWIJS?|CARTA\s*DE\s*CONDU[CÇ][AÃ]O?|PERMISO\s*DE\s*CONDUCIR?|K[ÖO]RKORT?|AJOKORTTI?|PRAWO\s*JAZDY?|[ŘR]IDI[ČC]SK[ÝY]\s*PR[ŮU]KAZ?|VODI[ČC]SK[ÝY]\s*PREUKAZ?/i;

  private isEUDriversLicense(flatLines: FlatLine[], format: CountryDocFormat): boolean {
    if (format.type !== 'drivers_license') return false;
    const fullText = flatLines.map(l => l.text).join(' ');
    if (InternationalExtractor.EU_DL_HEADER.test(fullText)) return true;
    let numberedCount = 0;
    for (const line of flatLines) {
      if (/^\s*(\d[abc]?)[\.\s]\s*.+/.test(line.text)) numberedCount++;
    }
    return numberedCount >= 3;
  }

  private extractEUDriversLicenseData(
    flatLines: FlatLine[],
    ocrData: OCRData,
    format: CountryDocFormat,
  ): void {
    const fields = new Map<string, string>();

    for (const line of flatLines) {
      const m = line.text.match(/^\s*(\d[abc]?)[\.\s]\s*(.+)/);
      if (m) {
        const fieldNum = m[1].toLowerCase();
        const value = m[2].trim();
        if (!fields.has(fieldNum) && value.length > 0) {
          fields.set(fieldNum, value);
        }
      }
      if (!fields.has('1')) {
        const m1 = line.text.match(/\b1[\.\s]\s*([A-Z][A-Za-zÀ-ÖØ-öø-ÿ\-'\s]+)/);
        if (m1) {
          const val = m1[1].trim();
          if (val.length >= 2 && !SPECIMEN_LABELS.test(val)) {
            fields.set('1', val);
          }
        }
      }
    }

    logger.info('EU DL numbered fields extracted', { fields: Object.fromEntries(fields) });

    const stripTrailingNoise = (s: string) =>
      s.replace(/\s+\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4}.*$/, '')
       .replace(/\s+\d{2,}$/, '')
       .trim();

    // 1. Surname + 2. Given name -> combined name
    const surname = stripTrailingNoise(fields.get('1') ?? '');
    const givenName = stripTrailingNoise(fields.get('2') ?? '');
    if (surname || givenName) {
      const name = [givenName, surname].filter(Boolean).join(' ');
      if (!SPECIMEN_LABELS.test(name)) {
        ocrData.name = name;
        ocrData.confidence_scores!.name = 0.9;
      }
    }

    // 3. Date of birth
    const dobRaw = fields.get('3');
    if (dobRaw) {
      const dob = this.normalizeDateWithHint(dobRaw, format.date_format)
        ?? this.extractDate(dobRaw);
      if (dob) {
        ocrData.date_of_birth = dob;
        ocrData.confidence_scores!.date_of_birth = 0.9;
      }
    }

    // 4b. Expiry date
    const expiryRaw = fields.get('4b');
    if (expiryRaw) {
      const expiry = this.normalizeDateWithHint(expiryRaw, format.date_format)
        ?? this.extractDate(expiryRaw);
      if (expiry) {
        ocrData.expiration_date = expiry;
        ocrData.confidence_scores!.expiration_date = 0.9;
      }
    }

    // 4c. Issuing authority
    const authority = fields.get('4c');
    if (authority) {
      ocrData.issuing_authority = authority;
      ocrData.confidence_scores!.issuing_authority = 0.9;
    }

    // 5. License number
    const licNum = fields.get('5');
    if (licNum) {
      const cleaned = licNum.replace(/\s+/g, '');
      if (/^[A-Z0-9]{4,20}$/i.test(cleaned)) {
        ocrData.document_number = cleaned;
        ocrData.confidence_scores!.document_number = 0.9;
      }
    }

    // Fallback: extract license number from 4b line
    if (!ocrData.document_number && expiryRaw) {
      const afterDate = expiryRaw.replace(/^\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4}\s*/, '');
      const docM = afterDate.match(/\b([A-Z0-9]{6,15})\b/i);
      if (docM && /[A-Z]/i.test(docM[1]) && /\d/.test(docM[1])) {
        ocrData.document_number = docM[1];
        ocrData.confidence_scores!.document_number = 0.85;
      }
    }

    // Sex
    for (const line of flatLines) {
      if (!ocrData.sex) {
        const sexM = line.text.match(/\b(?:SEX|GESCHLECHT|SEXE)\s*[:\s]\s*([MFmf])\b/i)
          ?? line.text.match(/\b([MF])\s*$/);
        if (sexM) {
          ocrData.sex = sexM[1].toUpperCase();
          ocrData.confidence_scores!.sex = 0.85;
        }
      }
    }
  }
}
