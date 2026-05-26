"""Re-generate org_tree_node_hulls.csv using effective hull state.

Reads original node data from git history (explicit inCouncil/inGroup overrides),
falls back to role defaults for nodes where those flags are None, and writes
correct hull rows to the CSV.
"""

import csv
import io
import json
import re
import subprocess
import sys
import os

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HULLS_CSV = os.path.join(REPO_ROOT, "data", "JECJordanData", "org_tree_node_hulls.csv")

# ── Role classification (mirrors frontend classifyRole) ───────────────────────

COMMITTEES = [
    'اللجنة الإعلاميّة', 'اللجنة الفنيّة', 'اللجنة الاجتماعيّة',
    'لجنة الخدمة', 'لجنة العلاقات العامة', 'اللجنة اللوجستية',
    'الفرقة الموسيقيّة', 'لجنة التنظيم', 'اللجنة الروحيّة',
    'لجنة عمل المحبة', 'لجنة المواضيع', 'لجنة النشاطات',
    'لجنة التدريب والتطوير', 'لجنة المساندة العامة', 'اللجنة الترفيهيّة',
]

BARAEM_GROUP = 'البراعم'
BARAEM_BIG_GROUP = 'كبرى البراعم'
BARAEM_SMALL_GROUP = 'صغرى البراعم'
ROLE_AGE_GROUPS = [BARAEM_GROUP, BARAEM_BIG_GROUP, BARAEM_SMALL_GROUP,
                   'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']
ACTING_PREFIX = 'قائم بأعمال '
COUNCIL_HULL = 'مجلس الشبيبة'


def is_composite_committee(s):
    if not s:
        return False
    if s in COMMITTEES:
        return True
    parts = [p.strip() for p in s.split(' و ')]
    return len(parts) > 1 and all(p in COMMITTEES for p in parts)


def extract_age_groups(role):
    found = []
    if BARAEM_BIG_GROUP in role:
        found.append(BARAEM_BIG_GROUP)
    if BARAEM_SMALL_GROUP in role:
        found.append(BARAEM_SMALL_GROUP)
    if not found and BARAEM_GROUP in role:
        found.append(BARAEM_GROUP)
    for g in [g for g in ROLE_AGE_GROUPS if g not in (BARAEM_BIG_GROUP, BARAEM_SMALL_GROUP, BARAEM_GROUP)]:
        if g in role:
            found.append(g)
    return found


def classify_role(role):
    if not role:
        return None
    if role.startswith(ACTING_PREFIX):
        role = role[len(ACTING_PREFIX):]
    if role == 'المسؤول العام':
        return {'tier': 'general_manager'}
    if role == 'المرشد الروحي':
        return {'tier': 'spiritual_guide'}
    if role == 'مساعد المرشد الروحي':
        return {'tier': 'spiritual_guide_assistant'}
    if re.match(r'^مرشد روحي (فئة|فئتيّ|فئات)', role):
        return {'tier': 'spiritual_guide_agegroup'}
    if role in ('نائب المسؤول العام', 'مستشار الشبيبة', 'أمين السر', 'أمين الصندوق', 'أمين العهدة'):
        return {'tier': 'reports_to_gm'}
    if role in ('مساعد أمين السر', 'مساعد أمين الصندوق', 'مساعد أمين العهدة'):
        return {'tier': 'secretary_assistant', 'parentRole': role[len('مساعد '):]}
    if role.startswith('مسؤول ') and is_composite_committee(role[len('مسؤول '):]):
        return {'tier': 'reports_to_gm', 'committeeHead': True}
    if is_composite_committee(role):
        return {'tier': 'committee_member', 'committee': role}
    if re.match(r'^مسؤول (فئة|فئتيّ|فئات)', role):
        return {'tier': 'reports_to_gm', 'councilHead': True}
    if re.match(r'^مجلس (فئة|فئتيّ|فئات)', role):
        return {'tier': 'council_head', 'councilHead': True}
    if re.match(r'^مسؤول مساعد في (فئة|فئتيّ|فئات)', role):
        return {'tier': 'council_assistant'}
    return None


def is_default_council_member(role):
    c = classify_role(role)
    if not c:
        return False
    return c['tier'] in ('general_manager', 'spiritual_guide', 'spiritual_guide_assistant',
                         'spiritual_guide_agegroup', 'reports_to_gm')


