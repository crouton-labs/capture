import { z } from 'zod';

export const libraryDescription = 'Public SmartRecruiters job-board reads for company careers pages and posting detail pages.';
export const libraryIcon = '/icons/libs/smartrecruiters.png';
export const loginUrl = 'https://careers.smartrecruiters.com';
export const libraryVisibility = 'public' as const;

export const libraryNotes = `
## Workflow

SmartRecruiters is read-only and public. Pass the exact companyIdentifier slug from the careers URL into listPostings/getPosting.

1. Use the exact companyIdentifier from the public careers page; do not lowercase it.
2. Use listPostings for public board search, filters, and paging.
3. Use getPosting for one posting's full detail, URLs, jobAd sections, and active flag.

## Key Concepts

- companyIdentifier is the slug in \`https://careers.smartrecruiters.com/{companyIdentifier}\`.
- listPostings defaults to limit=100 and caps limit at 100.
- Supported filters are q, country, region, city, department (ID), jobAdId, releasedAfter, locationType, language, and custom_field.{customFieldId}.
- locationType filter values are \`REMOTE\`, \`HYBRID\`, \`ONSITE\`, and \`ANY\`.
- department filters use the department ID, not the label.
- live location.country values are lowercase ISO-style codes in observed responses.
- customField[].valueId can be null.
- detail reads accept either the posting id or uuid.
`.trim();

export const CompanyIdentifierParam = z
  .string()
  .min(1)
  .describe('SmartRecruiters company identifier from the public careers URL, such as smartrecruiters or Visa.');

export const PostingIdParam = z
  .string()
  .min(1)
  .describe('SmartRecruiters posting identifier or uuid from listPostings or a public detail URL.');

export const QueryParam = z.string().min(1).describe('Full-text query string matching job title or location.');

export const LimitParam = z
  .number()
  .int()
  .positive()
  .max(100)
  .default(100)
  .describe('Maximum number of postings to return. SmartRecruiters caps this at 100.');

export const OffsetParam = z
  .number()
  .int()
  .nonnegative()
  .default(0)
  .describe('Zero-based offset into the public posting list.');

export const CountryParam = z
  .string()
  .min(1)
  .describe('Country filter value copied from location.country in SmartRecruiters responses, usually a lowercase ISO-style code.');

export const RegionParam = z
  .string()
  .min(1)
  .describe('Region filter value copied from location.region in SmartRecruiters responses.');

export const CityParam = z
  .string()
  .min(1)
  .describe('City filter value copied from location.city in SmartRecruiters responses.');

export const DepartmentParam = z
  .union([z.string().min(1), z.number()])
  .describe('Department filter value. Use the department id, not the department label.');

export const JobAdIdParam = z
  .string()
  .min(1)
  .describe('Job ad id filter value from the posting response.');

export const ReleasedAfterParam = z
  .string()
  .min(1)
  .describe('ISO 8601 timestamp for releasedAfter, for example 2026-06-01T00:00:00.000Z.');

export const LocationTypeFilterSchema = z
  .enum(['REMOTE', 'HYBRID', 'ONSITE', 'ANY'])
  .describe('Location type filter. Values: REMOTE, HYBRID, ONSITE, ANY.');

export const LanguageParam = z
  .union([z.string().min(1), z.array(z.string().min(1))])
  .describe('Job ad language code or codes. Multiple values are serialized as a comma-separated list.');

export const CustomFieldFilterValueParam = z
  .union([z.string().min(1), z.array(z.string().min(1))])
  .describe('Custom field value id or ids. Multiple values are serialized as a comma-separated list.');

export const SmartRecruitersCompanySchema = z
  .object({
    identifier: z.string().describe('SmartRecruiters company identifier. This is the exact public slug, including case.'),
    name: z.string().describe('Public company name shown by SmartRecruiters.'),
  })
  .describe('Public SmartRecruiters company reference.');

export const SmartRecruitersLabelSchema = z
  .object({
    id: z.union([z.string(), z.number()]).describe('SmartRecruiters identifier for this label object.'),
    label: z.string().describe('Human-readable label for this classification.'),
  })
  .passthrough()
  .describe('SmartRecruiters classification object. Known properties: id, label.');

