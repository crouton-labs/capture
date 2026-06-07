import { z } from 'zod';
import { AuthParam } from './shared';

// ============================================================================
// searchMail
// ============================================================================

export const searchMailSchema = {
  name: 'searchMail',
  description:
    'Search mail messages by keyword, sender, or subject across all folders',
  notes:
    'Returns up to 25 results per call (API hard cap). Use date range filters or more specific KQL queries to narrow large result sets. Supports keyword search plus field-scoped KQL queries: from:email, to:email, cc:email, bcc:email, subject:text, body:text, hasattachment:yes, isread:no, isflagged:yes, ismentioned:yes, importance:high, category:name.',
  input: z.object({
    auth: AuthParam,
    query: z
      .string()
      .describe(
        'Search query string. Supports keywords and KQL field operators: from:email, to:email, cc:email, bcc:email, subject:(text), body:text, hasattachment:yes, isread:no, isflagged:yes, ismentioned:yes, importance:high/normal/low, category:name',
      ),
    size: z
      .number()
      .optional()
      .default(25)
      .describe('Number of results to return (default and max is 25)'),
    sortField: z
      .enum(['Time', 'Score'])
      .optional()
      .default('Time')
      .describe(
        'Field to sort results by (Time = date received, Score = relevance ranking)',
      ),
    sortDirection: z
      .literal('Desc')
      .optional()
      .default('Desc')
      .describe(
        'Sort order (Desc = newest/highest first). OWA search only supports descending sort.',
      ),
    entityType: z
      .enum(['Message', 'Conversation'])
      .optional()
      .default('Message')
      .describe(
        'Entity type to search (Message = individual emails, Conversation = grouped threads)',
      ),
    folderId: z
      .string()
      .optional()
      .describe(
        'Folder ID to scope search to. Omit to search all folders (msgfolderroot + DeletedItems)',
      ),
    enableTopResults: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'When true, returns a relevance-ranked "top results" section before time-sorted results',
      ),
    topResultsCount: z
      .number()
      .optional()
      .describe(
        'Number of top relevance-ranked results to return (only used when enableTopResults is true)',
      ),
    enableQueryAlterations: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'When true, enables spell-check suggestions and query alteration in results',
      ),
    dateStart: z
      .string()
      .optional()
      .describe(
        'Start date for date range filter (YYYY-MM-DD). Filters results to messages received on or after this date.',
      ),
    dateEnd: z
      .string()
      .optional()
      .describe(
        'End date for date range filter (YYYY-MM-DD). Filters results to messages received on or before this date.',
      ),
  }),
  output: z.object({
    results: z
      .array(
        z.object({
          itemId: z
            .string()
            .describe('Immutable item ID for use with getEmail'),
          conversationId: z.string().describe('Conversation thread ID'),
          subject: z.string().describe('Email subject'),
          from: z
            .object({
              name: z.string().describe('Sender display name'),
              email: z.string().describe('Sender email address'),
            })
            .describe('Sender information'),
          preview: z
            .string()
            .describe('Body preview snippet with search term highlights'),
          receivedAt: z.string().describe('ISO 8601 received date'),
          isRead: z.boolean().describe('Whether the message has been read'),
          hasAttachments: z
            .boolean()
            .describe('Whether the message has file attachments'),
          importance: z
            .string()
            .describe('Message importance level (Normal, High, Low)'),
          isDraft: z.boolean().describe('Whether the message is a draft'),
          folderName: z
            .string()
            .describe(
              'Display name of the folder containing the message (e.g., "Inbox", "Sent Items")',
            ),
        }),
      )
      .describe('Ranked search results'),
    totalCount: z
      .number()
      .describe(
        'Total number of matching results (may exceed returned results since max per call is 25)',
      ),
  }),
};

// ============================================================================
// listCategories
// ============================================================================

export const listCategoriesSchema = {
  name: 'listCategories',
  description:
    'List all mail categories with item and unread counts per category',
  notes:
    'Returns categories that have items tagged. Categories with zero items are not included. The counts reflect all folders.',
  input: z.object({
    auth: AuthParam,
  }),
  output: z.object({
    categories: z
      .array(
        z.object({
          name: z.string().describe('Category label name'),
          itemCount: z
            .number()
            .describe('Total number of items tagged with this category'),
          unreadCount: z
            .number()
            .describe('Number of unread items tagged with this category'),
        }),
      )
      .describe('Categories that have tagged items'),
    estimatedRowCount: z
      .number()
      .describe('Server-estimated total number of categories with items'),
    isSearchFolderReady: z
      .boolean()
      .describe(
        'Whether the backing search folder is ready (false during initial indexing)',
      ),
  }),
};

// ============================================================================
// getSettings
// ============================================================================

