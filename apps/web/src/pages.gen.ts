// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages, GetConfigResponse, SearchCodecsForPages } from 'waku/router';

// prettier-ignore
import type { getConfig as File_Corrections_getConfig } from './pages/corrections';
// prettier-ignore
import type { getConfig as File_Index_getConfig } from './pages/index';
// prettier-ignore
import type { getConfig as File_Leave_getConfig } from './pages/leave';
// prettier-ignore
import type { getConfig as File_Login_getConfig } from './pages/login';
// prettier-ignore
import type { getConfig as File_Monthly_getConfig } from './pages/monthly';
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
import type { getConfig as File_SettingsPresets_getConfig } from './pages/settings/presets';
// prettier-ignore
import type { getConfig as File_SettingsPrivacy_getConfig } from './pages/settings/privacy';
// prettier-ignore
import type { getConfig as File_SettingsTenantProfile_getConfig } from './pages/settings/tenant-profile';

// prettier-ignore
type Page =
| ({ path: '/corrections' } & GetConfigResponse<typeof File_Corrections_getConfig>)
| ({ path: '/' } & GetConfigResponse<typeof File_Index_getConfig>)
| ({ path: '/leave' } & GetConfigResponse<typeof File_Leave_getConfig>)
| ({ path: '/login' } & GetConfigResponse<typeof File_Login_getConfig>)
| ({ path: '/monthly' } & GetConfigResponse<typeof File_Monthly_getConfig>)
| ({ path: '/settings/attendance' } & GetConfigResponse<typeof File_SettingsAttendance_getConfig>)
| ({ path: '/settings/departments' } & GetConfigResponse<typeof File_SettingsDepartments_getConfig>)
| ({ path: '/settings/help' } & GetConfigResponse<typeof File_SettingsHelp_getConfig>)
| ({ path: '/settings' } & GetConfigResponse<typeof File_SettingsIndex_getConfig>)
| ({ path: '/settings/leave' } & GetConfigResponse<typeof File_SettingsLeave_getConfig>)
| ({ path: '/settings/members' } & GetConfigResponse<typeof File_SettingsMembers_getConfig>)
| ({ path: '/settings/notifications' } & GetConfigResponse<typeof File_SettingsNotifications_getConfig>)
| ({ path: '/settings/presets' } & GetConfigResponse<typeof File_SettingsPresets_getConfig>)
| ({ path: '/settings/privacy' } & GetConfigResponse<typeof File_SettingsPrivacy_getConfig>)
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
