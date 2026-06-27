import json
import os
import threading
import uuid
from datetime import datetime

from flask import jsonify, request, send_file
from werkzeug.utils import secure_filename

from core.routes_auth import exports as auth_exports

# ── Constants ─────────────────────────────────────────────────────────────────

BED_TYPES = ['سرير فردي', 'سرير مزدوج', 'سرير طابقي', 'سرير طابقي ثلاثي']
BED_MULTIPLIERS = {'سرير فردي': 1, 'سرير مزدوج': 2, 'سرير طابقي': 2, 'سرير طابقي ثلاثي': 3}
BUILTIN_FEATURES = ['حمام', 'مكيف', 'مروحة', 'ثلاجة صغيرة']
ALLOWED_IMAGE_EXT = {'.jpg', '.jpeg', '.png', '.webp'}

# ── File paths ────────────────────────────────────────────────────────────────

_BASE_DIR            = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_CAMP_LOCATIONS_FILE = os.path.join(_BASE_DIR, 'data', 'camp_locations.json')
_FLOOR_PLANS_DIR     = os.path.join(_BASE_DIR, 'data', 'photos', 'camp_locations', 'floor_plans')

os.makedirs(_FLOOR_PLANS_DIR, exist_ok=True)

_LOCK = threading.Lock()

# ── Storage helpers ───────────────────────────────────────────────────────────

