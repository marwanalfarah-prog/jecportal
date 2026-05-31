/**
 * Central Permission Module — JEC Jordan Portal
 *
 * Single source of truth for all frontend permission checks.
 * - computePermissions()   → derive all flags from authUser + viewAsUser
 * - canViewProfile()       → profile access check
 * - canApproveYG()         → YG request approval check (mirrors backend _can_approve_yg)
 * - getNavItems()          → navigation menu for the current user
 * - getAllowedPages()       → page-ID whitelist for navigate()
 * - getAdminAllowedPages() → page IDs allowed on initial URL load for admin
 *
 * All privilege overrides managed in PrivilegeManager flow through
 * council_access on the user object (applied by the backend in auth/me).
 * No other file should duplicate these checks.
 */

import {
  LayoutDashboard, Users, GitBranch, ShieldCheck,
  ClipboardList, Settings, Building2, MapPin,
  BookOpenText, UserPlus, Calendar as CalendarIcon,
  Key, User as UserIcon, TrendingUp,
} from 'lucide-react'

// ── Core computation ─────────────────────────────────────────────────────────

/**
 * Derive all permission flags from the current session.
 * Call once per render; destructure the result for convenience.
 */
export function computePermissions(authUser, viewAsUser = null) {
  const effectiveUser = viewAsUser || authUser
  const accountStatus = effectiveUser?.account_status || 'active'

  const isAdmin = authUser?.role === 'admin' && !viewAsUser
  const isMember = effectiveUser?.role === 'member'
  const isPendingUser = !isAdmin && (
    effectiveUser?.is_pending ||
    accountStatus === 'pending' ||
    accountStatus === 'pending_yg'
  )
  const councilAccess = effectiveUser?.council_access || {}
  const isCouncil = isMember && !isPendingUser && Object.keys(councilAccess).length > 0

  return {
    authUser,
    effectiveUser,
    isAdmin,
    isMember,
    isPendingUser,
    isCouncil,
    councilAccess,
    isAuthenticated: !!authUser,
  }
}

// ── Profile access ───────────────────────────────────────────────────────────

/**
 * Can the current session view a specific person's profile?
 *
 * Access is granted if ANY of these conditions holds:
 *   1. Admin role → unrestricted
 *   2. Own profile
 *   3. Person is in council_accessible_persons (computed server-side, age-group specific)
 *   4. Person is in org_tree_descendants (computed server-side)
 *
 * Both lists come from auth/me and already have all privilege overrides applied.
 * The coarse isCouncil flag is NOT used here — specificity is enforced by the server.
 */
export function canViewProfile(perms, effectiveUser, pid, unreg = false) {
  if (!pid) return false
  const { isAdmin, isMember } = perms
  if (isAdmin) return true
  if (!isMember) return false

  // Own profile is always accessible
  if (
    String(pid) === String(effectiveUser?.person_id) &&
    unreg === (effectiveUser?.person_type === 'unregistered')
  ) return true

  const pidStr     = String(pid)
  const targetType = unreg ? 'unregistered' : 'registered'

  // Council access — precise list: only the specific group+age_group members the user governs
  const councilAccessible = effectiveUser?.council_accessible_persons || []
  if (councilAccessible.some(d =>
    String(d.person_id) === pidStr && d.person_type === targetType
  )) return true

  // Org-tree hierarchy — viewer is an ancestor of the target person
  const descendants = effectiveUser?.org_tree_descendants || []
  if (descendants.some(d =>
    String(d.person_id) === pidStr && d.person_type === targetType
  )) return true

  return false
}

/**
 * Return true if the current user has org-tree-based access to view
 * at least one other person's profile (i.e. they have descendants).
 */
export function hasOrgTreeDescendantAccess(effectiveUser) {
  return (effectiveUser?.org_tree_descendants?.length ?? 0) > 0
}

/**
 * Return true if the current non-admin user has access to at least one
 * other person's profile data (council access or org tree descendants).
 * This determines whether the Members page is available to them.
 */
export function hasAnyProfileAccess(perms, effectiveUser) {
  if (perms.isAdmin) return true
  return (
    (effectiveUser?.council_accessible_persons?.length ?? 0) > 0 ||
    hasOrgTreeDescendantAccess(effectiveUser)
  )
}