export const getSettingsSchema = {
  name: 'getSettings',
  description:
    'Retrieve user preferences and Outlook roaming options including mail layout, calendar surface options, commanding/ribbon settings, notification preferences, and premium status. Returns the OutlookOptions REST response organized by setting category.',
  notes:
    'Uses the /ows/v1.0/OutlookOptions REST endpoint which returns an array of typed option objects. Each option has an itemClass identifying its category (e.g., MailLayout, CalendarSurfaceOptions, Commanding). Settings that are internal/ad-tracking are excluded from the output.',
  input: z.object({
    auth: AuthParam,
  }),
  output: z.object({
    mailLayout: z
      .object({
        useSingleLineMessageListWithRightReadingPane: z
          .boolean()
          .describe(
            'Whether single-line message list is used with the right reading pane',
          ),
        animationPreference: z
          .number()
          .describe('Animation preference level (0 = default/enabled)'),
      })
      .optional()
      .describe('Mail layout preferences (itemClass: MailLayout)'),
    calendarSurface: z
      .object({
        agendaPaneIsClosed: z
          .boolean()
          .describe('Whether the agenda pane is closed'),
        numDaysInDayRange: z
          .number()
          .describe('Number of days shown in the day view (1, 3, 5, 7)'),
        lastKnownRoamingTimeZone: z
          .string()
          .describe(
            'Last known roaming timezone (Windows timezone ID, e.g., "Pacific Standard Time")',
          ),
        roamingTimeZoneNotificationsIsDisabled: z
          .boolean()
          .describe(
            'Whether roaming timezone change notifications are disabled',
          ),
        workLifeView: z.number().describe('Work/life view mode (0 = default)'),
        timeScaleSetting: z
          .number()
          .describe(
            'Calendar time scale in minutes (6 = 30min increments by default)',
          ),
        isDynamicColumnWidthEnabled: z
          .boolean()
          .describe(
            'Whether dynamic column width is enabled in calendar views',
          ),
        currentSavedViewId: z
          .string()
          .nullable()
          .describe('ID of the currently saved calendar view (null if none)'),
        allDayWellHeight: z
          .number()
          .describe('Height of the all-day event well in pixels'),
        roamingTimeZoneTeachingMomentDisplayed: z
          .boolean()
          .describe(
            'Whether the roaming timezone teaching moment has been shown',
          ),
        bannedRoamingTimeZone: z
          .string()
          .nullable()
          .describe(
            'Timezone banned from roaming notifications (null if none)',
          ),
      })
      .optional()
      .describe('Calendar surface options (itemClass: CalendarSurfaceOptions)'),
    commanding: z
      .object({
        shyRibbon: z
          .boolean()
          .describe(
            'Whether the ribbon auto-hides (shy ribbon / simplified ribbon)',
          ),
        viewMode: z
          .number()
          .describe(
            'Ribbon view mode (0 = classic ribbon, 1 = simplified ribbon, 2 = auto)',
          ),
      })
      .optional()
      .describe('Ribbon/toolbar settings (itemClass: Commanding)'),
    calendarSurfaceAddins: z
      .array(z.string())
      .optional()
      .describe(
        'IDs of calendar surface add-ins (itemClass: CalendarSurfaceAddins)',
      ),
    mentionEventNotifications: z
      .object({
        enabled: z
          .boolean()
          .describe(
            'Whether @mention event notifications are enabled in calendar',
          ),
      })
      .optional()
      .describe(
        'Mention-based event notification settings (itemClass: MentionEventNotifications)',
      ),
    webPushNotifications: z
      .object({
        enabled: z
          .boolean()
          .describe('Whether web push notifications are enabled'),
        enabledTimeInUTCMs: z
          .number()
          .nullable()
          .describe(
            'Timestamp (UTC ms) when web push was enabled (null if never)',
          ),
      })
      .optional()
      .describe(
        'Web push notification settings (itemClass: WebPushNotifications)',
      ),
    premiumStatus: z
      .object({
        overallPremiumStatusBit: z
          .number()
          .describe('Premium status bitmask (0 = not premium, 1 = premium)'),
        licenseAccountIsPremium: z
          .boolean()
          .describe('Whether the license account has premium features enabled'),
      })
      .optional()
      .describe(
        'Premium subscription status (itemClass: PremiumStatusInPrimarySettings)',
      ),
    isBusinessConsumer: z
      .boolean()
      .optional()
      .describe(
        'Whether the account is a business consumer (itemClass: IsBusinessConsumer)',
      ),
  }),
};

// ============================================================================
// Inferred Types
// ============================================================================

export type SearchMailInput = z.infer<typeof searchMailSchema.input>;
export type SearchMailOutput = z.infer<typeof searchMailSchema.output>;
export type ListCategoriesInput = z.infer<typeof listCategoriesSchema.input>;
export type ListCategoriesOutput = z.infer<typeof listCategoriesSchema.output>;
export type GetSettingsInput = z.infer<typeof getSettingsSchema.input>;
export type GetSettingsOutput = z.infer<typeof getSettingsSchema.output>;