export const SmartRecruitersLanguageSchema = z
  .object({
    code: z.string().describe('Language code returned by SmartRecruiters.'),
    label: z.string().describe('Human-readable language label.'),
    labelNative: z.string().describe('Native-language label for the job ad language.'),
  })
  .passthrough()
  .describe('SmartRecruiters language classification object. Known properties: code, label, labelNative.');

export const SmartRecruitersLocationSchema = z
  .object({
    city: z.string().nullable().describe('City component of the public location, when present.'),
    region: z.string().nullable().describe('Region or state component of the public location, when present.'),
    country: z.string().nullable().describe('Country component of the public location. Live responses usually use a lowercase code.'),
    remote: z.boolean().nullable().describe('Whether the posting is marked remote, when SmartRecruiters returns the flag.'),
    hybrid: z.boolean().nullable().describe('Whether the posting is marked hybrid, when SmartRecruiters returns the flag.'),
    latitude: z.string().nullable().describe('Latitude string, when SmartRecruiters returns coordinates.'),
    longitude: z.string().nullable().describe('Longitude string, when SmartRecruiters returns coordinates.'),
    fullLocation: z.string().nullable().describe('Full location display string shown publicly, when present.'),
  })
  .describe('Public SmartRecruiters location object.');

export const SmartRecruitersCustomFieldSchema = z
  .object({
    fieldId: z.string().describe('Custom field identifier used in custom_field.{fieldId} filters.'),
    fieldLabel: z.string().describe('Custom field label shown publicly.'),
    valueId: z.string().nullable().describe('Selected custom field value id, which can be null.'),
    valueLabel: z.string().nullable().describe('Selected custom field value label, when SmartRecruiters returns one.'),
  })
  .passthrough()
  .describe('SmartRecruiters custom field entry attached to a posting.');

export type SmartRecruitersCustomField = z.infer<typeof SmartRecruitersCustomFieldSchema>;

export const SmartRecruitersSectionSchema = z
  .object({
    title: z.string().describe('Job ad section title.'),
    text: z.string().describe('Job ad section HTML content.'),
  })
  .passthrough()
  .describe('SmartRecruiters job ad section.');

export const SmartRecruitersVideoSectionSchema = z
  .object({
    title: z.string().describe('Video section title.'),
    urls: z.array(z.string().url()).describe('Video URLs contained in this section.'),
  })
  .passthrough()
  .describe('SmartRecruiters video section within a job ad.');

export const SmartRecruitersJobAdSectionsSchema = z
  .object({
    companyDescription: SmartRecruitersSectionSchema.nullable().describe('Company description section, or null when absent.'),
    jobDescription: SmartRecruitersSectionSchema.nullable().describe('Job description section, or null when absent.'),
    qualifications: SmartRecruitersSectionSchema.nullable().describe('Qualifications section, or null when absent.'),
    additionalInformation: SmartRecruitersSectionSchema.nullable().describe('Additional information section, or null when absent.'),
    videos: z.array(SmartRecruitersVideoSectionSchema).describe('Video sections attached to the job ad, or an empty array when absent.'),
  })
  .passthrough()
  .describe('SmartRecruiters job ad sections normalized for agent use.');

export const SmartRecruitersJobAdSchema = z
  .object({
    sections: SmartRecruitersJobAdSectionsSchema.describe('Normalized job ad sections returned by SmartRecruiters.'),
  })
  .passthrough()
  .describe('SmartRecruiters job ad content.');

export const SmartRecruitersCreatorSchema = z
  .object({
    name: z.string().nullable().describe('Creator name, when SmartRecruiters exposes it.'),
    avatarUrl: z.string().nullable().describe('Creator avatar URL, when SmartRecruiters exposes it.'),
  })
  .passthrough()
  .describe('SmartRecruiters posting creator summary.');