// ── YG approval ──────────────────────────────────────────────────────────────

/**
 * Can the current session approve/reject a specific YG membership request?
 * Mirrors the backend `_can_approve_yg` function exactly.
 * councilAccess already includes PrivilegeManager overrides (applied by auth/me).
 */
export function canApproveYG(perms, youthGroupId, ageGroup = null) {
  const { isAdmin, councilAccess } = perms
  if (isAdmin) return true
  const info = councilAccess[youthGroupId]
  if (!info) return false
  if (info.full_group) return true
  if (ageGroup && (info.age_groups || []).includes(ageGroup)) return true
  return false
}

// ── Navigation ───────────────────────────────────────────────────────────────

/**
 * Build the sidebar navigation items for the current user.
 * The full list of admin nav items reflects every managed page,
 * making this the authoritative source for what admins can reach.
 */
export function getNavItems(perms) {
  const { isAdmin, isPendingUser, isCouncil } = perms

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
    { id: 'privileges',          label: 'إدارة الصلاحيات',             icon: Key },
    { id: 'requests',            label: 'طلبات التسجيل',               icon: ClipboardList },
    { id: 'questionnaires',      label: 'إدارة الاستبيانات',           icon: ClipboardList },
    { id: 'youth_groups',        label: 'ملف فرق الشبيبة',             icon: Building2 },
    { id: 'churches_map',        label: 'خريطة الكنائس',               icon: MapPin },
    { id: 'bible_reader',        label: 'قارئ الكتاب المقدس',          icon: BookOpenText },
    { id: 'config',              label: 'الإعدادات',                    icon: Settings },
  ]

  // Member — show Members page if they have any profile access
  const memberHasProfileAccess = hasAnyProfileAccess(perms, perms.effectiveUser)
  return [
    { id: 'profile',         label: 'ملفي الشخصي',         icon: UserIcon },
    { id: 'calendar',        label: 'التقويم',              icon: CalendarIcon },
    { id: 'orgtree',         label: 'الهيكل التنظيمي',     icon: GitBranch },
    { id: 'general_secretariat', label: 'الأمانة العامة',  icon: GitBranch },
    ...(memberHasProfileAccess ? [{ id: 'members', label: 'الأعضاء', icon: Users }] : []),
    ...(isCouncil ? [{ id: 'promotions', label: 'الترفيعات',       icon: TrendingUp }] : []),
    ...(isCouncil ? [{ id: 'requests',   label: 'طلبات الانضمام', icon: ClipboardList }] : []),
    { id: 'churches_map',    label: 'خريطة الكنائس',        icon: MapPin },
    { id: 'bible_reader',    label: 'قارئ الكتاب المقدس',  icon: BookOpenText },
    { id: 'my_questions',    label: 'استبياناتي',           icon: ClipboardList },
  ]
}

// ── Page whitelists ───────────────────────────────────────────────────────────

/**
 * Pages the current user is permitted to navigate() to.
 * This is the authoritative list — navigate() enforces it.
 */
export function getAllowedPages(perms) {
  const { isAdmin, isPendingUser } = perms

  if (isPendingUser) return [
    'requests', 'profile', 'calendar', 'general_secretariat', 'bible_reader', 'churches_map',
  ]

  if (isAdmin) return [
    'dashboard', 'members', 'calendar', 'orgtree', 'general_secretariat',
    'users', 'privileges', 'questionnaires', 'youth_groups', 'churches_map',
    'bible_reader', 'config', 'requests', 'add_member',
  ]

  const base = [
    'profile', 'calendar', 'orgtree', 'general_secretariat', 'promotions', 'churches_map',
    'bible_reader', 'my_questions', 'requests', 'add_member',
  ]
  // Members page is allowed if the user has any profile access beyond their own
  if (hasAnyProfileAccess(perms, perms.effectiveUser)) {
    base.push('members')
  }
  return base
}

/**
 * Pages an admin is allowed to land on via direct URL on initial load.
 * Subset of getAllowedPages — excludes transient pages like add_member.
 */
export function getAdminAllowedUrlPages() {
  return [
    'dashboard', 'members', 'orgtree', 'general_secretariat', 'users',
    'privileges', 'questionnaires', 'youth_groups', 'churches_map',
    'bible_reader', 'config', 'profile', 'requests', 'add_member',
  ]
}
