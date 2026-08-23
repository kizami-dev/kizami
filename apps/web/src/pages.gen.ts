// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages, GetConfigResponse, SearchCodecsForPages } from 'waku/router';

// prettier-ignore
import type { getConfig as File_Corrections_getConfig } from './pages/corrections';
// prettier-ignore
import type { getConfig as File_Index_getConfig } from './pages/index';
// prettier-ignore
import type { getConfig as File_InviteToken_getConfig } from './pages/invite/[token]';
// prettier-ignore
import type { getConfig as File_Leave_getConfig } from './pages/leave';
// prettier-ignore
import type { getConfig as File_Login_getConfig } from './pages/login';
// prettier-ignore
import type { getConfig as File_Monthly_getConfig } from './pages/monthly';
// prettier-ignore
import type { getConfig as File_Notifications_getConfig } from './pages/notifications';
// prettier-ignore
import type { getConfig as File_Punch_getConfig } from './pages/punch';
// prettier-ignore
import type { getConfig as File_SettingsAllowances_getConfig } from './pages/settings/allowances';
// prettier-ignore
import type { getConfig as File_SettingsApiKeys_getConfig } from './pages/settings/api-keys';
// prettier-ignore
import type { getConfig as File_SettingsAttendance_getConfig } from './pages/settings/attendance';
// prettier-ignore
import type { getConfig as File_SettingsDepartments_getConfig } from './pages/settings/departments';
// prettier-ignore
import type { getConfig as File_SettingsHelp_getConfig } from './pages/settings/help';
// prettier-ignore
import type { getConfig as File_SettingsIndex_getConfig } from './pages/settings/index';
// prettier-ignore
import type { getConfig as File_SettingsLeave_getConfig } from './pages/settings/leave';
// prettier-ignore
import type { getConfig as File_SettingsMembers_getConfig } from './pages/settings/members';
// prettier-ignore
import type { getConfig as File_SettingsNotifications_getConfig } from './pages/settings/notifications';
// prettier-ignore
import type { getConfig as File_SettingsNotificationsMe_getConfig } from './pages/settings/notifications/me';
// prettier-ignore
import type { getConfig as File_SettingsPresets_getConfig } from './pages/settings/presets';
// prettier-ignore
import type { getConfig as File_SettingsPrivacy_getConfig } from './pages/settings/privacy';
// prettier-ignore
import type { getConfig as File_SettingsSlackLink_getConfig } from './pages/settings/slack-link';
// prettier-ignore
import type { getConfig as File_SettingsSlack_getConfig } from './pages/settings/slack';
// prettier-ignore
import type { getConfig as File_SettingsTenantProfile_getConfig } from './pages/settings/tenant-profile';

// prettier-ignore
type Page =
| { path: '/_root'; render: 'static' }
| ({ path: '/corrections' } & GetConfigResponse<typeof File_Corrections_getConfig>)
| ({ path: '/' } & GetConfigResponse<typeof File_Index_getConfig>)
| ({ path: '/invite/[token]' } & GetConfigResponse<typeof File_InviteToken_getConfig>)
| ({ path: '/leave' } & GetConfigResponse<typeof File_Leave_getConfig>)
| ({ path: '/login' } & GetConfigResponse<typeof File_Login_getConfig>)
| ({ path: '/monthly' } & GetConfigResponse<typeof File_Monthly_getConfig>)
| ({ path: '/notifications' } & GetConfigResponse<typeof File_Notifications_getConfig>)
| ({ path: '/punch' } & GetConfigResponse<typeof File_Punch_getConfig>)
| ({ path: '/settings/allowances' } & GetConfigResponse<typeof File_SettingsAllowances_getConfig>)
| ({ path: '/settings/api-keys' } & GetConfigResponse<typeof File_SettingsApiKeys_getConfig>)
| ({ path: '/settings/attendance' } & GetConfigResponse<typeof File_SettingsAttendance_getConfig>)
| ({ path: '/settings/departments' } & GetConfigResponse<typeof File_SettingsDepartments_getConfig>)
| ({ path: '/settings/help' } & GetConfigResponse<typeof File_SettingsHelp_getConfig>)
| ({ path: '/settings' } & GetConfigResponse<typeof File_SettingsIndex_getConfig>)
| ({ path: '/settings/leave' } & GetConfigResponse<typeof File_SettingsLeave_getConfig>)
| ({ path: '/settings/members' } & GetConfigResponse<typeof File_SettingsMembers_getConfig>)
| ({ path: '/settings/notifications' } & GetConfigResponse<typeof File_SettingsNotifications_getConfig>)
| ({ path: '/settings/notifications/me' } & GetConfigResponse<typeof File_SettingsNotificationsMe_getConfig>)
| ({ path: '/settings/presets' } & GetConfigResponse<typeof File_SettingsPresets_getConfig>)
| ({ path: '/settings/privacy' } & GetConfigResponse<typeof File_SettingsPrivacy_getConfig>)
| ({ path: '/settings/slack-link' } & GetConfigResponse<typeof File_SettingsSlackLink_getConfig>)
| ({ path: '/settings/slack' } & GetConfigResponse<typeof File_SettingsSlack_getConfig>)
| ({ path: '/settings/tenant-profile' } & GetConfigResponse<typeof File_SettingsTenantProfile_getConfig>);

// prettier-ignore
type Layout =
| { path: '/' };

// prettier-ignore
declare module 'waku/router' {
  interface RouteConfig {
    paths: PathsForPages<Page>;
  }
  interface CreatePagesConfig {
    pages: Page;
    layouts: Layout;
  }
  interface SearchCodecsConfig extends SearchCodecsForPages<Page> {}
}
