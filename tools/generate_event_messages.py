# -*- coding: utf-8 -*-
"""
Generate ready-to-send participant messages for every youth group in an event.

Standalone tool — NOT part of the running web app. It reads the same data files
(data/events.json + the CSV store) using the backend's own export helpers, so the
names, phones, grades, health conditions and notes are identical to what the app
would show.

Output is a single self-contained HTML page: open it, pick an event from the
dropdown, and each participating youth group gets its own card with a one-click
"copy message" button. Re-run the tool to refresh the snapshot after data changes.

Usage (from anywhere):
    python tools/generate_event_messages.py                  # all events, opens page
    python tools/generate_event_messages.py --event EVT000003
    python tools/generate_event_messages.py --out C:/path/page.html --no-open
    python tools/generate_event_messages.py --list           # list events and exit
"""
import os
import sys
import json
import argparse
import webbrowser

# ── locate the repo / backend regardless of where we're invoked from ──────────
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO     = os.path.abspath(os.path.join(_THIS_DIR, '..'))
_BACKEND  = os.path.join(_REPO, 'backend')

sys.path.insert(0, _BACKEND)
# state.py resolves data paths relative to its own file, but some CSV helpers use
# the process cwd — run from backend/ to match how the app runs.
os.chdir(_BACKEND)

import core.state as S           # noqa: E402
import core.routes_events as RE  # noqa: E402


# ── read-only state load (avoids the schema-normalise + save that init_state does)
def _load_state_readonly():
    S.load()
    # init_state() would also normalise schemas and re-save the CSVs; we skip that
    # (read-only) but must still build the lookups the export helpers depend on.
    for fn in ('_refresh_youth_group_indexes', '_load_unreg_store'):
        try:
            getattr(S, fn)()
        except Exception:
            pass


# ── message text ──────────────────────────────────────────────────────────────
def _blank(v):
    v = (v or '').strip()
    return v if v else 'لا يوجد'


def _yg_display(label):
    label = (label or '').strip()
    return label[len('شبيبة '):] if label.startswith('شبيبة ') else label


def _next_grade(cur):
    cur = (cur or '').strip()
    order = RE.SCHOOL_GRADE_ORDER
    if cur in order:
        i = order.index(cur)
        if i + 1 < len(order):
            return order[i + 1]
    return ''


def _birthdate(raw):
    """The export gives YYYY-MM-DD — show it day-first."""
    raw = (raw or '').strip()
    parts = raw.split('-')
    if len(parts) == 3 and all(parts):
        return '-'.join(reversed(parts))
    return raw


def _phones(raw):
    """The export renders '079... (label), 078... (label)' — keep just the numbers."""
    import re
    if not raw:
        return ''
    nums = []
    for part in str(raw).split(','):
        m = re.match(r'\s*([0-9+]+)', part)
        if m:
            nums.append(m.group(1))
    return '، '.join(nums)


def _event_noun(event_type):
    return (event_type or '').strip() or 'النشاط'


def _def_noun(event_type):
    n = (event_type or '').strip() or 'النشاط'
    return n if n.startswith('ال') else 'ال' + n


def _format_message(evt, group, show_supervisors=True):
    event_type = evt.get('event_type')
    category   = evt.get('title_label') or ''
    noun       = _event_noun(event_type)
    def_noun   = _def_noun(event_type)

    L = []
    L.append('يسعد صباحكم،')
    L.append('نُحيطكم علمًا بتفاصيل المشاركين في %s %s من شبيبة %s:'
             % (noun, category, _yg_display(group['label'])))
    L.append('')
    L.append('عدد المشاركين المُعطى في المراسلة: %s' % group['given'])
    L.append('عدد المشاركين في %s: %s' % (def_noun, len(group['members'])))
    L.append('')
    for i, m in enumerate(group['members'], 1):
        L.append('%d. %s' % (i, m['name']))
        L.append('الجنس: %s' % _blank(m['gender']))
        L.append('تاريخ الميلاد: %s' % _blank(m['birthdate']))
        L.append('رقم الهاتف: %s' % _blank(m['phone']))
        if m['cur_grade']:
            L.append('الصف الحالي: %s - الصف القادم: %s'
                     % (m['cur_grade'], _blank(m['next_grade'])))
        L.append('الحالات الصحية: %s' % _blank(m['health']))
        L.append('ملاحظات: %s' % _blank(m['notes']))
        for label, value in m['extras']:
            L.append('%s: %s' % (label, value))
        L.append('')
    if show_supervisors:
        if group['supervisors']:
            L.append('المسؤولون المشاركون')
            for i, s in enumerate(group['supervisors'], 1):
                L.append('%d. %s' % (i, s['name']))
                L.append('الجنس: %s' % _blank(s['gender']))
                L.append('رقم الهاتف: %s' % _blank(s['phone']))
                L.append('الحالات الصحية: %s' % _blank(s['health']))
                L.append('ملاحظات: %s' % _blank(s['notes']))
                L.append('الحضور: %s' % _blank(s['attendance']))
                L.append('')
        else:
            L.append('لا يوجد مسؤول مرافق.')
            L.append('')
    L.append('دعم المواصلات:')
    L.append('سنرسل لكم تفاصيل دعم المواصلات في مراسلة لاحقة خلال اليومين القادمين.')
    return '\n'.join(L).rstrip()


