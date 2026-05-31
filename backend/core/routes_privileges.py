import uuid
from datetime import datetime

from flask import jsonify, request

from core import state as S
import core.privilege_store as PS
from core.routes_auth import (
    _current_user, _require_admin, _load_auth,
    _get_person_youth_groups, _get_council_access,
    _classify_role_py, AGE_GROUPS_PY,
)
from core.routes_org_tree import _extract_node_identity, _load_index, _load_tree_data

# Convenience aliases so the rest of this module stays readable
_load_overrides  = PS.load
_save_overrides  = PS.save
_apply_overrides_for_user = PS.apply_overrides   # (username, computed) -> effective
_priv_lock       = PS.load_lock()


def _get_all_org_positions():
    """Return all privilege-granting positions from all org trees."""
    result = []
    groups = S.youth_group_options()

    for option in groups:
        group_id = str(option.get("value") or "").strip()
        if not group_id:
            continue
        group_name = S.youth_group_display_label(group_id)

        try:
            periods = _load_index(group_id)
            if not periods:
                continue
            active = next((p for p in periods if not p.get("to_date")), None)
            if not active:
                active = sorted(periods, key=lambda p: p.get("from_date") or "", reverse=True)[0]

            tree = _load_tree_data(group_id, active["id"])
            nodes_with_priv = []

            for node in tree.get("nodes", []):
                role_title = (node.get("role") or "").strip()
                if not role_title:
                    continue

                classified = _classify_role_py(role_title)
                if not classified:
                    continue

                node_pid, node_unregistered = _extract_node_identity(node)
                is_full = bool(classified.get("full_group"))
                age_groups = classified.get("age_groups", []) if not is_full else AGE_GROUPS_PY

                nodes_with_priv.append({
                    "person_id": node_pid,
                    "person_type": "unregistered" if node_unregistered else "registered",
                    "display_name": node.get("name", ""),
                    "role_title": role_title,
                    "tier": classified.get("tier", ""),
                    "full_group": is_full,
                    "age_groups": age_groups,
                })

            if nodes_with_priv:
                result.append({
                    "group_id": group_id,
                    "group_name": group_name,
                    "nodes": nodes_with_priv,
                })
        except Exception as e:
            print(f"Warning: privilege position scan failed for {group_id}: {e}")
            continue

    return result



