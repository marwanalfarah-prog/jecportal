/**
 * Central Permission Module — JEC Jordan Portal
 *
 * Single source of truth for all frontend permission checks.
 * - computePermissions()   → derive all flags from authUser + viewAsUser
 * - canViewProfile()       → profile access check
 * - getNavItems()          → navigation menu for the current user
 * - getAllowedPages()       → page-ID whitelist for navigate()
 * - getAdminAllowedUrlPages() → page IDs allowed on initial URL load for admin
 *
 * Every member account has the exact same fixed set of pages, regardless
 * of their position in the org tree. No other file should duplicate these checks.
 */

import {
  LayoutDashboard, Users, GitBranch, ShieldCheck,
  ClipboardList, Settings, Building2, MapPin,
  BookOpenText, UserPlus, Calendar as CalendarIcon,
  User as UserIcon, TrendingUp, Shield, FolderOpen,
} from 'lucide-react'

// ── Core computation ─────────────────────────────────────────────────────────

/**
 * Derive all permission flags from the current session.
 * Call once per render; destructure the result for convenience.
 */
export function computePermissions(authUser, viewAsUser = null, memberAccess = null) {
  const effectiveUser = viewAsUser || authUser
  const accountStatus = effectiveUser?.account_status || 'active'

  const isAdmin = authUser?.role === 'admin' && !viewAsUser
  const isMember = effectiveUser?.role === 'member'
  const isPendingUser = !isAdmin && (
    effectiveUser?.is_pending ||
    accountStatus === 'pending'
  )

  // Set of person_id strings this member has been granted profile access to (registered)
  const profileAccessIds = new Set(
    (memberAccess?.profile_access || []).map(String)
  )

  // Set of person_id strings this member has been granted profile access to (unregistered)
  const profileAccessUnregIds = new Set(
    (memberAccess?.profile_access_unreg || []).map(String)
  )

  // promotion_access: { youth_group_ids, age_groups } or null
  const promotionAccess = memberAccess?.promotion_access || null
  const hasPromotionAccess = !isAdmin && !!promotionAccess

  // yg_registration_approval: member is designated to approve YG memberships
  const hasYgApprovalAccess = !isAdmin && !isPendingUser && !!(memberAccess?.yg_approval_scopes?.length)

  // yg_file_access: member can view the youth group admin file for specific groups
  const ygFileAccessGroupIds = !isAdmin && !isPendingUser
    ? (memberAccess?.yg_file_access_group_ids || []).map(String)
    : []
  const hasYgFileAccess = ygFileAccessGroupIds.length > 0

  return {
    authUser,
    effectiveUser,
    isAdmin,
    isMember,
    isPendingUser,
    isAuthenticated: !!authUser,
    profileAccessIds,
    profileAccessUnregIds,
    promotionAccess,
    hasPromotionAccess,
    hasYgApprovalAccess,
    hasYgFileAccess,
    ygFileAccessGroupIds,
  }
}

// ── Profile access ───────────────────────────────────────────────────────────

/**
 * Can the current session view a specific person's profile?
 *
 * Access is granted if:
 *   1. Admin role → unrestricted
 *   2. Own profile
 */
export function canViewProfile(perms, effectiveUser, pid, unreg = false) {
  if (!pid) return false
  const { isAdmin, isMember, profileAccessIds, profileAccessUnregIds } = perms
  if (isAdmin) return true
  if (!isMember) return false

  // Own profile is always accessible
  if (
    String(pid) === String(effectiveUser?.person_id) &&
    unreg === (effectiveUser?.person_type === 'unregistered')
  ) return true

  // Granted profile access
  if (!unreg && profileAccessIds?.has(String(pid))) return true
  if (unreg && profileAccessUnregIds?.has(String(pid))) return true

  return false
}

// ── Navigation ───────────────────────────────────────────────────────────────

/**
 * Build the sidebar navigation items for the current user.
 * The full list of admin nav items reflects every managed page,
 * making this the authoritative source for what admins can reach.
 */
