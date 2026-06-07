import { attioFetch, listAllEntityIds } from '../helpers';
import { NotFound, Validation, ContractDrift } from '@vallum/_runtime';
import type {
  ListPeopleOutput,
  GetPersonOutput,
  CreatePersonOutput,
  UpdatePersonOutput,
  DeletePersonOutput,
} from './schemas';

export async function listPeople(opts: {
  slug: string;
  peopleEntityDefId: string;
  limit?: number;
}): Promise<ListPeopleOutput> {
  const limit = opts.limit ?? 100;

  const { total, ids } = await listAllEntityIds(
    opts.slug,
    opts.peopleEntityDefId,
    limit,
  );

  if (ids.length === 0) {
    return { total, people: [] };
  }

  const people = await attioFetch<GetPersonOutput[]>(
    `/api/common/workspaces/${opts.slug}/people?person_ids=${encodeURIComponent(ids.join(','))}`,
  );

  return {
    total,
    people: Array.isArray(people) ? people : [],
  };
}

export async function getPerson(opts: {
  slug: string;
  personId: string;
}): Promise<GetPersonOutput> {
  const people = await attioFetch<GetPersonOutput[]>(
    `/api/common/workspaces/${opts.slug}/people?person_ids=${encodeURIComponent(opts.personId)}`,
  );

  if (!Array.isArray(people) || people.length === 0) {
    throw new NotFound(`Person not found: ${opts.personId}`);
  }

  return people[0];
}

export async function createPerson(opts: {
  slug: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  emailAddress?: string;
}): Promise<CreatePersonOutput> {
  if (!opts.name && !opts.firstName && !opts.lastName) {
    throw new Validation(
      'At least one of name, firstName, or lastName is required to create a person',
    );
  }

  const body: Record<string, unknown> = {};
  if (opts.name) {
    body.name = opts.name;
  } else {
    const parts = [opts.firstName, opts.lastName].filter(Boolean);
    if (parts.length > 0) body.name = parts.join(' ');
    if (opts.firstName) body.first_name = opts.firstName;
    if (opts.lastName) body.last_name = opts.lastName;
  }
  if (opts.emailAddress) {
    body.email_addresses = [{ email_address: opts.emailAddress }];
  }

  const person = await attioFetch<CreatePersonOutput>(
    `/api/common/workspaces/${opts.slug}/people`,
    { method: 'POST', body: JSON.stringify(body) },
  );

  if (!person?.id) {
    throw new ContractDrift(
      `Unexpected person creation response: ${JSON.stringify(person)}`,
    );
  }

  return person;
}

export async function updatePerson(opts: {
  slug: string;
  personId: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  emailAddress?: string;
  phoneNumber?: string;
}): Promise<UpdatePersonOutput> {
  const body: Record<string, unknown> = {};
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.firstName !== undefined) body.first_name = opts.firstName;
  if (opts.lastName !== undefined) body.last_name = opts.lastName;
  if (opts.emailAddress !== undefined) {
    body.email_addresses = [{ email_address: opts.emailAddress }];
  }
  if (opts.phoneNumber !== undefined) {
    body.phone_numbers = [{ phone_number: opts.phoneNumber }];
  }

  if (Object.keys(body).length === 0) {
    throw new Validation('At least one field must be provided to update a person');
  }

  const person = await attioFetch<UpdatePersonOutput>(
    `/api/common/workspaces/${opts.slug}/people/${opts.personId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );

  if (!person?.id) {
    throw new ContractDrift(
      `Unexpected person update response: ${JSON.stringify(person)}`,
    );
  }

  return person;
}

export async function deletePerson(opts: {
  slug: string;
  personId: string;
}): Promise<DeletePersonOutput> {
  await attioFetch<undefined>(
    `/api/common/workspaces/${opts.slug}/people/${opts.personId}`,
    { method: 'DELETE' },
  );

  return { success: true };
}
