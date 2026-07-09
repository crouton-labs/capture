import { z } from 'zod';

export const libraryDescription =
  'Public, unauthenticated Greenhouse job-board reads over the Greenhouse boards API';

export const libraryIcon = '/icons/libs/greenhouse.png';
export const loginUrl = 'https://job-boards.greenhouse.io';

export const libraryNotes = `
## Workflow

1. Open a public Greenhouse-hosted board or know its board token, such as \`reddit\` from \`https://job-boards.greenhouse.io/reddit\`.
2. Pass \`boardToken\` as the first required identifier on every function. No login, CSRF token, account context, or browser session is required.
3. Use the read functions directly; the API returns public JSON from Greenhouse's boards service.

## Key Concepts

- **Board token**: Company board slug in the Greenhouse URL, for example \`reddit\`, \`stripe\`, or \`figma\`.
- **No authentication**: This library only reads public job-board data. It cannot manage ATS tenants, candidates, applications, or private jobs.
- **No pagination**: Greenhouse returns the full board, jobs, departments, offices, or sections response in one request. There are no \`page\`, \`count\`, \`start\`, or cursor parameters.
- **Job content flag**: Job lists omit the full HTML description unless \`content: true\` is passed. Single job reads always include content.
- **Questions flag**: Single job reads omit application questions unless \`questions: true\` is passed.
- **HTML content**: \`content\` fields are HTML-entity-encoded strings, such as \`&lt;h2&gt;...\`; decode before rendering as HTML if needed.
- **Sections**: Board-builder sections are often empty even when jobs, departments, and offices are populated.
- **Client-side search**: Search fetches the full board with job content and filters in memory by title, location name, and department name because the public API has no server-side filtering.
`;

// ============================================================================
// Shared Params
// ============================================================================

export const BoardTokenParam = z
  .string()
  .min(1)
  .describe('Greenhouse board token/company slug from the public board URL, e.g. "reddit" in https://job-boards.greenhouse.io/reddit');

export const JobIdParam = z
  .number()
  .describe('Numeric Greenhouse job ID from a job object or Greenhouse job URL');

export const DepartmentIdParam = z
  .number()
  .describe('Numeric Greenhouse department ID from listDepartments');

export const OfficeIdParam = z
  .number()
  .describe('Numeric Greenhouse office ID from listOffices');

// ============================================================================
// Entity Schemas
// ============================================================================

export const LocationSchema = z.object({
  name: z.string().describe('Human-readable job location name'),
});

export const DataComplianceSchema = z.object({
  type: z.string().describe('Compliance regime type, commonly gdpr'),
  requires_consent: z.boolean().describe('Whether the job requires basic consent'),
  requires_processing_consent: z
    .boolean()
    .optional()
    .describe('Whether the job requires data processing consent'),
  requires_retention_consent: z
    .boolean()
    .optional()
    .describe('Whether the job requires data retention consent'),
  retention_period: z
    .number()
    .nullable()
    .optional()
    .describe('Retention period in days, or null when not provided'),
  demographic_data_consent_applies: z
    .boolean()
    .optional()
    .describe('Whether demographic data consent applies to this job'),
});

export const MetadataItemSchema = z.object({
  id: z.number().describe('Greenhouse metadata field ID'),
  name: z.string().describe('Metadata field display name'),
  value: z
    .unknown()
    .nullable()
    .describe('Metadata field value; commonly a string, number, boolean, or null depending on value_type'),
  value_type: z.string().describe('Greenhouse metadata value type, such as short_text, date, number, or single_select'),
});

export const EmbeddedDepartmentSchema = z.object({
  id: z.number().describe('Numeric Greenhouse department ID'),
  name: z.string().describe('Department name'),
  child_ids: z.array(z.number()).describe('Child department IDs'),
  parent_id: z.number().nullable().describe('Parent department ID, or null for top-level departments'),
});