export function getNavItems(perms) {
  const { isAdmin, isPendingUser, hasPromotionAccess, hasYgApprovalAccess, hasYgFileAccess } = perms

  if (isPendingUser) return [
    { id: 'requests',     label: 'حالة طلبي',              icon: ClipboardList },
    { id: 'profile',      label: 'ملفي الشخصي (معلّق)',    icon: UserIcon },
    { id: 'calendar',     label: 'التقويم',                icon: CalendarIcon },
    { id: 'general_secretariat', label: 'الأمانة العامة',  icon: GitBranch },
    { id: 'bible_reader', label: 'قارئ الكتاب المقدس',     icon: BookOpenText },
    { id: 'churches_map', label: 'خريطة الكنائس',          icon: MapPin },
  ]

  if (isAdmin) return [
    { id: 'dashboard',           label: 'لوحة المعلومات',              icon: LayoutDashboard },
    { id: 'members',             label: 'الأعضاء',                      icon: Users },
    { id: 'calendar',            label: 'التقويم',                      icon: CalendarIcon },
    { id: 'orgtree',             label: 'الهيكل التنظيمي',             icon: GitBranch },
    { id: 'general_secretariat', label: 'الأمانة العامة',              icon: GitBranch },
    { id: 'users',               label: 'إدارة المستخدمين',            icon: ShieldCheck },
    { id: 'promotions',          label: 'الترفيعات',                   icon: TrendingUp },
    { id: 'requests',            label: 'طلبات التسجيل',               icon: ClipboardList },
    { id: 'questionnaires',      label: 'إدارة الاستبيانات',           icon: ClipboardList },
    { id: 'youth_groups',        label: 'ملف فرق الشبيبة',             icon: Building2 },
    { id: 'churches_map',        label: 'خريطة الكنائس',               icon: MapPin },
    { id: 'bible_reader',        label: 'قارئ الكتاب المقدس',          icon: BookOpenText },
    { id: 'privileges',           label: 'إدارة الصلاحيات',             icon: Shield },
    { id: 'config',              label: 'الإعدادات',                    icon: Settings },
  ]

  // Member — base set of pages for everyone
  const memberNav = [
    { id: 'profile',         label: 'ملفي الشخصي',         icon: UserIcon },
    { id: 'calendar',        label: 'التقويم',              icon: CalendarIcon },
    { id: 'orgtree',         label: 'الهيكل التنظيمي',     icon: GitBranch },
    { id: 'general_secretariat', label: 'الأمانة العامة',  icon: GitBranch },
    { id: 'churches_map',    label: 'خريطة الكنائس',        icon: MapPin },
    { id: 'bible_reader',    label: 'قارئ الكتاب المقدس',  icon: BookOpenText },
    { id: 'my_questions',    label: 'استبياناتي',           icon: ClipboardList },
  ]

  // Show Members page only to members who have been granted profile access (registered or unregistered)
  if (perms.profileAccessIds?.size > 0 || perms.profileAccessUnregIds?.size > 0) {
    memberNav.splice(1, 0, { id: 'members', label: 'الأعضاء', icon: Users })
  }

  if (hasPromotionAccess) {
    memberNav.push({ id: 'promotions', label: 'الترفيعات', icon: TrendingUp })
  }

  if (hasYgApprovalAccess) {
    memberNav.push({ id: 'requests', label: 'موافقات الشبيبة', icon: ClipboardList })
  }

  if (hasYgFileAccess) {
    memberNav.push({ id: 'youth_groups', label: 'ملف الفرقة', icon: FolderOpen })
  }

  return memberNav
}

// ── Page whitelists ───────────────────────────────────────────────────────────

/**
 * Pages the current user is permitted to navigate() to.
 * This is the authoritative list — navigate() enforces it.
 */
export function getAllowedPages(perms) {
  const { isAdmin, isPendingUser, hasPromotionAccess, hasYgApprovalAccess, hasYgFileAccess } = perms

  if (isPendingUser) return [
    'requests', 'profile', 'calendar', 'general_secretariat', 'bible_reader', 'churches_map',
  ]

  if (isAdmin) return [
    'dashboard', 'members', 'calendar', 'orgtree', 'general_secretariat',
    'users', 'promotions', 'questionnaires', 'youth_groups', 'churches_map',
    'bible_reader', 'privileges', 'config', 'requests', 'add_member',
  ]

  const memberPages = [
    'profile', 'calendar', 'orgtree', 'general_secretariat', 'churches_map',
    'bible_reader', 'my_questions', 'add_member',
  ]
  if (perms.profileAccessIds?.size > 0 || perms.profileAccessUnregIds?.size > 0) memberPages.push('members')
  if (hasPromotionAccess) memberPages.push('promotions')
  if (hasYgApprovalAccess) memberPages.push('requests')
  if (hasYgFileAccess) memberPages.push('youth_groups')
  return memberPages
}

/**
 * Pages an admin is allowed to land on via direct URL on initial load.
 * Subset of getAllowedPages — excludes transient pages like add_member.
 */
export function getAdminAllowedUrlPages() {
  return [
    'dashboard', 'members', 'orgtree', 'general_secretariat', 'users',
    'promotions', 'questionnaires', 'youth_groups', 'churches_map',
    'bible_reader', 'privileges', 'config', 'profile', 'requests', 'add_member',
  ]
}