def _load():
    if not os.path.exists(_CAMP_LOCATIONS_FILE):
        return {'locations': []}
    try:
        with open(_CAMP_LOCATIONS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {'locations': []}
        if not isinstance(data.get('locations'), list):
            data['locations'] = []
        return data
    except Exception:
        return {'locations': []}


def _save(data):
    os.makedirs(os.path.dirname(_CAMP_LOCATIONS_FILE), exist_ok=True)
    with open(_CAMP_LOCATIONS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── ID generator ──────────────────────────────────────────────────────────────

def _collect_all_ids(data):
    ids = set()
    for loc in data.get('locations', []):
        ids.add(loc.get('id', ''))
        for bld in loc.get('buildings', []):
            ids.add(bld.get('id', ''))
            for flr in bld.get('floors', []):
                ids.add(flr.get('id', ''))
                for rm in flr.get('rooms', []):
                    ids.add(rm.get('id', ''))
    return ids


def _gen_id(prefix, existing_ids):
    nums = set()
    for eid in existing_ids:
        s = str(eid or '')
        if s.startswith(prefix) and s[len(prefix):].isdigit():
            nums.add(int(s[len(prefix):]))
    n = max(nums, default=0) + 1
    return f'{prefix}{n:06d}'


# ── Lookup helpers ─────────────────────────────────────────────────────────────

def _find_location(data, loc_id):
    return next((l for l in data.get('locations', []) if l.get('id') == loc_id), None)


def _find_building(loc, bld_id):
    return next((b for b in loc.get('buildings', []) if b.get('id') == bld_id), None)


def _find_floor(bld, flr_id):
    return next((f for f in bld.get('floors', []) if f.get('id') == flr_id), None)


def _find_room(flr, rm_id):
    return next((r for r in flr.get('rooms', []) if r.get('id') == rm_id), None)


def _normalize_beds(raw):
    """Accept [{type, count}, ...], return cleaned list; always at least one entry."""
    if not isinstance(raw, list) or not raw:
        return [{'type': 'سرير فردي', 'count': 1}]
    out = []
    for b in raw:
        btype = str(b.get('type', 'سرير فردي') or 'سرير فردي').strip()
        if btype not in BED_TYPES:
            btype = 'سرير فردي'
        try:
            bcount = max(1, int(b.get('count', 1) or 1))
        except (TypeError, ValueError):
            bcount = 1
        out.append({'type': btype, 'count': bcount})
    return out or [{'type': 'سرير فردي', 'count': 1}]


def _compute_capacity(beds):
    return sum(b['count'] * BED_MULTIPLIERS.get(b['type'], 1) for b in beds)


def _room_capacity(room):
    beds = room.get('beds')
    if beds:
        return _compute_capacity(beds)
    # Legacy single-type fields
    mult = BED_MULTIPLIERS.get(room.get('bed_type', 'سرير فردي'), 1)
    return (room.get('bed_count', 0) or 0) * mult


# ── Auth helper ───────────────────────────────────────────────────────────────

def _require_admin():
    try:
        user = auth_exports['_current_user']()
    except Exception:
        user = None
    if not user or user.get('role') != 'admin':
        return jsonify({'error': 'unauthorized'}), 403
    return None


# ── Floor plan image helpers ───────────────────────────────────────────────────

def _floor_plan_path(flr_id, ext):
    return os.path.join(_FLOOR_PLANS_DIR, f'{flr_id}{ext}')


def _find_floor_plan_file(flr_id):
    for ext in ALLOWED_IMAGE_EXT:
        p = _floor_plan_path(flr_id, ext)
        if os.path.exists(p):
            return p
    return None


# ── Route registrar ───────────────────────────────────────────────────────────

def register_camp_location_routes(app):

    # ── List / Create locations ────────────────────────────────────────────────

    @app.route('/api/camp-locations', methods=['GET'])
    def list_camp_locations():
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load()
        return jsonify({'locations': data.get('locations', [])})

    @app.route('/api/camp-locations', methods=['POST'])
    def create_camp_location():
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        name = str(body.get('name', '') or '').strip()
        if not name:
            return jsonify({'error': 'name required'}), 400
        with _LOCK:
            data = _load()
            all_ids = _collect_all_ids(data)
            new_id = _gen_id('CAMPLOC', all_ids)
            loc = {
                'id': new_id,
                'name': name,
                'buildings': [],
                'created_at': datetime.now().isoformat(),
                'updated_at': datetime.now().isoformat(),
            }
            data['locations'].append(loc)
            _save(data)
        return jsonify({'location': loc}), 201

    @app.route('/api/camp-locations/<loc_id>', methods=['PUT'])
    def update_camp_location(loc_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        with _LOCK:
            data = _load()
            loc = _find_location(data, loc_id)
            if not loc:
                return jsonify({'error': 'not found'}), 404
            if 'name' in body:
                loc['name'] = str(body['name'] or '').strip()
            loc['updated_at'] = datetime.now().isoformat()
            _save(data)
        return jsonify({'location': loc})

    @app.route('/api/camp-locations/<loc_id>', methods=['DELETE'])
    def delete_camp_location(loc_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load()
            orig = data.get('locations', [])
            # Clean up floor plan images for all floors inside
            for loc in orig:
                if loc.get('id') == loc_id:
                    for bld in loc.get('buildings', []):
                        for flr in bld.get('floors', []):
                            fp = _find_floor_plan_file(flr.get('id', ''))
                            if fp:
                                try:
                                    os.remove(fp)
                                except OSError:
                                    pass
            data['locations'] = [l for l in orig if l.get('id') != loc_id]
            if len(data['locations']) == len(orig):
                return jsonify({'error': 'not found'}), 404
            _save(data)
        return jsonify({'ok': True})

    # ── Buildings ──────────────────────────────────────────────────────────────

    @app.route('/api/camp-locations/<loc_id>/buildings', methods=['POST'])
    def add_building(loc_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        name     = str(body.get('name', '') or '').strip()
        maps_url = str(body.get('maps_url', '') or '').strip()
        if not name:
            return jsonify({'error': 'name required'}), 400
        with _LOCK:
            data = _load()
            loc  = _find_location(data, loc_id)
            if not loc:
                return jsonify({'error': 'location not found'}), 404
            all_ids = _collect_all_ids(data)
            new_id  = _gen_id('CAMPBLD', all_ids)
            bld = {
                'id': new_id,
                'name': name,
                'maps_url': maps_url,
                'floors': [],
                'created_at': datetime.now().isoformat(),
            }
            loc.setdefault('buildings', []).append(bld)
            loc['updated_at'] = datetime.now().isoformat()
            _save(data)
        return jsonify({'building': bld}), 201

    @app.route('/api/camp-locations/<loc_id>/buildings/<bld_id>', methods=['PUT'])
    def update_building(loc_id, bld_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        with _LOCK:
            data = _load()
            loc  = _find_location(data, loc_id)
            if not loc:
                return jsonify({'error': 'location not found'}), 404
            bld  = _find_building(loc, bld_id)
            if not bld:
                return jsonify({'error': 'building not found'}), 404
            if 'name' in body:
                bld['name'] = str(body['name'] or '').strip()
            if 'maps_url' in body:
                bld['maps_url'] = str(body['maps_url'] or '').strip()
            bld['updated_at'] = datetime.now().isoformat()
            loc['updated_at'] = datetime.now().isoformat()
            _save(data)
        return jsonify({'building': bld})

    @app.route('/api/camp-locations/<loc_id>/buildings/<bld_id>', methods=['DELETE'])
    def delete_building(loc_id, bld_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load()
            loc  = _find_location(data, loc_id)
            if not loc:
                return jsonify({'error': 'location not found'}), 404
            blds = loc.get('buildings', [])
            for bld in blds:
                if bld.get('id') == bld_id:
                    for flr in bld.get('floors', []):
                        fp = _find_floor_plan_file(flr.get('id', ''))
                        if fp:
                            try:
                                os.remove(fp)
                            except OSError:
                                pass
            new_blds = [b for b in blds if b.get('id') != bld_id]
            if len(new_blds) == len(blds):
                return jsonify({'error': 'building not found'}), 404
            loc['buildings'] = new_blds
            loc['updated_at'] = datetime.now().isoformat()
            _save(data)
        return jsonify({'ok': True})

    # ── Floors ─────────────────────────────────────────────────────────────────

    @app.route('/api/camp-locations/<loc_id>/buildings/<bld_id>/floors', methods=['POST'])
    def add_floor(loc_id, bld_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        name = str(body.get('name', '') or '').strip()
        if not name:
            return jsonify({'error': 'name required'}), 400
        with _LOCK:
            data = _load()
            loc  = _find_location(data, loc_id)
            if not loc:
                return jsonify({'error': 'location not found'}), 404
            bld  = _find_building(loc, bld_id)
            if not bld:
                return jsonify({'error': 'building not found'}), 404
            all_ids = _collect_all_ids(data)
            new_id  = _gen_id('CAMPFLR', all_ids)
            flr = {
                'id': new_id,
                'name': name,
                'floor_plan_image': False,
                'rooms': [],
                'created_at': datetime.now().isoformat(),
            }
            bld.setdefault('floors', []).append(flr)
            loc['updated_at'] = datetime.now().isoformat()
            _save(data)
        return jsonify({'floor': flr}), 201

    @app.route('/api/camp-locations/<loc_id>/buildings/<bld_id>/floors/<flr_id>', methods=['PUT'])
    def update_floor(loc_id, bld_id, flr_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        with _LOCK:
            data = _load()
            loc  = _find_location(data, loc_id)
            if not loc:
                return jsonify({'error': 'location not found'}), 404
            bld  = _find_building(loc, bld_id)
            if not bld:
                return jsonify({'error': 'building not found'}), 404
            flr  = _find_floor(bld, flr_id)
            if not flr:
                return jsonify({'error': 'floor not found'}), 404
            if 'name' in body:
                flr['name'] = str(body['name'] or '').strip()
            flr['updated_at'] = datetime.now().isoformat()
            loc['updated_at'] = datetime.now().isoformat()
            _save(data)
        return jsonify({'floor': flr})

    @app.route('/api/camp-locations/<loc_id>/buildings/<bld_id>/floors/<flr_id>', methods=['DELETE'])
    def delete_floor(loc_id, bld_id, flr_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load()
            loc  = _find_location(data, loc_id)
            if not loc:
                return jsonify({'error': 'location not found'}), 404
            bld  = _find_building(loc, bld_id)
            if not bld:
                return jsonify({'error': 'building not found'}), 404
            floors = bld.get('floors', [])
            new_floors = [f for f in floors if f.get('id') != flr_id]
            if len(new_floors) == len(floors):
                return jsonify({'error': 'floor not found'}), 404
            # Remove floor plan image if present
            fp = _find_floor_plan_file(flr_id)
            if fp:
                try:
                    os.remove(fp)
                except OSError:
                    pass
            bld['floors'] = new_floors
            loc['updated_at'] = datetime.now().isoformat()
            _save(data)
        return jsonify({'ok': True})

    # ── Floor plan images ──────────────────────────────────────────────────────

    @app.route('/api/camp-locations/<loc_id>/buildings/<bld_id>/floors/<flr_id>/floor-plan', methods=['POST'])
    def upload_floor_plan(loc_id, bld_id, flr_id):
        err = _require_admin()
        if err:
            return err
        file = request.files.get('image')
        if not file or not file.filename:
            return jsonify({'error': 'no image provided'}), 400
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in ALLOWED_IMAGE_EXT:
            return jsonify({'error': f'unsupported image type: {ext}'}), 400
        with _LOCK:
            data = _load()
            loc  = _find_location(data, loc_id)
            if not loc:
                return jsonify({'error': 'location not found'}), 404
            bld  = _find_building(loc, bld_id)
            if not bld:
                return jsonify({'error': 'building not found'}), 404
            flr  = _find_floor(bld, flr_id)
            if not flr:
                return jsonify({'error': 'floor not found'}), 404
            # Remove old image if different ext
            for old_ext in ALLOWED_IMAGE_EXT:
                old_path = _floor_plan_path(flr_id, old_ext)
                if old_ext != ext and os.path.exists(old_path):
                    try:
                        os.remove(old_path)
                    except OSError:
                        pass
            file.save(_floor_plan_path(flr_id, ext))
            flr['floor_plan_image'] = True
            flr['floor_plan_ext'] = ext
            flr['updated_at'] = datetime.now().isoformat()
            loc['updated_at'] = datetime.now().isoformat()
            _save(data)
        return jsonify({'ok': True, 'floor': flr})

    @app.route('/api/camp-locations/floor-plan/<flr_id>', methods=['GET'])
    def get_floor_plan(flr_id):
        fp = _find_floor_plan_file(flr_id)
        if not fp:
            return jsonify({'error': 'not found'}), 404
        ext = os.path.splitext(fp)[1].lower()
        mime_map = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'}
        return send_file(fp, mimetype=mime_map.get(ext, 'image/jpeg'))

    @app.route('/api/camp-locations/<loc_id>/buildings/<bld_id>/floors/<flr_id>/floor-plan', methods=['DELETE'])
    def delete_floor_plan(loc_id, bld_id, flr_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load()
            loc  = _find_location(data, loc_id)
            if not loc:
                return jsonify({'error': 'location not found'}), 404
            bld  = _find_building(loc, bld_id)
            if not bld:
                return jsonify({'error': 'building not found'}), 404
            flr  = _find_floor(bld, flr_id)
            if not flr:
                return jsonify({'error': 'floor not found'}), 404
            fp = _find_floor_plan_file(flr_id)
            if fp:
                try:
                    os.remove(fp)
                except OSError:
                    pass
            flr['floor_plan_image'] = False
            flr.pop('floor_plan_ext', None)
            flr['updated_at'] = datetime.now().isoformat()
            loc['updated_at'] = datetime.now().isoformat()
            _save(data)
        return jsonify({'ok': True})

    # ── Rooms ──────────────────────────────────────────────────────────────────

    @app.route('/api/camp-locations/<loc_id>/buildings/<bld_id>/floors/<flr_id>/rooms', methods=['POST'])
    def add_room(loc_id, bld_id, flr_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        name     = str(body.get('name', '') or '').strip()
        beds     = _normalize_beds(body.get('beds'))
        features = body.get('features', [])
        is_vip   = bool(body.get('is_vip', False))
        if not name:
            return jsonify({'error': 'name required'}), 400
        if not isinstance(features, list):
            features = []
        features = [str(f).strip() for f in features if str(f).strip()]
        with _LOCK:
            data = _load()
            loc  = _find_location(data, loc_id)
            if not loc:
                return jsonify({'error': 'location not found'}), 404
            bld  = _find_building(loc, bld_id)
            if not bld:
                return jsonify({'error': 'building not found'}), 404
            flr  = _find_floor(bld, flr_id)
            if not flr:
                return jsonify({'error': 'floor not found'}), 404
            all_ids = _collect_all_ids(data)
            new_id  = _gen_id('CAMPRM', all_ids)
            room = {
                'id': new_id,
                'name': name,
                'beds': beds,
                'capacity': _compute_capacity(beds),
                'features': features,
                'is_vip': is_vip,
                'created_at': datetime.now().isoformat(),
            }
            flr.setdefault('rooms', []).append(room)
            loc['updated_at'] = datetime.now().isoformat()
            _save(data)
        return jsonify({'room': room}), 201

    @app.route('/api/camp-locations/<loc_id>/buildings/<bld_id>/floors/<flr_id>/rooms/<rm_id>', methods=['PUT'])
    def update_room(loc_id, bld_id, flr_id, rm_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        with _LOCK:
            data = _load()
            loc  = _find_location(data, loc_id)
            if not loc:
                return jsonify({'error': 'location not found'}), 404
            bld  = _find_building(loc, bld_id)
            if not bld:
                return jsonify({'error': 'building not found'}), 404
            flr  = _find_floor(bld, flr_id)
            if not flr:
                return jsonify({'error': 'floor not found'}), 404
            room = _find_room(flr, rm_id)
            if not room:
                return jsonify({'error': 'room not found'}), 404
            if 'name' in body:
                room['name'] = str(body['name'] or '').strip()
            if 'beds' in body:
                room['beds'] = _normalize_beds(body['beds'])
                # Remove legacy single-type fields if present
                room.pop('bed_count', None)
                room.pop('bed_type', None)
            if 'features' in body:
                feats = body['features']
                if isinstance(feats, list):
                    room['features'] = [str(f).strip() for f in feats if str(f).strip()]
            if 'is_vip' in body:
                room['is_vip'] = bool(body['is_vip'])
            # Recompute capacity
            room['capacity'] = _room_capacity(room)
            room['updated_at'] = datetime.now().isoformat()
            loc['updated_at'] = datetime.now().isoformat()
            _save(data)
        return jsonify({'room': room})

    @app.route('/api/camp-locations/<loc_id>/buildings/<bld_id>/floors/<flr_id>/rooms/<rm_id>', methods=['DELETE'])
    def delete_room(loc_id, bld_id, flr_id, rm_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load()
            loc  = _find_location(data, loc_id)
            if not loc:
                return jsonify({'error': 'location not found'}), 404
            bld  = _find_building(loc, bld_id)
            if not bld:
                return jsonify({'error': 'building not found'}), 404
            flr  = _find_floor(bld, flr_id)
            if not flr:
                return jsonify({'error': 'floor not found'}), 404
            rooms = flr.get('rooms', [])
            new_rooms = [r for r in rooms if r.get('id') != rm_id]
            if len(new_rooms) == len(rooms):
                return jsonify({'error': 'room not found'}), 404
            flr['rooms'] = new_rooms
            loc['updated_at'] = datetime.now().isoformat()
            _save(data)
        return jsonify({'ok': True})
