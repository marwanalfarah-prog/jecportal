import re
import threading
import uuid

from flask import jsonify, request

from core import state as S
from core.routes_auth import _current_user, _get_person_name, _load_auth, _require_admin
from core.routes_org_tree import GS_GROUP_ID, _load_index, _load_tree_data
from core.routes_promotions import _now_str


QUESTIONNAIRES_PATH = S.db.questionnaires_path
q_lock = threading.Lock()

NOTIFICATIONS_PATH = S.db.notifications_path
notif_lock = S.notif_lock  # shared across all modules — prevents concurrent write corruption


def _load_questionnaires() -> dict:
    data = S.db.load_questionnaires()
    changed = False
    for q in data.get("questionnaires", []):
        group_list = q.get("target_youth_groups") or []
        new_ids = []
        for g in group_list:
            gid = S.youth_group_id(g, create=True)
            if gid:
                new_ids.append(gid)
        if new_ids != group_list:
            q["target_youth_groups"] = new_ids
            changed = True

        single = q.get("target_youth_group")
        if single is not None:
            single_id = S.youth_group_id(single, create=True)
            if single_id != single:
                q["target_youth_group"] = single_id
                changed = True

        names = [S.youth_group_name(gid) or gid for gid in (q.get("target_youth_groups") or [])]
        if q.get("target_youth_group_names") != names:
            q["target_youth_group_names"] = names
            changed = True

    if changed:
        _save_questionnaires(data)
    return data


def _save_questionnaires(data: dict):
    S.db.save_questionnaires(data)


def _q_id() -> str:
    return str(uuid.uuid4())[:12]