export const EmbeddedOfficeSchema = z.object({
  id: z.number().describe('Numeric Greenhouse office ID'),
  name: z.string().describe('Office name'),
  location: z.string().nullable().describe('Office location string, or null when not set'),
  child_ids: z.array(z.number()).describe('Child office IDs'),
  parent_id: z.number().nullable().describe('Parent office ID, or null for top-level offices'),
});

export const GreenhouseJobSchema = z.object({
  absolute_url: z.string().describe('Public URL for the Greenhouse job posting'),
  data_compliance: z.array(DataComplianceSchema).describe('Compliance settings attached to this job'),
  internal_job_id: z.number().describe('Internal Greenhouse job ID'),
  location: LocationSchema.describe('Primary job location'),
  metadata: z
    .array(MetadataItemSchema)
    .nullable()
    .describe('Configured public metadata fields for this job, or null when none are exposed'),
  id: z.number().describe('Public Greenhouse job ID'),
  updated_at: z.string().describe('Timestamp when the public job was last updated'),
  requisition_id: z.string().nullable().describe('Public requisition ID, or null when absent'),
  title: z.string().describe('Job title'),
  company_name: z.string().describe('Company name shown on the job posting'),
  first_published: z.string().nullable().describe('Timestamp when the job was first published, or null when absent'),
  language: z.string().nullable().describe('Job posting language code, or null when absent'),
  application_deadline: z.string().nullable().describe('Application deadline timestamp/date, or null when absent'),
  content: z
    .string()
    .optional()
    .describe('HTML-entity-encoded job description HTML; present for content=true lists and single job reads'),
  departments: z
    .array(EmbeddedDepartmentSchema)
    .optional()
    .describe('Departments attached to this job; present for content=true lists and single job reads'),
  offices: z
    .array(EmbeddedOfficeSchema)
    .optional()
    .describe('Offices attached to this job; present for content=true lists and single job reads'),
});

export const JobQuestionFieldValueSchema = z.object({
  label: z.string().optional().describe('Displayed choice label when the field value is an option'),
  value: z
    .union([z.string(), z.number(), z.boolean()])
    .optional()
    .describe('Submitted choice value when Greenhouse exposes one'),
}).passthrough();

export const JobQuestionFieldSchema = z.object({
  name: z.string().describe('Application field name expected by Greenhouse'),
  type: z.string().describe('Application field input type, such as input_text, textarea, input_file, or input_hidden'),
  values: z
    .array(JobQuestionFieldValueSchema)
    .describe('Allowed field values/options; empty for free-text and file inputs'),
});

export const JobQuestionSchema = z.object({
  description: z.string().nullable().describe('Question help text or null when absent'),
  label: z.string().describe('Question label shown to applicants'),
  required: z.boolean().describe('Whether the question is required'),
  fields: z.array(JobQuestionFieldSchema).describe('Application fields backing this question'),
});

export const DemographicAnswerOptionSchema = z.object({
  id: z.number().describe('Greenhouse demographic answer option ID'),
  label: z.string().describe('Answer option label'),
  free_form: z.boolean().describe('Whether the option accepts free-form text'),
  decline_to_answer: z.boolean().describe('Whether the option represents declining to answer'),
});

export const DemographicQuestionSchema = z.object({
  id: z.number().describe('Greenhouse demographic question ID'),
  label: z.string().describe('Demographic question label'),
  required: z.boolean().describe('Whether the demographic question is required'),
  type: z.string().describe('Demographic question input type'),
  answer_options: z
    .array(DemographicAnswerOptionSchema)
    .describe('Allowed demographic answer options'),
});

export const DemographicQuestionsSchema = z.object({
  header: z.string().describe('Header shown above demographic questions'),
  description: z.string().describe('HTML description shown above demographic questions'),
  questions: z.array(DemographicQuestionSchema).describe('Demographic questions for the job'),
});

export const PayInputRangeSchema = z.object({
  min_cents: z.number().describe('Minimum pay in cents (e.g. 18900000 = $189,000)'),
  max_cents: z.number().describe('Maximum pay in cents (e.g. 26460000 = $264,600)'),
  currency_type: z.string().describe('ISO currency code, e.g. "USD"'),
  title: z.string().describe('Label for the pay range, e.g. "The base salary range for this position is:"'),
  blurb: z.string().describe('HTML pay-transparency disclosure text'),
});