# ── build a per-event data structure from the backend export helpers ──────────
def _build_event(evt):
    quotas    = evt.get('yg_quotas') or {}
    all_nights = evt.get('nights') or []
    mem_rows  = RE._build_member_export_rows(evt)
    sup_rows  = RE._build_supervisor_export_rows(evt)
    # custom (per-event) registration fields — (column header, field definition)
    _, mem_custom = RE._custom_export_columns(evt, 'members', RE.MEMBER_EXPORT_COLUMNS)

    reg = evt.get('registration', {})
    # export rows drop youth_group_id — realign with registration order to recover it
    for row, entry in zip(mem_rows, reg.get('members', [])):
        row['_yg'] = entry.get('youth_group_id')
    for row, entry in zip(sup_rows, reg.get('supervisors', [])):
        row['_yg']     = entry.get('youth_group_id')
        row['_nights'] = entry.get('nights_staying') or []

    yg_ids = {r['_yg'] for r in mem_rows} | {r['_yg'] for r in sup_rows}
    yg_ids = [y for y in yg_ids if y]

    def _num(y):
        import re
        m = re.search(r'(\d+)', y or '')
        return int(m.group(1)) if m else 10 ** 9
    yg_ids.sort(key=_num)

    groups = []
    for yid in yg_ids:
        label = RE._lookup_yg_label(yid) or yid
        members = []
        for r in (x for x in mem_rows if x['_yg'] == yid):
            cur = r.get('الصف الحالي') or ''
            members.append({
                'name': r.get('الاسم الكامل بالعربية'),
                'gender': r.get('الجنس'),
                'birthdate': _birthdate(r.get('تاريخ الميلاد الكامل')),
                'phone': _phones(r.get('رقم الهاتف')),
                'cur_grade': cur,
                'next_grade': _next_grade(cur),
                'health': r.get('الحالات الصحية') or '',
                'notes': r.get('ملاحظات الملف الشخصي') or '',
                # only the extra fields this member actually filled in
                'extras': [
                    (str(fld.get('label') or header).strip(), str(r.get(header)).strip())
                    for header, fld in mem_custom
                    if str(r.get(header) or '').strip()
                ],
            })
        supervisors = []
        for r in (x for x in sup_rows if x['_yg'] == yid):
            nights = r.get('_nights') or []
            full = len(all_nights) > 0 and len(nights) >= len(all_nights)
            supervisors.append({
                'name': r.get('الاسم الكامل بالعربية'),
                'gender': r.get('الجنس'),
                'phone': _phones(r.get('رقم الهاتف')),
                'health': r.get('الحالات الصحية') or '',
                'notes': r.get('ملاحظات الملف الشخصي') or '',
                'attendance': ('حضور كامل أيام %s' % _def_noun(evt.get('event_type')))
                              if full else '، '.join(nights),
            })
        g = {
            'id': yid,
            'label': _yg_display(label),
            'given': quotas.get(yid, 0) or 0,
            'members': members,
            'supervisors': supervisors,
        }
        groups.append(g)

    # no supervisor anywhere in the event → say nothing about supervisors at all
    show_supervisors = any(g['supervisors'] for g in groups)

    out_groups = []
    total = 0
    for g in groups:
        total += len(g['members'])
        out_groups.append({
            'id': g['id'],
            'label': g['label'],
            'given': g['given'],
            'incamp': len(g['members']),
            'supers': len(g['supervisors']),
            'msg': _format_message(evt, g, show_supervisors=show_supervisors),
        })
    return {
        'id': evt.get('id'),
        'category': evt.get('title_label') or '',
        'event_type': evt.get('event_type') or '',
        'noun_def': _def_noun(evt.get('event_type')),
        'groups': out_groups,
        'total_members': total,
    }