def _compute_capabilities(user: dict, effective_council: dict) -> list:
    """Derive the full list of functional capabilities for a user."""
    role           = user.get("role", "member")
    is_admin       = role == "admin"
    account_status = user.get("account_status") or "active"
    is_pending     = account_status in ("pending", "pending_yg")
    is_active      = account_status == "active" and not is_pending
    has_person     = user.get("person_id") is not None and user.get("person_type") is not None

    has_council        = bool(effective_council)
    has_full_council   = any(info.get("full_group") for info in effective_council.values())
    council_names      = "، ".join(
        info.get("group_name") or S.youth_group_display_label(gid) for gid, info in effective_council.items()
    ) if effective_council else ""

    def cap(id_, label, category, granted, source=None, scope=None, detail=""):
        return {
            "id":       id_,
            "label":    label,
            "category": category,
            "granted":  bool(granted),
            "source":   source if granted else None,
            "scope":    scope,
            "detail":   detail,
        }

    return [
        # ── النظام ──────────────────────────────────────────────────────────────
        cap("dashboard",       "لوحة المعلومات والإحصاءات",           "النظام",
            is_admin, "role", "full"),
        cap("manage_users",    "إدارة حسابات المستخدمين",             "النظام",
            is_admin, "role", "full"),
        cap("manage_config",   "إعدادات النظام والتهيئة",             "النظام",
            is_admin, "role", "full"),
        cap("manage_org_tree", "تعديل الهيكل التنظيمي",               "النظام",
            is_admin, "role", "full"),
        cap("privilege_mgr",   "إدارة صلاحيات المناصب",               "النظام",
            is_admin, "role", "full"),

        # ── إدارة الأعضاء ────────────────────────────────────────────────────────
        cap("view_profiles",   "عرض الملفات الشخصية",                 "إدارة الأعضاء",
            is_admin or has_council or (has_person and is_active),
            "role" if is_admin else ("council" if has_council else ("role" if has_person and is_active else None)),
            "full" if is_admin else ("partial" if has_council else ("own" if has_person else None)),
            "جميع الأعضاء" if is_admin
            else (f"ضمن: {council_names} + من تحته في الهيكل التنظيمي" if has_council
                  else "ملفه الشخصي + من تحته في الهيكل التنظيمي" if has_person and is_active
                  else "")),

        cap("view_org_descendants", "عرض ملفات الأعضاء في الهيكل التنظيمي",   "إدارة الأعضاء",
            has_person and is_active,
            "role" if (has_person and is_active) else None,
            "partial" if (has_person and is_active) else None,
            "الأعضاء المباشرين وغير المباشرين تحته في الشجرة التنظيمية"),

        cap("edit_profiles",   "تعديل الملفات الشخصية",               "إدارة الأعضاء",
            is_admin or (has_person and is_active),
            "role",
            "full" if is_admin else "own",
            "جميع الأعضاء" if is_admin else "ملفه الشخصي فقط"),

        cap("delete_members",  "حذف بيانات الأعضاء",                  "إدارة الأعضاء",
            is_admin, "role", "full"),

        cap("archive_members", "أرشفة الأعضاء وإلغاء الأرشفة",         "إدارة الأعضاء",
            is_admin, "role", "full"),

        cap("promote_members", "ترقية الأعضاء غير المسجلين",           "إدارة الأعضاء",
            is_admin, "role", "full"),

        # ── الطلبات والموافقات ───────────────────────────────────────────────────
        cap("approve_reg",     "الموافقة على طلبات التسجيل الجديدة",  "الطلبات والموافقات",
            is_admin, "role", "full"),

        cap("reject_reg",      "رفض طلبات التسجيل",                    "الطلبات والموافقات",
            is_admin, "role", "full"),

        cap("approve_yg",      "الموافقة على انضمام فرق الشبيبة",      "الطلبات والموافقات",
            is_admin or has_council,
            "role" if is_admin else ("council" if has_council else None),
            "full" if is_admin else ("partial" if has_council else None),
            "جميع الفرق" if is_admin else (f"ضمن: {council_names}" if has_council else "")),

        cap("reject_yg",       "رفض انضمام فرق الشبيبة",              "الطلبات والموافقات",
            is_admin or has_council,
            "role" if is_admin else ("council" if has_council else None),
            "full" if is_admin else ("partial" if has_council else None),
            "جميع الفرق" if is_admin else (f"ضمن: {council_names}" if has_council else "")),

        cap("view_requests",   "عرض طلبات التسجيل والانضمام",         "الطلبات والموافقات",
            is_admin or has_council or is_pending or is_active,
            "role",
            "full" if is_admin else "partial",
            "جميع الطلبات" if is_admin else ("طلبات فرقته" if has_council else "طلبه الخاص")),

        # ── المحتوى ──────────────────────────────────────────────────────────────
        cap("manage_questions","إنشاء وإدارة الاستبيانات",             "المحتوى",
            is_admin, "role", "full"),

        cap("view_responses",  "عرض جميع إجابات الاستبيانات",          "المحتوى",
            is_admin, "role", "full"),

        cap("respond_questions","الإجابة على الاستبيانات",             "المحتوى",
            is_active and not is_admin,
            "role" if (is_active and not is_admin) else None, "full"),

        cap("manage_yg",       "إدارة ملفات فرق الشبيبة",             "المحتوى",
            is_admin, "role", "full"),

        cap("manage_churches", "إدارة الكنائس والأبرشيات",            "المحتوى",
            is_admin, "role", "full"),

        cap("manage_mottos",   "إدارة الشعارات والصور",                "المحتوى",
            is_admin, "role", "full"),

        cap("view_gs_tree",    "عرض الهيكل التنظيمي للأمانة العامة",  "المحتوى",
            is_admin, "role", "full"),

        # ── الوصول العام ─────────────────────────────────────────────────────────
        cap("view_org_tree",   "عرض الهيكل التنظيمي",                  "الوصول العام",
            not is_pending,
            "role" if not is_pending else None,
            "full" if is_admin else ("partial" if not is_pending else None),
            "جميع الفرق" if is_admin else ("فرقه فقط" if not is_pending else "")),

        cap("view_council_members", "عرض أعضاء مجلس الفئة",           "الوصول العام",
            has_council,
            "council" if has_council else None,
            "partial" if has_council else None,
            f"ضمن: {council_names}" if has_council else ""),

        cap("add_member",      "تسجيل عضو جديد",                       "الوصول العام",
            not is_pending, "role" if not is_pending else None,
            "full" if not is_pending else None),

        cap("view_calendar",   "تقويم أعياد الميلاد",                  "الوصول العام",
            True, "role", "full"),

        cap("view_bible",      "قارئ الكتاب المقدس",                   "الوصول العام",
            True, "role", "full"),

        cap("view_churches",   "خريطة الكنائس والأبرشيات",             "الوصول العام",
            True, "role", "full"),
    ]