export const GreenhouseJobWithQuestionsSchema = GreenhouseJobSchema.extend({
  compliance: z
    .unknown()
    .nullable()
    .optional()
    .describe('Application compliance configuration returned when questions=true; often null'),
  demographic_questions: DemographicQuestionsSchema
    .nullable()
    .optional()
    .describe('Demographic question block returned when questions=true, or null when not configured'),
  questions: z
    .array(JobQuestionSchema)
    .optional()
    .describe('Application questions returned when questions=true'),
  location_questions: z
    .array(JobQuestionSchema)
    .optional()
    .describe('Location-related application questions returned when questions=true'),
  pay_input_ranges: z
    .array(PayInputRangeSchema)
    .optional()
    .describe('Structured pay ranges returned when pay_transparency=true; empty array when the job has no pay data'),
});

export const DepartmentChildSchema = z.object({
  id: z.number().describe('Numeric Greenhouse department ID'),
  name: z.string().describe('Department name'),
  children: z.array(z.object({
    id: z.number().describe('Numeric Greenhouse department ID'),
    name: z.string().describe('Department name'),
    children: z.array(z.object({ id: z.number(), name: z.string() })).describe('Third-level departments (typically empty)'),
    jobs: z.array(GreenhouseJobSchema).describe('Published jobs in this department'),
  })).describe('Second-level child departments'),
  jobs: z.array(GreenhouseJobSchema).describe('Published jobs in this child department'),
});

export const DepartmentSchema = z.object({
  id: z.number().describe('Numeric Greenhouse department ID'),
  name: z.string().describe('Department name'),
  parent_id: z.number().nullable().optional().describe('Parent department ID, or null for top-level departments; absent when render_as=tree'),
  child_ids: z.array(z.number()).optional().describe('Child department IDs; absent when render_as=tree'),
  children: z.array(DepartmentChildSchema).optional().describe('Nested child departments; present only when render_as=tree'),
  jobs: z.array(GreenhouseJobSchema).describe('Published jobs in this department'),
});

export const OfficeDepartmentSchema = z.object({
  id: z.number().describe('Numeric Greenhouse department ID'),
  name: z.string().describe('Department name'),
  parent_id: z.number().nullable().describe('Parent department ID, or null for top-level departments'),
  child_ids: z.array(z.number()).describe('Child department IDs'),
  jobs: z.array(GreenhouseJobSchema).describe('Published jobs in this department for this office'),
}).describe('Department nested under an office; always in flat format with parent_id and child_ids regardless of the render_as parameter on the parent office request');

export const OfficeChildSchema = z.object({
  id: z.number().describe('Numeric Greenhouse office ID'),
  name: z.string().describe('Office name'),
  location: z.string().nullable().describe('Office location string, or null when not set'),
  children: z.array(z.object({ id: z.number(), name: z.string(), location: z.string().nullable() })).describe('Third-level child offices (typically empty)'),
  departments: z.array(OfficeDepartmentSchema).describe('Departments represented in this office'),
});

export const OfficeSchema = z.object({
  id: z.number().describe('Numeric Greenhouse office ID'),
  name: z.string().describe('Office name'),
  location: z.string().nullable().describe('Office location string, or null when not set'),
  parent_id: z.number().nullable().optional().describe('Parent office ID, or null for top-level offices; absent when render_as=tree'),
  child_ids: z.array(z.number()).optional().describe('Child office IDs; absent when render_as=tree'),
  children: z.array(OfficeChildSchema).optional().describe('Nested child offices; present only when render_as=tree'),
  departments: z.array(OfficeDepartmentSchema).describe('Departments represented in this office'),
});

export const JobSectionSchema = z.object({
  id: z.number().optional().describe('Section ID when Greenhouse returns one'),
  name: z.string().optional().describe('Section display name when Greenhouse returns one'),
  title: z.string().optional().describe('Section title when Greenhouse returns one'),
  content: z.string().optional().describe('HTML-entity-encoded section content when present'),
  jobs: z.array(GreenhouseJobSchema).optional().describe('Jobs nested in this section when present'),
}).passthrough();