def is_default_group_member(role):
    c = classify_role(role)
    if not c:
        return False
    tier = c['tier']
    if tier == 'reports_to_gm' and c.get('councilHead'):
        return True
    if tier == 'council_head':
        return True
    if tier == 'spiritual_guide_agegroup':
        return True
    if tier == 'reports_to_gm' and c.get('committeeHead'):
        return True
    if tier == 'committee_member':
        return True
    return False


def sort_groups(groups):
    order = {g: i for i, g in enumerate(ROLE_AGE_GROUPS)}
    return sorted(groups, key=lambda g: order.get(g, 999))


def group_hull_names(role):
    """Return list of group hull display names for this role."""
    c = classify_role(role)
    if not c:
        return []
    tier = c['tier']
    if tier == 'council_assistant':
        return []
    if tier == 'reports_to_gm' and c.get('committeeHead'):
        name = role[len('مسؤول '):]
        return [name]
    if tier == 'committee_member':
        return [role]
    if (tier in ('reports_to_gm', 'council_head', 'spiritual_guide_agegroup')
            and (c.get('councilHead') or tier in ('council_head', 'spiritual_guide_agegroup'))):
        groups = sort_groups(extract_age_groups(role))
        if not groups:
            return []
        n = len(groups)
        if n == 1:
            word, lst = 'فئة', groups[0]
        elif n == 2:
            word, lst = 'فئتيّ', f'{groups[0]} و{groups[1]}'
        else:
            word = 'فئات'
            lst = ' و'.join(groups[:-1]) + ' و' + groups[-1]
        return [f'مجلس {word} {lst}']
    return []


# ── Git helpers ───────────────────────────────────────────────────────────────

def git_show(path):
    result = subprocess.run(
        ['git', 'show', f'HEAD:{path}'],
        cwd=REPO_ROOT,
        capture_output=True,
    )
    if result.returncode != 0:
        return None
    return result.stdout.decode('utf-8')


def list_non_gs_period_files():
    result = subprocess.run(
        ['git', 'ls-tree', '-r', 'HEAD', '--name-only'],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    files = []
    for line in result.stdout.splitlines():
        if not line.startswith('data/org_trees/'):
            continue
        if '/GS/' in line:
            continue
        if line.endswith('index.json'):
            continue
        if line.endswith('.json'):
            files.append(line)
    return files


# ── Main migration ────────────────────────────────────────────────────────────

def compute_hull_rows():
    period_files = list_non_gs_period_files()
    hull_rows = []

    for fpath in sorted(period_files):
        content = git_show(fpath)
        if not content:
            print(f"  SKIP (not found in HEAD): {fpath}", file=sys.stderr)
            continue

        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            print(f"  SKIP (JSON error in {fpath}): {e}", file=sys.stderr)
            continue

        # Derive period_id from filename
        period_id = os.path.splitext(os.path.basename(fpath))[0]

        nodes = data.get('nodes') or []
        for node in nodes:
            nid = node.get('id') or ''
            role = node.get('role') or ''
            if not nid:
                continue

            # Effective values: explicit override takes priority, else role default
            explicit_council = node.get('inCouncil')
            explicit_group = node.get('inGroup')

            eff_council = bool(explicit_council) if explicit_council is not None else is_default_council_member(role)
            eff_group = bool(explicit_group) if explicit_group is not None else is_default_group_member(role)

            if eff_council:
                hull_rows.append({'period_id': period_id, 'node_id': nid, 'hull': COUNCIL_HULL})
            if eff_group:
                for hull_name in group_hull_names(role):
                    hull_rows.append({'period_id': period_id, 'node_id': nid, 'hull': hull_name})

    return hull_rows


def write_hulls_csv(rows):
    with open(HULLS_CSV, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=['period_id', 'node_id', 'hull'])
        writer.writeheader()
        writer.writerows(rows)


if __name__ == '__main__':
    print("Computing hull rows from git history...")
    rows = compute_hull_rows()
    print(f"  Generated {len(rows)} hull rows")

    write_hulls_csv(rows)
    print(f"  Written to {HULLS_CSV}")

    # Summary per period
    from collections import Counter
    counts = Counter(r['period_id'] for r in rows)
    for pid, count in sorted(counts.items()):
        print(f"    {pid}: {count} hull entries")
