/**
 * HubSpot Duplicate Detection
 *
 * Find potential duplicate companies and contacts using multiple heuristics.
 */

import { queryCrm } from '../query';
import type {
  FindDuplicateCompaniesInput,
  FindDuplicateCompaniesOutput,
  FindDuplicateContactsInput,
  FindDuplicateContactsOutput,
} from '../schemas';
// Internal helper: Normalize company name for comparison
function normalizeCompanyName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[.,'"!?()[\]{}]/g, '') // Remove punctuation
    .replace(
      /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|nv|bv)\b\.?/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

// Internal helper: Normalize phone for comparison
function normalizePhone(phone: string): string {
  if (!phone) return '';
  return phone.replace(/\D/g, ''); // Strip all non-digits
}

// Internal helper: Simple Levenshtein distance
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1, // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find potential duplicate companies using multiple heuristics.
 * Scans companies and identifies pairs that may be duplicates based on:
 * - Exact domain match (90% confidence)
 * - Normalized name match (80% confidence)
 * - Phone number match (70% confidence)
 * - Fuzzy name similarity (60% confidence)
 *
 * IMPORTANT: Always confirm with user which record should be primary before merging.
 */
export async function findDuplicateCompanies(
  opts: FindDuplicateCompaniesInput,
): Promise<FindDuplicateCompaniesOutput> {
  const threshold = opts.threshold ?? 60;
  const maxRecords = opts.maxRecords ?? 500;

  type CompanyRecord = { id: string; [key: string]: string };

  // Fetch companies in batches
  const companies: CompanyRecord[] = [];
  let offset = 0;
  const batchSize = 100;

  while (companies.length < maxRecords) {
    const result = await queryCrm({
      csrf: opts.csrf,
      portalId: opts.portalId,
      objectType: 'companies',
      properties: ['name', 'domain', 'phone', 'city', 'state'],
      count: batchSize,
      offset,
      filterGroupsOperator: 'AND',
    });

    companies.push(...(result.results as CompanyRecord[]));

    if (result.results.length < batchSize || companies.length >= result.total) {
      break;
    }
    offset += batchSize;
  }

  // Build lookup indexes
  const domainIndex = new Map<string, string[]>();
  const phoneIndex = new Map<string, string[]>();
  const normalizedNameIndex = new Map<string, string[]>();

  for (const company of companies) {
    const id = company.id;

    // Domain index
    if (company.domain) {
      const domain = company.domain.toLowerCase().replace(/^www\./, '');
      if (!domainIndex.has(domain)) domainIndex.set(domain, []);
      domainIndex.get(domain)!.push(id);
    }

    // Phone index
    if (company.phone) {
      const phone = normalizePhone(company.phone);
      if (phone.length >= 7) {
        // Only index valid phone numbers
        if (!phoneIndex.has(phone)) phoneIndex.set(phone, []);
        phoneIndex.get(phone)!.push(id);
      }
    }

    // Normalized name index
    if (company.name) {
      const normalizedName = normalizeCompanyName(company.name);
      if (normalizedName) {
        if (!normalizedNameIndex.has(normalizedName))
          normalizedNameIndex.set(normalizedName, []);
        normalizedNameIndex.get(normalizedName)!.push(id);
      }
    }
  }

  // Find duplicates - use Map for O(1) lookups instead of O(n) array searches
  const duplicates: FindDuplicateCompaniesOutput['duplicates'] = [];
  const matchIndex = new Map<
    string,
    FindDuplicateCompaniesOutput['duplicates'][0]
  >();

  const addMatch = (
    idA: string,
    idB: string,
    confidence: number,
    reason: string,
  ) => {
    const pairKey = [idA, idB].sort().join('-');
    const existing = matchIndex.get(pairKey);
    if (existing) {
      // Update existing match with additional reason if higher confidence
      if (!existing.matchReasons.includes(reason)) {
        existing.matchReasons.push(reason);
      }
      existing.confidence = Math.max(existing.confidence, confidence);
      return;
    }

    const companyA = companies.find((c) => c.id === idA)!;
    const companyB = companies.find((c) => c.id === idB)!;

    const match: FindDuplicateCompaniesOutput['duplicates'][0] = {
      recordA: {
        id: idA,
        name: companyA.name || '',
        domain: companyA.domain || '',
        phone: companyA.phone || '',
      },
      recordB: {
        id: idB,
        name: companyB.name || '',
        domain: companyB.domain || '',
        phone: companyB.phone || '',
      },
      confidence,
      matchReasons: [reason],
    };
    duplicates.push(match);
    matchIndex.set(pairKey, match);
  };

  // 1. Exact domain match (90% confidence)
  for (const [, ids] of domainIndex) {
    if (ids.length > 1) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          addMatch(ids[i], ids[j], 90, 'exact_domain');
        }
      }
    }
  }

  // 2. Normalized name match (80% confidence)
  for (const [, ids] of normalizedNameIndex) {
    if (ids.length > 1) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          addMatch(ids[i], ids[j], 80, 'normalized_name');
        }
      }
    }
  }

  // 3. Phone number match (70% confidence)
  for (const [, ids] of phoneIndex) {
    if (ids.length > 1) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          addMatch(ids[i], ids[j], 70, 'phone_match');
        }
      }
    }
  }

  // 4. Fuzzy name similarity (60% confidence) - only check if not already matched
  // Require minimum 8 chars to reduce false positives (e.g., "Acxiom" vs "Hexion")
  const normalizedNames = Array.from(normalizedNameIndex.keys());
  for (let i = 0; i < normalizedNames.length; i++) {
    for (let j = i + 1; j < normalizedNames.length; j++) {
      const nameA = normalizedNames[i];
      const nameB = normalizedNames[j];

      // Skip short names - too many false positives with Levenshtein distance 3
      if (nameA.length < 8 || nameB.length < 8) continue;

      // Skip if names are too different in length
      if (Math.abs(nameA.length - nameB.length) > 5) continue;

      const distance = levenshtein(nameA, nameB);
      if (distance <= 3 && distance > 0) {
        // Similar but not identical
        const idsA = normalizedNameIndex.get(nameA)!;
        const idsB = normalizedNameIndex.get(nameB)!;
        for (const idA of idsA) {
          for (const idB of idsB) {
            addMatch(idA, idB, 60, 'fuzzy_name');
          }
        }
      }
    }
  }

  // Filter by threshold and sort by confidence
  const filtered = duplicates
    .filter((d) => d.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence);

  return {
    duplicates: filtered,
    totalRecordsScanned: companies.length,
    matchesFound: filtered.length,
  };
}