export const BoardSchema = z.object({
  name: z.string().describe('Company/board display name'),
  content: z.string().describe('HTML-entity-encoded board introduction content; often empty'),
});

export const MetaSchema = z.object({
  total: z.number().describe('Total number of jobs in this response'),
});

// ============================================================================
// Function Schemas
// ============================================================================

export const getBoardSchema = {
  name: 'getBoard',
  description: 'Get public board information including board name and intro content',
  notes: '',
  input: z.object({
    boardToken: BoardTokenParam,
  }),
  output: BoardSchema,
};

export const listJobsSchema = {
  name: 'listJobs',
  description: 'List all published jobs on a public Greenhouse board',
  notes: 'Set content=true to include HTML-entity-encoded descriptions plus embedded departments and offices for every job. The API returns the complete job list in one response; there is no pagination.',
  input: z.object({
    boardToken: BoardTokenParam,
    content: z
      .boolean()
      .optional()
      .describe('When true, include full job content plus departments/offices on every job'),
  }),
  output: z.object({
    jobs: z.array(GreenhouseJobSchema).describe('Published jobs on the board'),
    meta: MetaSchema.describe('Response counts'),
  }),
};

export const getJobSchema = {
  name: 'getJob',
  description: 'Get detailed information for a single public Greenhouse job',
  notes: 'Single job reads always include content, departments, and offices. Set questions=true to include application questions, demographic questions, location questions, and compliance data. Set pay_transparency=true to include structured pay ranges (min_cents, max_cents, currency_type) in pay_input_ranges.',
  input: z.object({
    boardToken: BoardTokenParam,
    jobId: JobIdParam,
    questions: z
      .boolean()
      .optional()
      .describe('When true, include application questions and compliance/demographic question data'),
    pay_transparency: z
      .boolean()
      .optional()
      .describe('When true, include pay_input_ranges with structured salary min/max in cents, currency, and disclosure text'),
  }),
  output: GreenhouseJobWithQuestionsSchema,
};

export const listDepartmentsSchema = {
  name: 'listDepartments',
  description: 'List all departments on a public Greenhouse board with their embedded jobs',
  notes: 'Default (render_as=list) returns all departments as a flat array; parent_id and child_ids describe the hierarchy. Use render_as=tree to get only top-level departments with children nested inside each department object; in tree mode parent_id and child_ids are absent and children contains nested department nodes.',
  input: z.object({
    boardToken: BoardTokenParam,
    render_as: z
      .enum(['list', 'tree'])
      .optional()
      .describe('list (default) returns all departments as a flat array with parent_id and child_ids; tree returns only top-level departments with children nested inside each node'),
  }),
  output: z.object({
    departments: z.array(DepartmentSchema).describe('Departments on the board'),
  }),
};

export const getDepartmentSchema = {
  name: 'getDepartment',
  description: 'Get a single Greenhouse department and its embedded jobs',
  notes: '',
  input: z.object({
    boardToken: BoardTokenParam,
    departmentId: DepartmentIdParam,
  }),
  output: DepartmentSchema,
};

export const listOfficesSchema = {
  name: 'listOffices',
  description: 'List all offices on a public Greenhouse board with embedded departments',
  notes: 'Default (render_as=list) returns all offices as a flat array; parent_id and child_ids describe the hierarchy. Use render_as=tree to get only top-level offices with children nested inside each office object; in tree mode parent_id and child_ids are absent and children contains nested office nodes.',
  input: z.object({
    boardToken: BoardTokenParam,
    render_as: z
      .enum(['list', 'tree'])
      .optional()
      .describe('list (default) returns all offices as a flat array with parent_id and child_ids; tree returns only top-level offices with children nested inside each node'),
  }),
  output: z.object({
    offices: z.array(OfficeSchema).describe('Offices on the board'),
  }),
};