def build_all_events(only_event=None):
    data = RE._load_events()
    events = []
    for evt in data.get('events', []):
        if only_event and evt.get('id') != only_event:
            continue
        reg = evt.get('registration', {}) or {}
        if not (reg.get('members') or reg.get('supervisors')):
            continue
        built = _build_event(evt)
        if built['groups']:
            events.append(built)
    return events


# ── HTML page ─────────────────────────────────────────────────────────────────
_HTML = r'''<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>رسائل المشاركين حسب الشبيبة</title>
<style>
  :root{
    --bg:#F4F1EC; --panel:#FBFAF7; --card:#FFFFFF; --ink:#20302C; --muted:#6C7B75;
    --line:#E4DED3; --line-strong:#D3CCBE; --accent:#0E6B58; --accent-soft:#DCEEE7;
    --gold:#9A6B18; --ok:#0E6B58; --under:#9A3B2C;
    --radius:8px; --shadow:0 1px 2px rgba(30,42,38,.05),0 8px 24px rgba(30,42,38,.05);
  }
  @media (prefers-color-scheme:dark){
    :root{
      --bg:#121616; --panel:#171D1D; --card:#1C2323; --ink:#E7E5DD; --muted:#96A29B;
      --line:#2A3231; --line-strong:#374240; --accent:#4FB79C; --accent-soft:#173029;
      --gold:#D0A24E; --ok:#4FB79C; --under:#E08472;
      --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.28);
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:"Segoe UI","Noto Sans Arabic",Tahoma,"Geeza Pro",Arial,sans-serif;
    line-height:1.6;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1120px;margin:0 auto;padding:28px 20px 72px}
  header.top{display:flex;flex-wrap:wrap;align-items:flex-end;gap:16px 24px;
    padding-bottom:20px;border-bottom:1px solid var(--line-strong);margin-bottom:22px}
  .brand{display:flex;flex-direction:column;gap:4px}
  .eyebrow{font-size:12px;letter-spacing:.14em;color:var(--accent);font-weight:700}
  h1{margin:0;font-size:26px;font-weight:800;letter-spacing:-.01em;text-wrap:balance}
  .sub{color:var(--muted);font-size:14px}
  .top-stats{margin-inline-start:auto;display:flex;gap:10px;flex-wrap:wrap}
  .kpi{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);
    padding:8px 14px;min-width:88px;text-align:center}
  .kpi b{display:block;font-size:20px;font-variant-numeric:tabular-nums;line-height:1.2}
  .kpi span{font-size:11px;color:var(--muted)}
  .tools{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:20px}
  .field{display:flex;flex-direction:column;gap:5px}
  .field label{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.03em}
  select,.search input{padding:11px 14px;border:1px solid var(--line-strong);
    border-radius:var(--radius);background:var(--card);color:var(--ink);font-size:15px;
    font-family:inherit}
  select{min-width:260px;cursor:pointer}
  .search{flex:1;min-width:200px;position:relative;display:flex;flex-direction:column;gap:5px}
  .search .ico{position:relative}
  .search input{width:100%;padding-inline-start:40px}
  .search svg{position:absolute;inset-inline-start:12px;top:50%;transform:translateY(-50%);color:var(--muted)}
  select:focus,.search input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
  .btn{font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;border-radius:var(--radius);
    border:1px solid var(--line-strong);background:var(--card);color:var(--ink);padding:10px 16px;
    display:inline-flex;align-items:center;gap:7px;transition:background .15s,border-color .15s}
  .btn:hover{border-color:var(--accent)}
  .btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .align-end{align-self:flex-end}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:18px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
    box-shadow:var(--shadow);display:flex;flex-direction:column;overflow:hidden}
  .card.hidden{display:none}
  .chead{padding:16px 18px 14px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:12px}
  .ctitle{display:flex;align-items:flex-start;gap:10px;justify-content:space-between}
  .ctitle h2{margin:0;font-size:17px;font-weight:800;line-height:1.35;text-wrap:balance}
  .ygid{flex:none;font-size:11px;font-weight:700;color:var(--muted);background:var(--panel);
    border:1px solid var(--line);border-radius:5px;padding:2px 7px;letter-spacing:.04em;
    font-variant-numeric:tabular-nums;direction:ltr}
  .stats{display:flex;gap:8px;flex-wrap:wrap}
  .stat{display:flex;align-items:baseline;gap:6px;font-size:12.5px;padding:5px 10px;
    border-radius:6px;background:var(--panel);border:1px solid var(--line)}
  .stat b{font-size:15px;font-weight:800;font-variant-numeric:tabular-nums}
  .stat.given b{color:var(--gold)}
  .delta{font-size:11px;font-weight:700;padding:5px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;border:1px solid transparent}
  .delta.over{color:var(--ok);background:var(--accent-soft)}
  .delta.eq{color:var(--muted);background:var(--panel);border-color:var(--line)}
  .delta.under{color:var(--under);background:color-mix(in srgb,var(--under) 12%,transparent)}
  .msg{margin:0;padding:14px 18px;font-size:12.5px;line-height:1.7;color:var(--ink);
    white-space:pre-wrap;unicode-bidi:plaintext;max-height:220px;overflow:auto;
    border-bottom:1px solid var(--line);background:var(--panel);flex:1;
    font-family:"Segoe UI","Noto Sans Arabic",Tahoma,Arial,sans-serif}
  .msg.full{max-height:none}
  .cfoot{padding:12px 18px;display:flex;gap:10px;align-items:center}
  .copy{flex:1;justify-content:center;background:var(--accent);color:#fff;border-color:var(--accent)}
  .copy:hover{background:color-mix(in srgb,var(--accent) 88%,#000);border-color:var(--accent)}
  .copy.done{background:var(--ok);border-color:var(--ok)}
  .toggle{color:var(--muted)}
  .empty{color:var(--muted);text-align:center;padding:40px;grid-column:1/-1}
  .stamp{margin-top:28px;color:var(--muted);font-size:12px;text-align:center}
  @media (max-width:640px){.grid{grid-template-columns:1fr}h1{font-size:22px}select{min-width:0;width:100%}}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand">
      <span class="eyebrow">JEC Jordan · رسائل الشبيبات</span>
      <h1>رسائل المشاركين حسب الشبيبة</h1>
      <span class="sub" id="subline">اختر الحدث لعرض الرسائل</span>
    </div>
    <div class="top-stats">
      <div class="kpi"><b id="kpiGroups">0</b><span>شبيبة</span></div>
      <div class="kpi"><b id="kpiMembers">0</b><span>مشارك</span></div>
    </div>
  </header>

  <div class="tools">
    <div class="field">
      <label for="evt">الحدث</label>
      <select id="evt"></select>
    </div>
    <div class="search">
      <label for="q">بحث</label>
      <div class="ico">
        <input id="q" type="search" placeholder="ابحث عن شبيبة…" autocomplete="off">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      </div>
    </div>
    <button class="btn align-end" id="expandAll" type="button">عرض النص كاملاً</button>
  </div>

  <div class="grid" id="grid"></div>
  <div class="empty" id="empty" style="display:none">لا توجد شبيبة مطابقة.</div>
  <div class="stamp" id="stamp"></div>
</div>

<script>
const EVENTS = __PAYLOAD__;
const GENERATED_AT = "__STAMP__";
const grid = document.getElementById('grid');
const evtSel = document.getElementById('evt');
let expanded = false;

EVENTS.forEach((e, i) => {
  const o = document.createElement('option');
  o.value = i;
  const t = [e.event_type, e.category].filter(Boolean).join(' ');
  o.textContent = e.id + (t ? ' — ' + t : '');
  evtSel.appendChild(o);
});

function deltaEl(g){
  const d = g.incamp - g.given;
  if (g.incamp === 0 && g.supers > 0) return '<span class="delta eq">مسؤولون فقط</span>';
  if (d > 0)  return '<span class="delta over">+'+d+' عن العدد المُعطى</span>';
  if (d === 0) return '<span class="delta eq">مطابق للعدد المُعطى</span>';
  return '<span class="delta under">'+d+' عن العدد المُعطى</span>';
}

function render(ei){
  const e = EVENTS[ei];
  grid.innerHTML = '';
  document.getElementById('subline').textContent =
    e.groups.length ? (e.event_type + ' ' + e.category + ' — رسالة جاهزة للنسخ لكل شبيبة') : 'لا يوجد مشاركون في هذا الحدث';
  document.getElementById('kpiGroups').textContent = e.groups.length;
  document.getElementById('kpiMembers').textContent = e.groups.reduce((a,g)=>a+g.incamp,0);

  e.groups.forEach((g, idx) => {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.name = g.label;
    card.innerHTML =
      '<div class="chead"><div class="ctitle"><h2>'+g.label+'</h2>'
      + '<span class="ygid">'+g.id+'</span></div><div class="stats">'
      + '<span class="stat given">معطى <b>'+g.given+'</b></span>'
      + '<span class="stat">مشاركون <b>'+g.incamp+'</b></span>'
      + (g.supers ? '<span class="stat">مسؤولون <b>'+g.supers+'</b></span>' : '')
      + deltaEl(g) + '</div></div>'
      + '<pre class="msg'+(expanded?' full':'')+'"></pre>'
      + '<div class="cfoot"><button class="btn copy" type="button" data-i="'+idx+'">'
      + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>'
      + '<span class="lbl">نسخ الرسالة</span></button>'
      + '<button class="btn toggle" type="button" data-t="'+idx+'">…</button></div>';
    card.querySelector('.msg').textContent = g.msg;
    grid.appendChild(card);
  });
  applyFilter();
}

function applyFilter(){
  const q = document.getElementById('q').value.trim();
  let shown = 0;
  document.querySelectorAll('.card').forEach(c => {
    const hit = !q || c.dataset.name.includes(q);
    c.classList.toggle('hidden', !hit);
    if (hit) shown++;
  });
  document.getElementById('empty').style.display = shown ? 'none' : 'block';
}

grid.addEventListener('click', async (ev) => {
  const cp = ev.target.closest('.copy');
  if (cp){
    const g = EVENTS[+evtSel.value].groups[+cp.dataset.i];
    try { await navigator.clipboard.writeText(g.msg); }
    catch { const t=document.createElement('textarea'); t.value=g.msg;
      document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    cp.classList.add('done'); cp.querySelector('.lbl').textContent='تم النسخ ✓';
    setTimeout(()=>{cp.classList.remove('done');cp.querySelector('.lbl').textContent='نسخ الرسالة';},1600);
    return;
  }
  const tg = ev.target.closest('.toggle');
  if (tg){ tg.closest('.card').querySelector('.msg').classList.toggle('full'); }
});

evtSel.addEventListener('change', () => render(+evtSel.value));
document.getElementById('q').addEventListener('input', applyFilter);
document.getElementById('expandAll').addEventListener('click', (e) => {
  expanded = !expanded;
  document.querySelectorAll('.msg').forEach(m => m.classList.toggle('full', expanded));
  e.target.textContent = expanded ? 'تصغير النص' : 'عرض النص كاملاً';
});

document.getElementById('stamp').textContent = 'أُنشئت هذه الصفحة في ' + GENERATED_AT + ' — أعد تشغيل الأداة لتحديث البيانات.';

// default to the event with the most participants
let best = 0, bestN = -1;
EVENTS.forEach((e,i)=>{const n=e.groups.reduce((a,g)=>a+g.incamp,0); if(n>bestN){bestN=n;best=i;}});
if (EVENTS.length){ evtSel.value = best; render(best); }
else { grid.innerHTML = '<div class="empty">لا توجد أحداث بها مشاركون.</div>'; }
</script>
</body>
</html>'''