def register_privileges_routes(app):

    @app.get("/api/privileges/positions")
    def get_positions():
        err = _require_admin()
        if err:
            return err
        positions = _get_all_org_positions()
        return jsonify({"positions": positions})

    @app.get("/api/privileges/matrix")
    def get_matrix():
        err = _require_admin()
        if err:
            return err

        auth_data = _load_auth()
        all_overrides = _load_overrides().get("overrides", [])

        users_matrix = []
        for user in auth_data.get("users", []):
            username = user.get("username")
            role = user.get("role", "member")
            person_id = user.get("person_id")
            person_type = user.get("person_type")
            display_name = user.get("display_name") or username
            account_status = user.get("account_status", "active")

            computed_council = {}
            if person_id is not None and person_type:
                try:
                    youth_groups = _get_person_youth_groups(person_type, person_id)
                    computed_council = _get_council_access(person_type, person_id, youth_groups)
                except Exception:
                    pass

            user_overrides = [o for o in all_overrides if o.get("username") == username]

            # Use privilege_store as the canonical override engine
            effective_council = _apply_overrides_for_user(username, computed_council)

            capabilities = _compute_capabilities(user, effective_council)

            users_matrix.append({
                "username": username,
                "display_name": display_name,
                "person_id": person_id,
                "person_type": person_type,
                "role": role,
                "account_status": account_status,
                "computed_council": computed_council,
                "effective_council": effective_council,
                "overrides": user_overrides,
                "capabilities": capabilities,
            })

        return jsonify({"users": users_matrix, "age_groups": AGE_GROUPS_PY})

    @app.get("/api/privileges/overrides")
    def list_overrides():
        err = _require_admin()
        if err:
            return err
        data = _load_overrides()
        return jsonify({"overrides": data.get("overrides", [])})

    @app.post("/api/privileges/overrides")
    def create_override():
        err = _require_admin()
        if err:
            return err

        body = request.json or {}
        u = _current_user()

        privilege = body.get("privilege")
        username = body.get("username")
        group_id = body.get("group_id") or None
        age_group = body.get("age_group") or None

        if not privilege:
            return jsonify({"error": "privilege مطلوب"}), 400
        if not username:
            return jsonify({"error": "username مطلوب"}), 400
        if privilege in ("council_full", "council_age_group") and not group_id:
            return jsonify({"error": "group_id مطلوب لصلاحيات المجلس"}), 400
        if privilege == "council_age_group" and not age_group:
            return jsonify({"error": "age_group مطلوب لصلاحية فئة محددة"}), 400

        group_name = S.youth_group_display_label(group_id) if group_id else None

        override = {
            "id": str(uuid.uuid4()),
            "type": body.get("type", "grant"),
            "username": username,
            "display_name": body.get("display_name", ""),
            "privilege": privilege,
            "group_id": group_id,
            "group_name": group_name,
            "age_group": age_group,
            "notes": body.get("notes", ""),
            "created_at": datetime.utcnow().isoformat(),
            "created_by": u.get("username", "admin") if u else "admin",
        }

        with _priv_lock:
            data = _load_overrides()
            data.setdefault("overrides", []).append(override)
            _save_overrides(data)

        return jsonify({"ok": True, "override": override})

    @app.put("/api/privileges/overrides/<override_id>")
    def update_override(override_id):
        err = _require_admin()
        if err:
            return err

        body = request.json or {}
        with _priv_lock:
            data = _load_overrides()
            o = next((x for x in data.get("overrides", []) if x.get("id") == override_id), None)
            if not o:
                return jsonify({"error": "not found"}), 404
            for field in ("type", "privilege", "group_id", "age_group", "notes"):
                if field in body:
                    o[field] = body[field] or None
            if "group_id" in body and body.get("group_id"):
                o["group_name"] = S.youth_group_display_label(body["group_id"])
            _save_overrides(data)

        return jsonify({"ok": True, "override": o})

    @app.delete("/api/privileges/overrides/<override_id>")
    def delete_override(override_id):
        err = _require_admin()
        if err:
            return err

        with _priv_lock:
            data = _load_overrides()
            before = len(data.get("overrides", []))
            data["overrides"] = [o for o in data.get("overrides", []) if o.get("id") != override_id]
            if len(data.get("overrides", [])) == before:
                return jsonify({"error": "not found"}), 404
            _save_overrides(data)

        return jsonify({"ok": True})