export const SmartRecruitersPostingSummarySchema = z
  .object({
    id: z.string().describe('SmartRecruiters posting id.'),
    uuid: z.string().describe('SmartRecruiters posting uuid.'),
    title: z.string().describe('Posting title, normalized from the SmartRecruiters name field.'),
    jobAdId: z.string().describe('SmartRecruiters job ad id for this posting.'),
    defaultJobAd: z.boolean().describe('Whether this posting is the default job ad.'),
    refNumber: z.string().describe('Public SmartRecruiters reference number.'),
    company: SmartRecruitersCompanySchema.describe('Company associated with the posting.'),
    releasedDate: z.string().describe('Posting release timestamp in ISO 8601 format.'),
    location: SmartRecruitersLocationSchema.describe('Public location object for the posting.'),
    industry: SmartRecruitersLabelSchema.nullable().describe('Industry classification, or null when absent.'),
    department: SmartRecruitersLabelSchema.nullable().describe('Department classification, or null when absent.'),
    function: SmartRecruitersLabelSchema.nullable().describe('Function classification, or null when absent.'),
    typeOfEmployment: SmartRecruitersLabelSchema.nullable().describe('Type of employment classification, or null when absent.'),
    experienceLevel: SmartRecruitersLabelSchema.nullable().describe('Experience level classification, or null when absent.'),
    customFields: z.array(SmartRecruitersCustomFieldSchema).describe('Custom fields attached to the posting, or an empty array when none are returned.'),
    visibility: z.literal('PUBLIC').describe('Posting visibility returned by SmartRecruiters. Public library output only.'),
    detailUrl: z.string().url().describe('SmartRecruiters API detail URL returned in the ref field.'),
    language: SmartRecruitersLanguageSchema.nullable().describe('Job ad language classification, or null when absent.'),
  })
  .passthrough()
  .describe('Normalized SmartRecruiters posting summary.');

export const SmartRecruitersPostingDetailSchema = SmartRecruitersPostingSummarySchema.extend({
  jobId: z.string().describe('SmartRecruiters job id associated with the posting.'),
  postingUrl: z.string().url().describe('Public posting page URL.'),
  applyUrl: z.string().url().describe('Public application URL.'),
  referralUrl: z.string().url().describe('Public referral URL.'),
  creator: SmartRecruitersCreatorSchema.describe('Posting creator summary returned by SmartRecruiters.'),
  jobAd: SmartRecruitersJobAdSchema.nullable().describe('Normalized job ad content, or null when SmartRecruiters omits it.'),
  active: z.boolean().describe('Whether the posting is active and live.'),
});

export const SmartRecruitersFiltersAppliedSchema = z
  .object({
    q: z.string().nullable().describe('Full-text search query sent to SmartRecruiters, or null when omitted.'),
    limit: z.number().int().positive().max(100).describe('Effective limit sent to SmartRecruiters.'),
    offset: z.number().int().nonnegative().describe('Effective offset sent to SmartRecruiters.'),
    country: z.string().nullable().describe('Country filter sent to SmartRecruiters, or null when omitted.'),
    region: z.string().nullable().describe('Region filter sent to SmartRecruiters, or null when omitted.'),
    city: z.string().nullable().describe('City filter sent to SmartRecruiters, or null when omitted.'),
    department: z.string().nullable().describe('Department id filter sent to SmartRecruiters, or null when omitted.'),
    jobAdId: z.string().nullable().describe('Job ad id filter sent to SmartRecruiters, or null when omitted.'),
    releasedAfter: z.string().nullable().describe('Released-after filter sent to SmartRecruiters, or null when omitted.'),
    locationType: LocationTypeFilterSchema.nullable().describe('Location type filter sent to SmartRecruiters, or null when omitted.'),
    language: z.array(z.string()).describe('Language filters sent to SmartRecruiters as a comma-separated list.'),
    custom_field: z.record(z.string(), z.array(z.string())).describe('Custom field filters sent to SmartRecruiters, keyed by custom field id.'),
  })
  .describe('SmartRecruiters filters applied to the request.');