/**
 * Find potential duplicate contacts using multiple heuristics.
 * Scans contacts and identifies pairs that may be duplicates based on:
 * - Exact email match (95% confidence)
 * - Name + company match (85% confidence)
 * - Phone number match (75% confidence)
 * - Fuzzy name + same email domain (65% confidence)
 *
 * IMPORTANT: Always confirm with user which record should be primary before merging.
 */
export async function findDuplicateContacts(
  opts: FindDuplicateContactsInput,
): Promise<FindDuplicateContactsOutput> {
  const threshold = opts.threshold ?? 60;
  const maxRecords = opts.maxRecords ?? 500;

  type ContactRecord = { id: string; [key: string]: string };

  // Fetch contacts in batches
  const contacts: ContactRecord[] = [];
  let offset = 0;
  const batchSize = 100;

  while (contacts.length < maxRecords) {
    const result = await queryCrm({
      csrf: opts.csrf,
      portalId: opts.portalId,
      objectType: 'contacts',
      properties: [
        'email',
        'firstname',
        'lastname',
        'phone',
        'associatedcompanyid',
      ],
      count: batchSize,
      offset,
      filterGroupsOperator: 'AND',
    });

    contacts.push(...(result.results as ContactRecord[]));

    if (result.results.length < batchSize || contacts.length >= result.total) {
      break;
    }
    offset += batchSize;
  }

  // Build lookup indexes
  const emailIndex = new Map<string, string[]>();
  const phoneIndex = new Map<string, string[]>();
  const nameCompanyIndex = new Map<string, string[]>();
  const emailDomainIndex = new Map<string, string[]>();

  for (const contact of contacts) {
    const id = contact.id;

    // Email index
    if (contact.email) {
      const email = contact.email.toLowerCase().trim();
      if (!emailIndex.has(email)) emailIndex.set(email, []);
      emailIndex.get(email)!.push(id);

      // Email domain index
      const domain = email.split('@')[1];
      if (domain) {
        if (!emailDomainIndex.has(domain)) emailDomainIndex.set(domain, []);
        emailDomainIndex.get(domain)!.push(id);
      }
    }

    // Phone index
    if (contact.phone) {
      const phone = normalizePhone(contact.phone);
      if (phone.length >= 7) {
        if (!phoneIndex.has(phone)) phoneIndex.set(phone, []);
        phoneIndex.get(phone)!.push(id);
      }
    }

    // Name + company index
    const firstName = (contact.firstname || '').toLowerCase().trim();
    const lastName = (contact.lastname || '').toLowerCase().trim();
    const companyId = contact.associatedcompanyid || '';
    if (firstName && lastName && companyId) {
      const key = `${firstName}|${lastName}|${companyId}`;
      if (!nameCompanyIndex.has(key)) nameCompanyIndex.set(key, []);
      nameCompanyIndex.get(key)!.push(id);
    }
  }

  // Find duplicates - use Map for O(1) lookups instead of O(n) array searches
  const duplicates: FindDuplicateContactsOutput['duplicates'] = [];
  const matchIndex = new Map<
    string,
    FindDuplicateContactsOutput['duplicates'][0]
  >();

  const getContactName = (contact: Record<string, string>) => {
    const parts = [contact.firstname, contact.lastname].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : contact.email || 'Unknown';
  };

  const addMatch = (
    idA: string,
    idB: string,
    confidence: number,
    reason: string,
  ) => {
    const pairKey = [idA, idB].sort().join('-');
    const existing = matchIndex.get(pairKey);
    if (existing) {
      if (!existing.matchReasons.includes(reason)) {
        existing.matchReasons.push(reason);
      }
      existing.confidence = Math.max(existing.confidence, confidence);
      return;
    }

    const contactA = contacts.find((c) => c.id === idA)!;
    const contactB = contacts.find((c) => c.id === idB)!;

    const match: FindDuplicateContactsOutput['duplicates'][0] = {
      recordA: {
        id: idA,
        name: getContactName(contactA),
        email: contactA.email || '',
        phone: contactA.phone || '',
      },
      recordB: {
        id: idB,
        name: getContactName(contactB),
        email: contactB.email || '',
        phone: contactB.phone || '',
      },
      confidence,
      matchReasons: [reason],
    };
    duplicates.push(match);
    matchIndex.set(pairKey, match);
  };

  // 1. Exact email match (95% confidence)
  for (const [, ids] of emailIndex) {
    if (ids.length > 1) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          addMatch(ids[i], ids[j], 95, 'exact_email');
        }
      }
    }
  }

  // 2. Name + company match (85% confidence)
  for (const [, ids] of nameCompanyIndex) {
    if (ids.length > 1) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          addMatch(ids[i], ids[j], 85, 'name_company');
        }
      }
    }
  }

  // 3. Phone number match (75% confidence)
  for (const [, ids] of phoneIndex) {
    if (ids.length > 1) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          addMatch(ids[i], ids[j], 75, 'phone_match');
        }
      }
    }
  }

  // 4. Fuzzy name + same email domain (65% confidence)
  const commonEmailDomains = new Set([
    'gmail.com',
    'yahoo.com',
    'hotmail.com',
    'outlook.com',
    'aol.com',
    'icloud.com',
    'live.com',
    'msn.com',
    'protonmail.com',
    'me.com',
    'mail.com',
    'ymail.com',
  ]);
  for (const [domain, ids] of emailDomainIndex) {
    // Skip common personal email domains
    if (commonEmailDomains.has(domain)) {
      continue;
    }

    if (ids.length > 1) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const contactA = contacts.find((c) => c.id === ids[i])!;
          const contactB = contacts.find((c) => c.id === ids[j])!;

          const nameA = `${contactA.firstname || ''} ${contactA.lastname || ''}`
            .toLowerCase()
            .trim();
          const nameB = `${contactB.firstname || ''} ${contactB.lastname || ''}`
            .toLowerCase()
            .trim();

          if (nameA && nameB && nameA !== nameB) {
            const distance = levenshtein(nameA, nameB);
            if (distance <= 3) {
              addMatch(ids[i], ids[j], 65, 'fuzzy_name_same_domain');
            }
          }
        }
      }
    }
  }

  // Filter by threshold and sort by confidence
  const filtered = duplicates
    .filter((d) => d.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence);

  return {
    duplicates: filtered,
    totalRecordsScanned: contacts.length,
    matchesFound: filtered.length,
  };
}