AGE_GROUPS_PY_Q = ['البراعم', 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']
ACTING_PREFIX_PY = 'قائم بأعمال '


def _role_matches_questionnaire(person_role: str, q: dict) -> bool:
    if not person_role:
        return False
    tab = q.get("role_tab")
    if not tab:
        return False

    role = person_role
    if role.startswith(ACTING_PREFIX_PY):
        role = role[len(ACTING_PREFIX_PY):]

    if tab == 'gm':
        gm_role = q.get('role_member_type') or ''
        valid_gm = ['المسؤول العام', 'نائب المسؤول العام', 'مستشار الشبيبة']
        if gm_role and gm_role in valid_gm:
            return role == gm_role
        return role in valid_gm

    if tab == 'spiritual':
        if role in ['المرشد الروحي', 'مساعد المرشد الروحي']:
            return True
        if role.startswith('مرشد روحي '):
            groups = q.get("role_groups") or []
            if not groups:
                return True
            return any(g in role for g in groups)
        return False

    if tab == 'secretaries':
        member_type = q.get('role_member_type') or ''
        is_assistant = member_type == 'مساعد'
        base_roles = ['أمين الصندوق', 'أمين السر', 'أمين العهدة']
        assistant_roles = ['مساعد أمين الصندوق', 'مساعد أمين السر', 'مساعد أمين العهدة']
        if member_type and member_type in base_roles:
            sec_check = [member_type]
            if is_assistant:
                sec_check = [f'مساعد {member_type}']
            return role in sec_check
        if is_assistant:
            return role in assistant_roles
        return role in base_roles + assistant_roles

    if tab == 'agegroup':
        groups = q.get("role_groups") or []
        member_type = q.get("role_member_type") or ""
        is_agegroup_role = (
            any(role.startswith(f'مسؤول {gw} ') for gw in ['فئة', 'فئتيّ', 'فئات']) or
            any(role.startswith(f'مجلس {gw} ') for gw in ['فئة', 'فئتيّ', 'فئات']) or
            any(role.startswith(f'مسؤول مساعد في {gw} ') for gw in ['فئة', 'فئتيّ', 'فئات'])
        )
        if not is_agegroup_role:
            return False
        if member_type:
            if member_type == 'مسؤول' and not any(role.startswith(f'مسؤول {gw} ') for gw in ['فئة', 'فئتيّ', 'فئات']):
                return False
            if member_type == 'عضو مجلس' and not any(role.startswith(f'مجلس {gw} ') for gw in ['فئة', 'فئتيّ', 'فئات']):
                return False
            if member_type == 'مسؤول مساعد' and not any(role.startswith(f'مسؤول مساعد في {gw} ') for gw in ['فئة', 'فئتيّ', 'فئات']):
                return False
        if groups:
            return any(g in role for g in groups)
        return True

    if tab == 'committee':
        committees = q.get("role_committees") or []
        if not committees:
            return True
        return any(c in role for c in committees)

    return False


def _safe_yg(name: str) -> str:
    return re.sub(r'[^\w\u0600-\u06FF]', '_', name) if name else ''


def _get_person_org_roles(person_type: str, person_id) -> list[tuple[str, str]]:
    results = []
    pid_str = str(person_id)
    group_ids = [opt["value"] for opt in S.youth_group_options()]
    group_ids.append(GS_GROUP_ID)
    for group_id in group_ids:
        periods = _load_index(group_id)
        active = next((p for p in periods if not p.get('to_date')), None)
        if not active:
            continue
        tree_data = _load_tree_data(group_id, active['id'])
        nodes = tree_data.get('nodes', [])
        for node in nodes:
            np_type = node.get('personType', '')
            np_id = str(node.get('personId', ''))
            if np_id == pid_str:
                if person_type == 'registered' and np_type not in ('مكرّس', '') or person_type == 'unregistered':
                    pass
                role = node.get('role', '')
                if role:
                    results.append((group_id, role))
    return results


def _person_has_questionnaire_access(u: dict) -> bool:
    data = _load_questionnaires()
    person_id = u.get('person_id')
    person_type = u.get('person_type')

    for q in data['questionnaires']:
        if not q.get('active', True):
            continue

        if q.get('target_type') == 'person':
            if str(q.get('target_person_id', '')) == str(person_id) and q.get('target_person_type') == person_type:
                return True

        elif q.get('target_type') == 'role':
            roles = _get_person_org_roles(person_type, person_id)
            for (yg, role) in roles:
                tg_list = q.get('target_youth_groups') or []
                tg_single = q.get('target_youth_group')
                yg_id = S.youth_group_id(yg)
                if tg_list:
                    if yg_id not in tg_list:
                        continue
                elif tg_single:
                    if tg_single != yg_id:
                        continue
                if _role_matches_questionnaire(role, q):
                    return True

    return False


def _username_to_person_id(username: str):
    if not username:
        return None
    auth_data = _load_auth()
    user = next((u for u in auth_data.get('users', []) if u.get('username') == username), None)
    if not user:
        return None
    return S._normalize_person_id(user.get('person_id'))


def _normalize_notification_record(n: dict) -> dict:
    normalized = dict(n)

    if 'for_person_id' not in normalized:
        normalized['for_person_id'] = _username_to_person_id(normalized.get('for_username'))

    if 'for_username' in normalized and normalized.get('for_username') is not None:
        normalized['for_username'] = str(normalized.get('for_username')).strip().lower() or None

    if 'respondent_person_id' not in normalized:
        normalized['respondent_person_id'] = _username_to_person_id(normalized.get('respondent_username'))

    normalized.pop('respondent_username', None)
    normalized.pop('respondent_name', None)
    return normalized


def _notification_belongs_to_user(notification: dict, user: dict) -> bool:
    notif_for_username = notification.get('for_username')
    if notif_for_username is not None:
        return str(notif_for_username).strip().lower() == str(user.get('username') or '').strip().lower()

    my_person_id = S._normalize_person_id(user.get('person_id'))
    notif_for_person_id = S._normalize_person_id(notification.get('for_person_id'))
    return notif_for_person_id == my_person_id or (my_person_id is None and notification.get('for_person_id') is None)


def _load_notifications() -> dict:
    data = S.db.load_notifications()
    notifications = data.get('notifications', [])
    normalized_notifications = [_normalize_notification_record(n) for n in notifications]
    if normalized_notifications != notifications:
        normalized_data = {'notifications': normalized_notifications}
        _save_notifications(normalized_data)
        return normalized_data
    return data


def _save_notifications(data: dict):
    S.db.save_notifications(data)


def _person_name_from_id(person_id, person_type=None) -> str | None:
    normalized = S._normalize_person_id(person_id)
    if normalized is None:
        return None
    return _get_person_name(person_type, normalized)


def _person_has_questionnaire_for_q(u: dict, q: dict) -> bool:
    if not q.get('active', True):
        return False
    person_id = u.get('person_id')
    person_type = u.get('person_type')

    if q.get('target_type') == 'person':
        return str(q.get('target_person_id', '')) == str(person_id) and q.get('target_person_type') == person_type

    elif q.get('target_type') == 'role':
        roles = _get_person_org_roles(person_type, person_id)
        for (yg, role) in roles:
            tg_list = q.get('target_youth_groups') or []
            tg_single = q.get('target_youth_group')
            yg_id = S.youth_group_id(yg)
            if tg_list:
                if yg_id not in tg_list:
                    continue
            elif tg_single:
                if tg_single != yg_id:
                    continue
            if _role_matches_questionnaire(role, q):
                return True

    return False


def _create_questionnaire_notifications(q: dict):
    notifs = _load_notifications()
    auth_data = _load_auth()

    for user in auth_data['users']:
        if user['role'] == 'admin':
            continue
        if _person_has_questionnaire_for_q(user, q):
            notif = {
                "id": _q_id(),
                "type": "new_questionnaire",
                "for_person_id": S._normalize_person_id(user.get('person_id')),
                "questionnaire_id": q['id'],
                "questionnaire_title": q['title'],
                "respondent_person_id": None,
                "response_summary": None,
                "read": False,
                "created_at": _now_str(),
            }
            notifs['notifications'].append(notif)

    with notif_lock:
        _save_notifications(notifs)


def _create_response_notification(qid: str, q: dict, respondent_user: dict):
    resp_person_id = S._normalize_person_id(respondent_user.get('person_id'))
    resp_username = respondent_user.get('username')

    data = _load_questionnaires()
    response = next((
        r for r in data['responses']
        if r['questionnaire_id'] == qid
        and (
            S._normalize_person_id(r.get('respondent_person_id')) == resp_person_id
            or (resp_person_id is None and r.get('respondent_username') == resp_username)
        )
    ), None)
    summary = ""
    if response and response.get('answers'):
        questions = {qn['id']: qn['text'] for qn in q.get('questions', [])}
        parts = []
        raw_answers = response['answers']
        if isinstance(raw_answers, dict):
            answers_list = [{'question_id': k, 'answer': v} for k, v in raw_answers.items()]
        else:
            answers_list = raw_answers if isinstance(raw_answers, list) else []
        for ans in answers_list[:2]:
            qtext = questions.get(ans.get('question_id', ''), '')
            atext = ans.get('answer', '')
            if isinstance(atext, list):
                atext = '، '.join(str(x) for x in atext)
            if qtext and atext:
                parts.append(f"{qtext}: {atext}")
        summary = ' | '.join(parts)

    with notif_lock:
        notifs = _load_notifications()
        auth_data = _load_auth()
        admins = [u for u in auth_data['users'] if u['role'] == 'admin']

        for admin in admins:
            existing = next((n for n in notifs['notifications']
                             if n['type'] == 'questionnaire_response'
                             and (
                                 (
                                     n.get('for_username') is not None
                                     and str(n.get('for_username')).strip().lower() == str(admin.get('username') or '').strip().lower()
                                 )
                                 or (
                                     n.get('for_username') is None
                                     and S._normalize_person_id(n.get('for_person_id')) == S._normalize_person_id(admin.get('person_id'))
                                 )
                                 or (
                                     n.get('for_username') is None
                                     and S._normalize_person_id(admin.get('person_id')) is None
                                     and n.get('for_person_id') is None
                                 )
                             )
                             and n['questionnaire_id'] == qid
                             and S._normalize_person_id(n.get('respondent_person_id')) == resp_person_id
                             and not n['read']), None)
            if existing:
                existing['response_summary'] = summary
                existing['created_at'] = _now_str()
            else:
                notif = {
                    "id": _q_id(),
                    "type": "questionnaire_response",
                    "for_person_id": S._normalize_person_id(admin.get('person_id')),
                    "for_username": str(admin.get('username') or '').strip().lower() or None,
                    "questionnaire_id": qid,
                    "questionnaire_title": q.get('title', ''),
                    "respondent_person_id": resp_person_id,
                    "response_summary": summary,
                    "read": False,
                    "created_at": _now_str(),
                }
                notifs['notifications'].append(notif)

        _save_notifications(notifs)


def register_questionnaires_notifications_routes(app):
    @app.get("/api/questionnaires")
    def list_questionnaires():
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        data = _load_questionnaires()

        if u['role'] == 'admin':
            return jsonify({"questionnaires": data['questionnaires']})

        person_id = u.get('person_id')
        person_type = u.get('person_type')
        applicable = []

        for q in data['questionnaires']:
            if not q.get('active', True):
                continue

            if q.get('target_type') == 'person':
                if str(q.get('target_person_id', '')) == str(person_id) and q.get('target_person_type') == person_type:
                    applicable.append(q)

            elif q.get('target_type') == 'role':
                roles = _get_person_org_roles(person_type, person_id)
                for (yg, role) in roles:
                    tg_list = q.get('target_youth_groups') or []
                    tg_single = q.get('target_youth_group')
                    yg_id = S.youth_group_id(yg)
                    if tg_list:
                        if yg_id not in tg_list:
                            continue
                    elif tg_single:
                        if tg_single != yg_id:
                            continue
                    if _role_matches_questionnaire(role, q):
                        applicable.append(q)
                        break

        my_person_id = S._normalize_person_id(u.get('person_id'))
        responded_qids = {
            r['questionnaire_id']
            for r in data['responses']
            if (
                S._normalize_person_id(r.get('respondent_person_id')) == my_person_id
                or (my_person_id is None and r.get('respondent_username') == u['username'])
            )
        }
        for q in applicable:
            q['already_responded'] = q['id'] in responded_qids

        return jsonify({"questionnaires": applicable})

    @app.post("/api/questionnaires")
    def create_questionnaire():
        err = _require_admin()
        if err:
            return err
        u = _current_user()
        body = request.json or {}
        target_group_ids = [S.youth_group_id(g, create=True) or g for g in (body.get("target_youth_groups", []) or [])]
        target_group_ids = [g for g in target_group_ids if g]
        target_group_single = S.youth_group_id(body.get("target_youth_group"), create=True) if body.get("target_youth_group") else None

        new_q = {
            "id": _q_id(),
            "title": body.get("title", ""),
            "description": body.get("description", ""),
            "created_by": u["username"],
            "created_at": _now_str(),
            "updated_at": _now_str(),
            "active": body.get("active", True),
            "target_type": body.get("target_type", "role"),
            "role_tab": body.get("role_tab"),
            "role_groups": body.get("role_groups"),
            "role_member_type": body.get("role_member_type"),
            "role_committees": body.get("role_committees"),
            "target_youth_group": target_group_single,
            "target_youth_groups": target_group_ids,
            "target_youth_group_names": [S.youth_group_name(gid) or gid for gid in target_group_ids],
            "role_is_acting": body.get("role_is_acting", False),
            "role": body.get("role"),
            "target_person_id": body.get("target_person_id"),
            "target_person_type": body.get("target_person_type"),
            "target_person_name": body.get("target_person_name"),
            "questions": body.get("questions", []),
        }

        with q_lock:
            data = _load_questionnaires()
            data["questionnaires"].append(new_q)
            _save_questionnaires(data)

        _create_questionnaire_notifications(new_q)

        return jsonify({"ok": True, "questionnaire": new_q})

    @app.put("/api/questionnaires/<qid>")
    def update_questionnaire(qid):
        err = _require_admin()
        if err:
            return err
        body = request.json or {}

        with q_lock:
            data = _load_questionnaires()
            q = next((x for x in data['questionnaires'] if x['id'] == qid), None)
            if not q:
                return jsonify({"error": "not found"}), 404
            for field in ["title", "description", "active", "target_type", "role_tab", "role_groups", "role_member_type", "role_committees", "role_is_acting", "target_youth_group", "target_youth_groups", "role", "target_person_id", "target_person_type", "target_person_name", "questions"]:
                if field in body:
                    q[field] = body[field]
            q["target_youth_groups"] = [S.youth_group_id(g, create=True) or g for g in (q.get("target_youth_groups") or []) if (S.youth_group_id(g, create=True) or g)]
            q["target_youth_group"] = S.youth_group_id(q.get("target_youth_group"), create=True) if q.get("target_youth_group") else None
            q["target_youth_group_names"] = [S.youth_group_name(gid) or gid for gid in (q.get("target_youth_groups") or [])]
            q["updated_at"] = _now_str()
            _save_questionnaires(data)

        return jsonify({"ok": True, "questionnaire": q})

    @app.delete("/api/questionnaires/<qid>")
    def delete_questionnaire(qid):
        err = _require_admin()
        if err:
            return err

        with q_lock:
            data = _load_questionnaires()
            data['questionnaires'] = [x for x in data['questionnaires'] if x['id'] != qid]
            data['responses'] = [r for r in data['responses'] if r['questionnaire_id'] != qid]
            notifs = _load_notifications()
            notifs['notifications'] = [n for n in notifs['notifications'] if not (n.get('questionnaire_id') == qid)]
            _save_notifications(notifs)
            _save_questionnaires(data)

        return jsonify({"ok": True})

    @app.get("/api/questionnaires/<qid>/responses")
    def get_questionnaire_responses(qid):
        err = _require_admin()
        if err:
            return err

        data = _load_questionnaires()
        q = next((x for x in data['questionnaires'] if x['id'] == qid), None)
        responses = [r for r in data['responses'] if r['questionnaire_id'] == qid]

        for resp in responses:
            raw = resp.get('answers', [])
            if isinstance(raw, dict):
                raw = [{'question_id': k, 'answer': v} for k, v in raw.items()]
            if not isinstance(raw, list):
                raw = []

            if len(raw) == 1 and isinstance(raw[0], dict) and raw[0].get('question_id') == 'answers' and isinstance(raw[0].get('answer'), list):
                raw = raw[0]['answer']

            clean = []
            for item in raw:
                if not isinstance(item, dict):
                    continue
                ans_val = item.get('answer')
                if isinstance(ans_val, dict) and 'answer' in ans_val:
                    ans_val = ans_val['answer']
                clean.append({'question_id': item.get('question_id', ''), 'answer': ans_val})
            resp['answers'] = clean
            resp['respondent_name'] = _person_name_from_id(resp.get('respondent_person_id'), resp.get('respondent_person_type'))

        return jsonify({"responses": responses, "questionnaire": q})

    @app.post("/api/questionnaires/<qid>/respond")
    def submit_response(qid):
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        body = request.json or {}
        raw_answers = body.get("answers", [])
        if isinstance(raw_answers, dict):
            answers = [{'question_id': k, 'answer': v} for k, v in raw_answers.items()]
        else:
            answers = raw_answers if isinstance(raw_answers, list) else []

        with q_lock:
            data = _load_questionnaires()
            q = next((x for x in data['questionnaires'] if x['id'] == qid), None)
            if not q:
                return jsonify({"error": "not found"}), 404

            my_person_id = S._normalize_person_id(u.get('person_id'))
            existing = next((
                r for r in data['responses']
                if r['questionnaire_id'] == qid
                and (
                    S._normalize_person_id(r.get('respondent_person_id')) == my_person_id
                    or (my_person_id is None and r.get('respondent_username') == u['username'])
                )
            ), None)
            if existing:
                existing['answers'] = answers
                existing['submitted_at'] = _now_str()
                existing['read_by_admin'] = False
            else:
                response = {
                    "id": _q_id(),
                    "questionnaire_id": qid,
                    "respondent_person_id": my_person_id,
                    "respondent_person_type": u.get('person_type', ''),
                    "submitted_at": _now_str(),
                    "answers": answers,
                    "read_by_admin": False,
                }
                data['responses'].append(response)

            _save_questionnaires(data)

        _create_response_notification(qid, q, u)

        return jsonify({"ok": True})

    @app.patch("/api/questionnaires/responses/<resp_id>/read")
    def mark_response_read(resp_id):
        err = _require_admin()
        if err:
            return err

        with q_lock:
            data = _load_questionnaires()
            r = next((x for x in data['responses'] if x['id'] == resp_id), None)
            if not r:
                return jsonify({"error": "not found"}), 404
            r['read_by_admin'] = True
            _save_questionnaires(data)

        return jsonify({"ok": True})

    @app.get("/api/notifications")
    def get_notifications():
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        notifs = _load_notifications()
        my_notifs = [
            n for n in notifs['notifications']
            if _notification_belongs_to_user(n, u)
        ]
        for n in my_notifs:
            n['respondent_name'] = _person_name_from_id(n.get('respondent_person_id'))
        my_notifs.sort(key=lambda n: n.get('created_at', ''), reverse=True)
        unread_count = sum(1 for n in my_notifs if not n['read'])

        return jsonify({"notifications": my_notifs, "unread_count": unread_count})

    @app.patch("/api/notifications/<nid>/read")
    def mark_notification_read(nid):
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        with notif_lock:
            notifs = _load_notifications()
            n = next((
                x for x in notifs['notifications']
                if x['id'] == nid and _notification_belongs_to_user(x, u)
            ), None)
            if not n:
                return jsonify({"error": "not found"}), 404
            n['read'] = True
            _save_notifications(notifs)

        return jsonify({"ok": True})

    @app.patch("/api/notifications/<nid>/unread")
    def mark_notification_unread(nid):
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        with notif_lock:
            notifs = _load_notifications()
            n = next((
                x for x in notifs['notifications']
                if x['id'] == nid and _notification_belongs_to_user(x, u)
            ), None)
            if not n:
                return jsonify({"error": "not found"}), 404
            n['read'] = False
            _save_notifications(notifs)

        return jsonify({"ok": True})

    @app.delete("/api/notifications/<nid>")
    def delete_notification(nid):
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        with notif_lock:
            notifs = _load_notifications()
            idx = next((
                i for i, x in enumerate(notifs['notifications'])
                if x['id'] == nid and _notification_belongs_to_user(x, u)
            ), None)
            if idx is None:
                return jsonify({"error": "not found"}), 404

            notifs['notifications'].pop(idx)
            _save_notifications(notifs)

        return jsonify({"ok": True})

    @app.patch("/api/notifications/read-all")
    def mark_all_notifications_read():
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        with notif_lock:
            notifs = _load_notifications()
            for n in notifs['notifications']:
                if _notification_belongs_to_user(n, u):
                    n['read'] = True
            _save_notifications(notifs)

        return jsonify({"ok": True})

    @app.get("/api/debug/responses/<qid>")
    def debug_responses(qid):
        data = _load_questionnaires()
        responses = [r for r in data['responses'] if r['questionnaire_id'] == qid]
        import json as _j
        return app.response_class(_j.dumps(responses, ensure_ascii=False, indent=2), mimetype='application/json')