export const listPostingsSchema = {
  name: 'listPostings',
  description: 'List public SmartRecruiters postings for one companyIdentifier with pagination and supported public filters.',
  notes: 'Use the exact companyIdentifier from the public careers URL. Filters are q, country, region, city, department id, jobAdId, releasedAfter, locationType, language, and custom_field.{customFieldId}. Department filters use ids, not labels. locationType accepts REMOTE, HYBRID, ONSITE, or ANY. Language and custom field filters may be comma-separated lists.',
  input: z.object({
    companyIdentifier: CompanyIdentifierParam,
    q: QueryParam.optional().describe('Full-text search query for SmartRecruiters job title or location.'),
    limit: LimitParam.optional().describe('Maximum number of postings to return. SmartRecruiters caps this at 100.'),
    offset: OffsetParam.optional().describe('Zero-based offset into the public posting list.'),
    country: CountryParam.optional().describe('Country filter value copied from location.country.'),
    region: RegionParam.optional().describe('Region filter value copied from location.region.'),
    city: CityParam.optional().describe('City filter value copied from location.city.'),
    department: DepartmentParam.optional().describe('Department id filter. Use the id from the posting, not the label.'),
    jobAdId: JobAdIdParam.optional().describe('Job ad id filter value from the posting response.'),
    releasedAfter: ReleasedAfterParam.optional().describe('ISO 8601 timestamp for releasedAfter.'),
    locationType: LocationTypeFilterSchema.optional().describe('Location type filter. Values: REMOTE, HYBRID, ONSITE, ANY.'),
    language: LanguageParam.optional().describe('Job ad language code or codes. Multiple values are serialized as a comma-separated list.'),
    custom_field: z.record(z.string().min(1), CustomFieldFilterValueParam).optional().describe('Custom field filters keyed by custom field id. Serialize each key as custom_field.{customFieldId}.'),
  }),
  output: z.object({
    careersUrl: z.string().url().describe('Public SmartRecruiters careers page URL for this companyIdentifier.'),
    companyIdentifier: z.string().describe('SmartRecruiters company identifier echoed from the request and response.'),
    companyName: z.string().nullable().describe('Public company name returned by SmartRecruiters, or null when no postings are returned.'),
    filtersApplied: SmartRecruitersFiltersAppliedSchema.describe('Filters that were sent to SmartRecruiters.'),
    paging: z.object({
      offset: z.number().int().nonnegative().describe('Offset returned by SmartRecruiters.'),
      limit: z.number().int().positive().max(100).describe('Limit returned by SmartRecruiters.'),
      returned: z.number().int().nonnegative().describe('Number of postings returned on this page.'),
      totalFound: z.number().int().nonnegative().describe('Total number of postings matching the query.'),
      hasMore: z.boolean().describe('Whether another page exists after this one.'),
      nextOffset: z.number().int().nonnegative().nullable().describe('Offset for the next page, or null when the result set ends here.'),
    }).describe('Paging metadata for the returned list.'),
    postings: z.array(SmartRecruitersPostingSummarySchema).describe('Normalized public postings returned by the list request.'),
  }),
};

export type ListPostingsInput = z.infer<typeof listPostingsSchema.input>;
export type ListPostingsOutput = z.infer<typeof listPostingsSchema.output>;
export type SmartRecruitersPostingSummary = z.infer<typeof SmartRecruitersPostingSummarySchema>;
export type SmartRecruitersPostingDetail = z.infer<typeof SmartRecruitersPostingDetailSchema>;

export const getPostingSchema = {
  name: 'getPosting',
  description: 'Get one public SmartRecruiters posting by companyIdentifier and posting id or uuid.',
  notes: 'Use the exact companyIdentifier from the public careers URL. postingId accepts either the public posting id or uuid returned by listPostings. The returned posting includes postingUrl, applyUrl, referralUrl, jobAd sections, creator, and the active flag.',
  input: z.object({
    companyIdentifier: CompanyIdentifierParam,
    postingId: PostingIdParam,
  }),
  output: z.object({
    careersUrl: z.string().url().describe('Public SmartRecruiters careers page URL for this companyIdentifier.'),
    companyIdentifier: z.string().describe('SmartRecruiters company identifier echoed from the request and response.'),
    companyName: z.string().describe('Public company name returned by SmartRecruiters.'),
    posting: SmartRecruitersPostingDetailSchema.describe('Normalized public posting detail.'),
  }),
};

export type GetPostingInput = z.infer<typeof getPostingSchema.input>;
export type GetPostingOutput = z.infer<typeof getPostingSchema.output>;

export const allSchemas = [listPostingsSchema, getPostingSchema];
