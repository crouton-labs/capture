/**
 * Filter option extraction for Clay search
 *
 * All filter options (industries, countries, cities, states) are embedded
 * client-side in Clay's React app on the Find People wizard page.
 * These functions extract the canonical lists from the React fiber tree.
 */

import { Validation, ContractDrift } from '@vallum/_runtime';
import type {
  GetIndustriesOutput,
  GetCountriesOutput,
  GetCitiesOutput,
  GetStatesOutput,
  GetFilterOptionsOutput,
} from './schemas';

/**
 * Helper: walk React fiber tree from a DOM element to find an array prop
 */
function findFiberArrayProp(
  element: Element,
  propKey: string,
  minLength: number = 5,
): unknown[] | null {
  const fiberKey = Object.keys(element).find((k) =>
    k.startsWith('__reactFiber$'),
  );
  if (!fiberKey) return null;

  let current = (element as unknown as Record<string, unknown>)[fiberKey] as {
    memoizedProps?: Record<string, unknown>;
    return?: unknown;
  } | null;
  let depth = 0;

  while (current && depth < 80) {
    if (current.memoizedProps) {
      const val = current.memoizedProps[propKey];
      if (Array.isArray(val) && val.length >= minLength) {
        return val;
      }
    }
    current = current.return as typeof current;
    depth++;
  }
  return null;
}

/**
 * Helper: expand a filter section and open a combobox to populate the dropdown DOM
 */
async function openFilterDropdown(
  sectionName: string,
  comboboxLabel: string,
): Promise<Element | null> {
  // Collapse all sections first
  const allSections = [
    'Company attributes',
    'Job title',
    'Experience',
    'Location',
    'Profile',
    'Certifications',
    'Languages',
    'Education',
    'Companies',
  ];
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const name of allSections) {
    const btn = buttons.find((b) => b.textContent?.trim() === name);
    if (btn && btn.getAttribute('aria-expanded') === 'true') btn.click();
  }
  await new Promise((r) => setTimeout(r, 200));

  // Expand target section
  const sectionBtn = buttons.find((b) => b.textContent?.trim() === sectionName);
  if (!sectionBtn)
    throw new ContractDrift(`Section "${sectionName}" not found on page`);
  if (sectionBtn.getAttribute('aria-expanded') !== 'true') sectionBtn.click();
  await new Promise((r) => setTimeout(r, 300));

  // Focus the combobox to open dropdown
  const input = document.querySelector(
    `input[aria-label="${comboboxLabel}"]`,
  ) as HTMLInputElement | null;
  if (!input) throw new ContractDrift(`Combobox "${comboboxLabel}" not found`);
  input.click();
  input.focus();
  await new Promise((r) => setTimeout(r, 500));

  // Get the listbox element
  const controlsId = input.getAttribute('aria-controls');
  if (!controlsId) throw new ContractDrift(`Combobox "${comboboxLabel}" did not open`);
  const listbox = document.getElementById(controlsId);
  if (!listbox) throw new ContractDrift(`Listbox ${controlsId} not found in DOM`);

  return listbox;
}

/**
 * Helper: verify we're on the Find People wizard page
 */
function assertOnFindPeoplePage(): void {
  const url = window.location.href;
  if (!url.includes('app.clay.com')) {
    throw new Validation('Must be on app.clay.com. Current URL: ' + url);
  }
  if (!url.includes('/w/find-and-enrich-people')) {
    throw new Validation(
      'Must be on Find & Enrich People page (/w/find-and-enrich-people). Current URL: ' +
        url,
    );
  }
}

export async function getIndustries(): Promise<GetIndustriesOutput> {
  assertOnFindPeoplePage();
  const listbox = await openFilterDropdown(
    'Company attributes',
    'Industries to include',
  );
  if (!listbox) throw new ContractDrift('Could not open industries dropdown');

  const industries = findFiberArrayProp(listbox, 'industries', 50);
  if (!industries) {
    const options = findFiberArrayProp(listbox, 'options', 50);
    if (!options)
      throw new ContractDrift('Could not find industries data in React fiber tree');
    return {
      industries: (
        options as Array<{ value: string; displayName: string }>
      ).map((i) => i.value),
      count: options.length,
    };
  }

  return {
    industries: (
      industries as Array<{ value: string; displayName: string }>
    ).map((i) => i.value),
    count: industries.length,
  };
}

