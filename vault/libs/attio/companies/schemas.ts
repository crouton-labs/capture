import { z } from 'zod';

const SlugParam = z.string().describe('Workspace slug from getContext()');

export const CompanyLocationSchema = z.object({
  city: z.string().nullable().optional().describe('City'),
  state: z.string().nullable().optional().describe('State or province'),
  country_code: z.string().nullable().optional().describe('ISO country code'),
});

export const CompanySocialMediaSchema = z.object({
  twitter: z.string().nullable().optional().describe('Twitter handle or URL'),
  linkedin: z.string().nullable().optional().describe('LinkedIn URL'),
  facebook: z.string().nullable().optional().describe('Facebook URL'),
  angellist: z.string().nullable().optional().describe('AngelList URL'),
  instagram: z
    .string()
    .nullable()
    .optional()
    .describe('Instagram handle or URL'),
});

export const CompanyCommunicationIntelligenceSchema = z.object({
  last_contacted_at: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp of last contact'),
});

export const CompanySchema = z.object({
  id: z.string().describe('Company UUID'),
  name: z.string().nullable().optional().describe('Company name'),
  description: z.string().nullable().optional().describe('Company description'),
  domains: z.array(z.string()).optional().describe('Domain names'),
  foundation_date: z
    .string()
    .nullable()
    .optional()
    .describe('Founding date (YYYY-MM-DD)'),
  employee_range: z
    .string()
    .nullable()
    .optional()
    .describe('Employee count range (e.g. 11-50)'),
  estimated_arr_usd: z
    .number()
    .nullable()
    .optional()
    .describe('Estimated ARR in USD'),
  categories: z.array(z.string()).optional().describe('Industry/category tags'),
  primary_location: CompanyLocationSchema.nullable()
    .optional()
    .describe('Primary office location'),
  social_media: CompanySocialMediaSchema.nullable()
    .optional()
    .describe('Social media profiles'),
  communication_intelligence: CompanyCommunicationIntelligenceSchema.nullable()
    .optional()
    .describe('Last contact information'),
});

export const listCompaniesSchema = {
  name: 'listCompanies',
  description:
    'List all company records in the workspace with full profile details',
  notes:
    'Requires getContext() first to obtain companyEntityDefId. Look up entityDefinitions where slug === "companies".',
  input: z.object({
    slug: SlugParam,
    companyEntityDefId: z
      .string()
      .describe(
        'Company entity definition UUID from getContext() entityDefinitions (slug === "companies")',
      ),
    limit: z
      .number()
      .optional()
      .default(100)
      .describe('Max companies to return (default: 100)'),
  }),
  output: z.object({
    total: z.number().describe('Total company count in workspace'),
    companies: z.array(CompanySchema).describe('Company records'),
  }),
};

export const getCompanySchema = {
  name: 'getCompany',
  description: 'Get full profile details for a single company record by UUID',
  notes: 'Obtain companyId from listCompanies() or searchRecords().',
  input: z.object({
    slug: SlugParam,
    companyId: z.string().describe('Company UUID'),
  }),
  output: CompanySchema,
};

export const createCompanySchema = {
  name: 'createCompany',
  description: 'Create a new company record in the workspace',
  notes: 'Requires at least one of name or domain.',
  input: z.object({
    slug: SlugParam,
    name: z.string().optional().describe('Company name'),
    domain: z
      .string()
      .optional()
      .describe(
        'Primary domain (e.g. acme.com). Required if name is not provided.',
      ),
  }),
  output: CompanySchema,
};

export const updateCompanySchema = {
  name: 'updateCompany',
  description: 'Update one or more attributes on an existing company record',
  notes: 'Obtain companyId from listCompanies() or searchRecords().',
  input: z.object({
    slug: SlugParam,
    companyId: z.string().describe('Company UUID to update'),
    name: z.string().optional().describe('New company name'),
    domain: z.string().optional().describe('New primary domain'),
    description: z.string().optional().describe('New company description'),
  }),
  output: CompanySchema,
};

export const deleteCompanySchema = {
  name: 'deleteCompany',
  description: 'Permanently delete a company record by UUID',
  notes:
    'Obtain companyId from listCompanies() or searchRecords(). This operation is irreversible.',
  input: z.object({
    slug: SlugParam,
    companyId: z.string().describe('Company UUID to delete'),
  }),
  output: z.object({
    deleted: z
      .boolean()
      .describe('True when the company was successfully deleted'),
  }),
};

export type Company = z.infer<typeof CompanySchema>;
export type ListCompaniesOutput = z.infer<typeof listCompaniesSchema.output>;
export type GetCompanyOutput = z.infer<typeof getCompanySchema.output>;
export type CreateCompanyOutput = z.infer<typeof createCompanySchema.output>;
export type UpdateCompanyOutput = z.infer<typeof updateCompanySchema.output>;
export type DeleteCompanyOutput = z.infer<typeof deleteCompanySchema.output>;