export const getOfficeSchema = {
  name: 'getOffice',
  description: 'Get a single Greenhouse office with its embedded departments',
  notes: 'Default (render_as=list) returns the office with parent_id and child_ids on the office node itself. Use render_as=tree to get the office with children nested inside; in tree mode parent_id and child_ids are absent from the office node and children contains nested office nodes. Note: render_as only affects the office node structure — the embedded departments array always uses flat format with parent_id and child_ids regardless of render_as.',
  input: z.object({
    boardToken: BoardTokenParam,
    officeId: OfficeIdParam,
    render_as: z
      .enum(['list', 'tree'])
      .optional()
      .describe('list (default) returns the office with parent_id and child_ids; tree returns the office with children nested inside each node, omitting parent_id and child_ids'),
  }),
  output: OfficeSchema,
};

export const listSectionsSchema = {
  name: 'listSections',
  description: 'List board-builder sections on a public Greenhouse board',
  notes: 'Sections are often empty even when the board has jobs, departments, and offices.',
  input: z.object({
    boardToken: BoardTokenParam,
  }),
  output: z.object({
    sections: z.array(JobSectionSchema).describe('Board-builder sections returned by Greenhouse'),
  }),
};

export const searchJobsSchema = {
  name: 'searchJobs',
  description: 'Search published Greenhouse jobs by title, location name, department name, and office name',
  notes: 'The public API has no server-side search. This function fetches the full board with content=true and filters in memory using case-insensitive substring matching.',
  input: z.object({
    boardToken: BoardTokenParam,
    query: z
      .string()
      .optional()
      .describe('Case-insensitive substring to match against job titles'),
    location: z
      .string()
      .optional()
      .describe('Case-insensitive substring to match against job location.name'),
    department: z
      .string()
      .optional()
      .describe('Case-insensitive substring to match against attached department names'),
    office: z
      .string()
      .optional()
      .describe('Case-insensitive substring to match against attached office names'),
  }),
  output: z.object({
    jobs: z.array(GreenhouseJobSchema).describe('Jobs matching all provided filters'),
    meta: MetaSchema.describe('Filtered response counts'),
  }),
};

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  getBoardSchema,
  listJobsSchema,
  getJobSchema,
  listDepartmentsSchema,
  getDepartmentSchema,
  listOfficesSchema,
  getOfficeSchema,
  listSectionsSchema,
  searchJobsSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

export type Board = z.infer<typeof BoardSchema>;
export type DataCompliance = z.infer<typeof DataComplianceSchema>;
export type DepartmentChild = z.infer<typeof DepartmentChildSchema>;
export type Department = z.infer<typeof DepartmentSchema>;
export type DemographicQuestions = z.infer<typeof DemographicQuestionsSchema>;
export type GreenhouseJob = z.infer<typeof GreenhouseJobSchema>;
export type JobQuestion = z.infer<typeof JobQuestionSchema>;
export type JobQuestionField = z.infer<typeof JobQuestionFieldSchema>;
export type JobSection = z.infer<typeof JobSectionSchema>;
export type MetadataItem = z.infer<typeof MetadataItemSchema>;
export type Office = z.infer<typeof OfficeSchema>;
export type OfficeChild = z.infer<typeof OfficeChildSchema>;
export type PayInputRange = z.infer<typeof PayInputRangeSchema>;

export type GetBoardOutput = z.infer<typeof getBoardSchema.output>;
export type ListJobsOutput = z.infer<typeof listJobsSchema.output>;
export type GetJobOutput = z.infer<typeof getJobSchema.output>;
export type ListDepartmentsOutput = z.infer<typeof listDepartmentsSchema.output>;
export type GetDepartmentOutput = z.infer<typeof getDepartmentSchema.output>;
export type ListOfficesOutput = z.infer<typeof listOfficesSchema.output>;
export type GetOfficeOutput = z.infer<typeof getOfficeSchema.output>;
export type ListSectionsOutput = z.infer<typeof listSectionsSchema.output>;
export type SearchJobsOutput = z.infer<typeof searchJobsSchema.output>;