export async function getCountries(): Promise<GetCountriesOutput> {
  assertOnFindPeoplePage();
  const listbox = await openFilterDropdown('Location', 'Countries to include');
  if (!listbox) throw new ContractDrift('Could not open countries dropdown');

  const countries = findFiberArrayProp(listbox, 'countries', 50);
  if (!countries) {
    const options = findFiberArrayProp(listbox, 'options', 50);
    if (!options)
      throw new ContractDrift('Could not find countries data in React fiber tree');
    return {
      countries: (options as Array<{ value: string; displayName: string }>).map(
        (c) => c.value,
      ),
      count: options.length,
    };
  }

  return {
    countries: (countries as Array<{ value: string; displayName: string }>).map(
      (c) => c.value,
    ),
    count: countries.length,
  };
}

export async function getCities(): Promise<GetCitiesOutput> {
  assertOnFindPeoplePage();
  const listbox = await openFilterDropdown('Location', 'Cities to include');
  if (!listbox) throw new ContractDrift('Could not open cities dropdown');

  const cities = findFiberArrayProp(listbox, 'cities', 50);
  if (!cities) {
    const options = findFiberArrayProp(listbox, 'options', 50);
    if (!options)
      throw new ContractDrift('Could not find cities data in React fiber tree');
    return {
      cities: (options as Array<{ value: string; weight?: number }>).map(
        (c) => ({
          name: c.value,
          isPopular: (c.weight ?? 0) > 0,
        }),
      ),
      count: options.length,
    };
  }

  return {
    cities: (cities as Array<{ value: string; weight?: number }>).map((c) => ({
      name: c.value,
      isPopular: (c.weight ?? 0) > 0,
    })),
    count: cities.length,
  };
}

export async function getStates(): Promise<GetStatesOutput> {
  assertOnFindPeoplePage();
  const listbox = await openFilterDropdown(
    'Location',
    'States, provinces, or municipalities to include',
  );
  if (!listbox) throw new ContractDrift('Could not open states dropdown');

  const states = findFiberArrayProp(listbox, 'states', 50);
  if (!states) {
    const options = findFiberArrayProp(listbox, 'options', 50);
    if (!options)
      throw new ContractDrift('Could not find states data in React fiber tree');
    return {
      states: (options as Array<{ value: string; weight?: number }>).map(
        (s) => ({
          name: s.value,
          isPopular: (s.weight ?? 0) > 0,
        }),
      ),
      count: options.length,
    };
  }

  return {
    states: (states as Array<{ value: string; weight?: number }>).map((s) => ({
      name: s.value,
      isPopular: (s.weight ?? 0) > 0,
    })),
    count: states.length,
  };
}

export async function getFilterOptions(): Promise<GetFilterOptionsOutput> {
  assertOnFindPeoplePage();

  // Get industries + company sizes
  const industriesListbox = await openFilterDropdown(
    'Company attributes',
    'Industries to include',
  );
  if (!industriesListbox) throw new ContractDrift('Could not open industries dropdown');

  const industriesData =
    findFiberArrayProp(industriesListbox, 'industries', 50) ??
    findFiberArrayProp(industriesListbox, 'options', 50);
  if (!industriesData) throw new ContractDrift('Could not find industries data');

  const companySizesData = findFiberArrayProp(
    industriesListbox,
    'companySizes',
    3,
  );

  // Get location data
  const countriesListbox = await openFilterDropdown(
    'Location',
    'Countries to include',
  );
  if (!countriesListbox) throw new ContractDrift('Could not open countries dropdown');

  const countriesData =
    findFiberArrayProp(countriesListbox, 'countries', 50) ??
    findFiberArrayProp(countriesListbox, 'options', 50);
  const citiesData = findFiberArrayProp(countriesListbox, 'cities', 50);
  const statesData = findFiberArrayProp(countriesListbox, 'states', 50);

  return {
    industries: (industriesData as Array<{ value: string }>).map(
      (i) => i.value,
    ),
    countries: countriesData
      ? (countriesData as Array<{ value: string }>).map((c) => c.value)
      : [],
    cities: citiesData
      ? (citiesData as Array<{ value: string }>).map((c) => c.value)
      : [],
    states: statesData
      ? (statesData as Array<{ value: string }>).map((s) => s.value)
      : [],
    companySizes: companySizesData
      ? (companySizesData as Array<{ value: string; displayName: string }>).map(
          (s) => s.displayName,
        )
      : [],
    seniority: [
      'owner',
      'partner',
      'c-suite',
      'vp',
      'director',
      'head',
      'manager',
      'senior',
      'entry',
      'assistant',
      'intern',
      'freelance',
      'certified',
    ],
    regions: ['NAM', 'LATAM', 'EMEA', 'APAC'],
  };
}