def build_html(events):
    from datetime import datetime
    payload = json.dumps(events, ensure_ascii=False)
    stamp = datetime.now().strftime('%Y-%m-%d %H:%M')
    return _HTML.replace('__PAYLOAD__', payload).replace('__STAMP__', stamp)


def main():
    ap = argparse.ArgumentParser(description='Generate youth-group participant messages for an event.')
    ap.add_argument('--event', help='Only this event id (e.g. EVT000003). Default: all events.')
    ap.add_argument('--out', help='Output HTML path. Default: tools/event_messages.html')
    ap.add_argument('--no-open', action='store_true', help='Do not open the page in a browser.')
    ap.add_argument('--list', action='store_true', help='List events with participants and exit.')
    args = ap.parse_args()

    _load_state_readonly()

    if args.list:
        for e in build_all_events():
            print('%s  %-6s %-12s  شبيبات=%d  مشاركون=%d'
                  % (e['id'], e['event_type'], e['category'], len(e['groups']), e['total_members']))
        return

    events = build_all_events(only_event=args.event)
    if not events:
        print('No events with participants found%s.'
              % (' for ' + args.event if args.event else ''))
        sys.exit(1)

    out = args.out or os.path.join(_THIS_DIR, 'event_messages.html')
    out = os.path.abspath(out)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(build_html(events))

    print('Generated %d event(s):' % len(events))
    for e in events:
        print('  %s  %s %s  —  %d شبيبة, %d مشارك'
              % (e['id'], e['event_type'], e['category'], len(e['groups']), e['total_members']))
    print('Wrote: %s' % out)

    if not args.no_open:
        try:
            webbrowser.open('file:///' + out.replace('\\', '/'))
        except Exception:
            pass


if __name__ == '__main__':
    main()
