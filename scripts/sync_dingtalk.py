#!/usr/bin/env python3
"""Sync DingTalk AI Table (多维表/Notable) or local CSV into Calendar JSON + ICS.

Zero third-party dependencies (Python 3.9+ stdlib only).

Modes:
  1. DingTalk API Mode (automatic when DINGTALK_APP_KEY + DINGTALK_APP_SECRET
     + (DINGTALK_OPERATOR_ID or DINGTALK_MOBILE) are provided)
  2. CSV Mode (automatic fallback, or --csv <path> explicitly)

Outputs:
  - docs/data/schedule.json      (consumed by GitHub Pages via fetch)
  - docs/data/schedule-data.js   (enables direct local file:// preview without a server)
  - docs/calendar.ics            (RFC 5545 subscription feed for Apple/Google/Notion/DingTalk Calendar)
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from zoneinfo import ZoneInfo

    SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")
except Exception:
    SHANGHAI_TZ = dt.timezone(dt.timedelta(hours=8))

DEFAULT_BASE_ID = "MNDoBb60VLrYNqLqInx6PzPA8lemrZQ3"
DEFAULT_SHEET_ID = "AEFsFrm"
DEFAULT_SOURCE_URL = (
    "https://alidocs.dingtalk.com/i/nodes/MNDoBb60VLrYNqLqInx6PzPA8lemrZQ3"
    "?utm_scene=person_space&iframeQuery=viewId%3Dc9vuiLa%26sheetId%3DAEFsFrm"
)

ROOM_SHORT_MAP = {
    "19楼": "19F",
    "21楼·就事论事": "21F·就事",
    "21楼·赏心悦室": "21F·赏心",
}

FIELD_ALIASES = {
    "title": ["直播主题", "主题", "标题"],
    "date": ["日期", "直播日期", "开播日期"],
    "type": ["直播类型", "类型", "分类"],
    "start": ["开始时间", "开播时间"],
    "end": ["结束时间", "下播时间"],
    "videoAccount": ["视频号账号", "视频号"],
    "videoAccountLegacy": ["视频号账号(旧)"],
    "appAccount": ["APP账号", "App账号", "APP"],
    "speaker": ["讲师", "主讲", "老师"],
    "host": ["主持人", "主持"],
    "inviteStatus": ["老师邀约状态", "邀约状态"],
    "ops": ["运营", "对接运营", "负责人"],
    "room": ["直播间", "房间", "场地"],
    "detail": ["详情", "备注"],
    "conflict": ["冲突标记"],
    "conflictReason": ["冲突原因"],
    "conflictGroup": ["冲突组"],
}


def load_dotenv(env_path: Path) -> None:
    """Load simple KEY=VALUE lines from .env if present (does not override existing env)."""
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def http_json(
    method: str,
    url: str,
    headers: Optional[Dict[str, str]] = None,
    payload: Optional[Dict[str, Any]] = None,
    timeout: int = 20,
) -> Dict[str, Any]:
    req_headers = {"Accept": "application/json"}
    if headers:
        req_headers.update(headers)
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {url}\n{err_body}") from exc


def get_dingtalk_access_token(app_key: str, app_secret: str) -> str:
    res = http_json(
        "POST",
        "https://api.dingtalk.com/v1.0/oauth2/accessToken",
        payload={"appKey": app_key, "appSecret": app_secret},
    )
    token = res.get("accessToken")
    if not token:
        raise RuntimeError(f"获取钉钉 accessToken 失败: {res}")
    return token


def resolve_union_id_by_userid(access_token: str, userid: str) -> str:
    """Resolve unionId from DingTalk staffId/userid via Contacts API (requires Contact.User.Read)."""
    q = urllib.parse.urlencode({"access_token": access_token})
    user_info = http_json(
        "POST",
        f"https://oapi.dingtalk.com/topapi/v2/user/get?{q}",
        payload={"userid": userid},
    )
    if user_info.get("errcode", 0) != 0:
        raise RuntimeError(
            f"通过 userid({userid}) 查询 unionid 失败（请确认已开通“通讯录个人信息读权限”且审批通过，或直接填写 DINGTALK_OPERATOR_ID）: {user_info}"
        )
    union_id = (user_info.get("result") or {}).get("unionid")
    if not union_id:
        raise RuntimeError(f"成员详情中未返回 unionid: {user_info}")
    return union_id


def resolve_union_id_by_mobile(access_token: str, mobile: str) -> str:
    """Resolve unionId from phone number via DingTalk Contacts API."""
    q = urllib.parse.urlencode({"access_token": access_token})
    by_mobile = http_json(
        "POST",
        f"https://oapi.dingtalk.com/topapi/v2/user/getbymobile?{q}",
        payload={"mobile": mobile},
    )
    if by_mobile.get("errcode", 0) != 0:
        raise RuntimeError(
            f"通过手机号查询 userid 失败（请确认应用已开通“根据手机号获取成员”权限，或直接填写 DINGTALK_OPERATOR_ID）: {by_mobile}"
        )
    userid = (by_mobile.get("result") or {}).get("userid")
    if not userid:
        raise RuntimeError(f"未找到手机号 {mobile} 对应的钉钉成员: {by_mobile}")
    return resolve_union_id_by_userid(access_token, userid)


def fetch_dingtalk_fields(
    access_token: str, base_id: str, sheet_id: str, operator_id: str
) -> List[Dict[str, Any]]:
    """Fetch field definitions for a DingTalk AI Table sheet."""
    q = urllib.parse.urlencode({"operatorId": operator_id})
    url = f"https://api.dingtalk.com/v1.0/notable/bases/{base_id}/sheets/{sheet_id}/fields?{q}"
    try:
        res = http_json(
            "GET",
            url,
            headers={"x-acs-dingtalk-access-token": access_token},
        )
    except Exception as exc:
        print(f"[warn] 获取字段列表失败 (sheet={sheet_id}): {exc}", file=sys.stderr)
        return []
    return list(res.get("value") or res.get("fields") or [])


def fetch_dingtalk_sheets(
    access_token: str, base_id: str, operator_id: str
) -> List[Dict[str, Any]]:
    """List all sheets in a DingTalk AI Table base."""
    q = urllib.parse.urlencode({"operatorId": operator_id})
    url = f"https://api.dingtalk.com/v1.0/notable/bases/{base_id}/sheets?{q}"
    try:
        res = http_json(
            "GET",
            url,
            headers={"x-acs-dingtalk-access-token": access_token},
        )
    except Exception as exc:
        print(f"[warn] 获取工作表列表失败: {exc}", file=sys.stderr)
        return []
    return list(res.get("value") or res.get("sheets") or [])


def _fetch_raw_sheet_records(
    access_token: str, base_id: str, sheet_id: str, operator_id: str
) -> List[Dict[str, Any]]:
    """Fetch raw record objects (id + fields) for a single sheet with pagination."""
    q = urllib.parse.urlencode({"operatorId": operator_id})
    url = f"https://api.dingtalk.com/v1.0/notable/bases/{base_id}/sheets/{sheet_id}/records/list?{q}"
    headers = {"x-acs-dingtalk-access-token": access_token}

    records_out: List[Dict[str, Any]] = []
    next_token = ""
    while True:
        body: Dict[str, Any] = {"maxResults": 100}
        if next_token:
            body["nextToken"] = next_token
        res = http_json("POST", url, headers=headers, payload=body)
        records = res.get("records") or []
        records_out.extend(records)

        has_more = bool(res.get("hasMore"))
        next_token = str(res.get("nextToken") or "")
        if not has_more or not next_token:
            break
    return records_out


def _extract_linked_ids(val: Any, is_link_field: bool = False) -> List[str]:
    """Extract linked record IDs from DingTalk unidirectionalLink / bidirectionalLink values."""
    if val is None:
        return []
    if isinstance(val, dict):
        for key in ("linkedRecordIds", "recordIds"):
            ids = val.get(key)
            if isinstance(ids, list):
                return [str(x) for x in ids if x]
        # Single linked record object without display text
        if ("recordId" in val or "id" in val) and not any(
            val.get(k) for k in ("name", "text", "primaryValue", "label", "title")
        ):
            rid = val.get("recordId") or val.get("id")
            return [str(rid)] if rid else []
    if isinstance(val, list):
        out: List[str] = []
        for item in val:
            if isinstance(item, str) and is_link_field:
                out.append(item)
            elif isinstance(item, dict):
                if any(item.get(k) for k in ("name", "text", "primaryValue", "label", "title")):
                    continue
                rid = item.get("recordId") or item.get("id")
                if rid:
                    out.append(str(rid))
        return out
    return []


def _pick_primary_display(fields_dict: Dict[str, Any], sheet_fields: List[Dict[str, Any]]) -> str:
    """Pick the primary display label of a linked lookup record (e.g. 名称/账号名称/姓名)."""
    field_id_to_name = {
        str(f.get("id")): str(f.get("name"))
        for f in sheet_fields
        if f.get("id") and f.get("name")
    }
    named: Dict[str, Any] = {}
    for k, v in fields_dict.items():
        named[field_id_to_name.get(str(k), str(k))] = v

    # 1. Explicit primary field from schema
    for f in sheet_fields:
        if f.get("isPrimary") or f.get("primary"):
            fname = str(f.get("name") or "")
            if fname in named:
                txt = extract_text(named[fname])
                if txt:
                    return txt

    # 2. Well-known primary column names in DingTalk lookup sheets
    for preferred in ("名称", "账号名称", "姓名", "直播间", "标题", "主题"):
        if preferred in named:
            txt = extract_text(named[preferred])
            if txt:
                return txt

    # 3. First defined field in schema
    if sheet_fields:
        first_name = str(sheet_fields[0].get("name") or "")
        if first_name in named:
            txt = extract_text(named[first_name])
            if txt:
                return txt

    # 4. First non-empty scalar text field
    for v in named.values():
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def resolve_linked_records_in_rows(
    rows: List[Dict[str, Any]],
    record_lookup: Dict[str, str],
    link_field_names: Optional[set] = None,
) -> int:
    """Replace linkedRecordIds objects in normalized rows with human-readable display labels."""
    link_names = link_field_names or set()
    resolved_cells = 0
    for row in rows:
        for k, v in list(row.items()):
            if k.startswith("_"):
                continue
            ids = _extract_linked_ids(v, is_link_field=(k in link_names))
            if not ids:
                continue
            labels = [record_lookup.get(rid, "") for rid in ids]
            labels = [lb for lb in labels if lb]
            if labels:
                # Deduplicate preserving order
                deduped = list(dict.fromkeys(labels))
                row[k] = "、".join(deduped)
                resolved_cells += 1
    return resolved_cells


def fetch_dingtalk_records(
    access_token: str, base_id: str, sheet_id: str, operator_id: str
) -> List[Dict[str, Any]]:
    """Fetch all records from a DingTalk AI Table sheet and resolve linked record fields."""
    sheet_fields = fetch_dingtalk_fields(access_token, base_id, sheet_id, operator_id)
    field_map: Dict[str, str] = {}
    link_field_names: set = set()
    linked_sheet_ids: List[str] = []

    for f in sheet_fields:
        fid = str(f.get("id") or "")
        fname = str(f.get("name") or "")
        ftype = str(f.get("type") or "")
        if fid and fname:
            field_map[fid] = fname
        prop = f.get("property") or {}
        if "link" in ftype.lower() or any(
            k in prop for k in ("linkedSheetId", "targetSheetId", "sheetId", "linkedTableId")
        ):
            if fname:
                link_field_names.add(fname)
            if fid:
                link_field_names.add(fid)
            for key in ("linkedSheetId", "targetSheetId", "sheetId", "linkedTableId"):
                sid = prop.get(key)
                if sid and str(sid) != sheet_id and str(sid) not in linked_sheet_ids:
                    linked_sheet_ids.append(str(sid))

    raw_records = _fetch_raw_sheet_records(access_token, base_id, sheet_id, operator_id)
    all_rows: List[Dict[str, Any]] = []
    needs_lookup = False
    for rec in raw_records:
        raw_fields = rec.get("fields") or {}
        normalized: Dict[str, Any] = {"_recordId": rec.get("id", "")}
        for k, v in raw_fields.items():
            name = field_map.get(str(k), str(k))
            normalized[name] = v
            if _extract_linked_ids(v, is_link_field=(name in link_field_names)):
                needs_lookup = True
        all_rows.append(normalized)

    if needs_lookup:
        if not linked_sheet_ids:
            # Fallback: discover all other sheets in the base (e.g. 直播间/账号/讲师/主持人/运营)
            for s in fetch_dingtalk_sheets(access_token, base_id, operator_id):
                sid = str(s.get("id") or "")
                if sid and sid != sheet_id and sid not in linked_sheet_ids:
                    linked_sheet_ids.append(sid)

        record_lookup: Dict[str, str] = {}
        for lsid in linked_sheet_ids:
            lfields = fetch_dingtalk_fields(access_token, base_id, lsid, operator_id)
            lrecs = _fetch_raw_sheet_records(access_token, base_id, lsid, operator_id)
            for lrec in lrecs:
                rid = str(lrec.get("id") or "")
                if not rid:
                    continue
                label = _pick_primary_display(lrec.get("fields") or {}, lfields)
                if label:
                    record_lookup[rid] = label

        resolved_cells = resolve_linked_records_in_rows(all_rows, record_lookup, link_field_names)
        print(
            f"[info] 已解析 {len(linked_sheet_ids)} 张关联子表（{len(record_lookup)} 条映射），"
            f"共填充 {resolved_cells} 个关联字段值"
        )
    elif all_rows:
        sample = all_rows[0]
        shape = {
            k: (type(v).__name__, list(v.keys()) if isinstance(v, dict) else (type(v[0]).__name__ if isinstance(v, list) and v else ""))
            for k, v in sample.items()
            if k in ("直播间", "视频号账号", "APP账号", "讲师", "主持人", "运营")
        }
        print(f"[info] 未检测到需查表的关联 ID，样本字段结构: {shape}")

    return all_rows


def extract_text(val: Any) -> str:
    """Flatten DingTalk Notable field value (text/select/link/user/list/formula) into clean string."""
    if val is None:
        return ""
    if isinstance(val, bool):
        return "是" if val else "否"
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, str):
        return val.strip()
    if isinstance(val, dict):
        # Single select / link / linked record / formula result
        for key in ("name", "text", "primaryValue", "label", "title", "value"):
            if key in val and val[key] not in (None, ""):
                return extract_text(val[key])
        if "records" in val and isinstance(val["records"], list):
            return extract_text(val["records"])
        return ""
    if isinstance(val, list):
        parts = [extract_text(item) for item in val]
        parts = [p for p in parts if p]
        # Deduplicate while preserving order
        seen = set()
        deduped = []
        for p in parts:
            if p not in seen:
                seen.add(p)
                deduped.append(p)
        return "、".join(deduped)
    return str(val).strip()


def normalize_date(val: Any) -> str:
    """Convert DingTalk timestamp (ms/s), ISO-8601, or YYYY/MM/DD into YYYY-MM-DD (Asia/Shanghai)."""
    if val is None or val == "":
        return ""
    if isinstance(val, dict):
        for key in ("value", "text", "name"):
            if key in val:
                return normalize_date(val[key])
        return ""
    if isinstance(val, (int, float)):
        ts = float(val)
        if ts > 1e11:  # milliseconds
            ts /= 1000.0
        if ts > 1e8:
            return dt.datetime.fromtimestamp(ts, tz=SHANGHAI_TZ).strftime("%Y-%m-%d")
        return ""

    s = extract_text(val)
    if not s:
        return ""
    # Pure numeric string timestamp
    if re.fullmatch(r"\d{10,13}", s):
        return normalize_date(int(s))
    # ISO 8601 with timezone, e.g. 2026-12-01T16:00:00.000Z
    if "T" in s:
        try:
            iso = s.replace("Z", "+00:00")
            parsed = dt.datetime.fromisoformat(iso)
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone(SHANGHAI_TZ)
            return parsed.strftime("%Y-%m-%d")
        except ValueError:
            pass
    # Common date strings: 2026-12-1, 2026/12/01, 2026.12.01
    m = re.search(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", s)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return ""


def normalize_time(val: Any) -> str:
    """Normalize HH:MM string or timestamp into HH:MM."""
    if val is None or val == "":
        return ""
    if isinstance(val, (int, float)):
        ts = float(val)
        if ts > 1e11:
            ts /= 1000.0
        if ts > 1e8:
            return dt.datetime.fromtimestamp(ts, tz=SHANGHAI_TZ).strftime("%H:%M")
    s = extract_text(val)
    if not s:
        return ""
    if "T" in s:
        try:
            iso = s.replace("Z", "+00:00")
            parsed = dt.datetime.fromisoformat(iso)
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone(SHANGHAI_TZ)
            return parsed.strftime("%H:%M")
        except ValueError:
            pass
    m = re.search(r"(\d{1,2}):(\d{2})", s)
    if m:
        h, mm = int(m.group(1)), int(m.group(2))
        if 0 <= h <= 23 and 0 <= mm <= 59:
            return f"{h:02d}:{mm:02d}"
    return ""


def pick_field(row: Dict[str, Any], canonical: str) -> Any:
    for alias in FIELD_ALIASES[canonical]:
        if alias in row and row[alias] not in (None, ""):
            return row[alias]
    return ""


def load_csv_rows(csv_path: Path) -> List[Dict[str, Any]]:
    """Parse standalone schedule CSV OR multi-sheet concatenated DingTalk CSV export."""
    text = csv_path.read_text(encoding="utf-8-sig")
    reader = list(csv.reader(text.splitlines()))
    header_idx = -1
    for i, r in enumerate(reader):
        cleaned = [c.strip() for c in r]
        if "直播主题" in cleaned and "日期" in cleaned:
            header_idx = i
            break
    if header_idx == -1:
        raise ValueError(f"CSV 文件 {csv_path} 中未找到包含“直播主题”和“日期”的表头行")

    headers = [c.strip() for c in reader[header_idx]]
    stop_markers = {"姓名", "冲突对", "账号名称", "名称"}
    rows: List[Dict[str, Any]] = []
    for raw in reader[header_idx + 1 :]:
        if not raw or all(not c.strip() for c in raw):
            continue
        if raw[0].strip() in stop_markers and ("角色" in raw or "场次A" in raw or "平台" in raw or "说明" in raw):
            break
        row_dict = {}
        for idx, h in enumerate(headers):
            if h:
                row_dict[h] = raw[idx].strip() if idx < len(raw) else ""
        rows.append(row_dict)
    return rows


def time_to_mins(t: str) -> Optional[int]:
    if not t or ":" not in t:
        return None
    try:
        h, m = t.split(":")
        return int(h) * 60 + int(m)
    except ValueError:
        return None


def build_events(raw_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Transform raw DingTalk/CSV records into clean, conflict-checked calendar events."""
    events: List[Dict[str, Any]] = []
    for idx, row in enumerate(raw_rows, start=1):
        title = extract_text(pick_field(row, "title"))
        date_str = normalize_date(pick_field(row, "date"))
        live_type = extract_text(pick_field(row, "type"))
        start = normalize_time(pick_field(row, "start"))
        end = normalize_time(pick_field(row, "end"))

        if not any([title, date_str, live_type, start]):
            continue

        video_acc = extract_text(pick_field(row, "videoAccount"))
        legacy_video = extract_text(pick_field(row, "videoAccountLegacy"))
        if not video_acc and legacy_video:
            video_acc = f"{legacy_video}(旧)"

        app_acc = extract_text(pick_field(row, "appAccount"))
        speaker = extract_text(pick_field(row, "speaker"))
        host = extract_text(pick_field(row, "host"))
        invite_status = extract_text(pick_field(row, "inviteStatus"))
        ops = extract_text(pick_field(row, "ops"))
        room = extract_text(pick_field(row, "room"))
        detail = extract_text(pick_field(row, "detail"))
        conflict_flag = extract_text(pick_field(row, "conflict"))
        conflict_reason = extract_text(pick_field(row, "conflictReason"))
        record_id = str(row.get("_recordId") or "")

        display_title = title or f"（未命名 · {live_type or '直播'}）"
        stable_key = record_id or f"{date_str}|{start}|{end}|{room}|{display_title}|{idx}"
        uid = hashlib.md5(stable_key.encode("utf-8")).hexdigest()[:12]

        anomalies: List[str] = []
        if not date_str:
            anomalies.append("缺少日期")
        if not title:
            anomalies.append("未填直播主题")
        if not room:
            anomalies.append("未分配直播间")
        if start and end and start == end:
            anomalies.append("开始与结束时间相同")

        conflicts: List[str] = []
        if conflict_flag == "冲突":
            conflicts.append(conflict_reason or "原表格标记冲突")

        events.append(
            {
                "id": uid,
                "recordId": record_id,
                "title": title,
                "displayTitle": display_title,
                "date": date_str,
                "type": live_type,
                "start": start,
                "end": end,
                "videoAccount": video_acc,
                "appAccount": app_acc,
                "speaker": speaker,
                "host": host,
                "inviteStatus": invite_status,
                "ops": ops,
                "room": room,
                "detail": detail,
                "tableConflict": conflict_flag == "冲突",
                "conflictReasons": conflicts,
                "anomalyReasons": anomalies,
            }
        )

    # Dynamic conflict detection: same date + overlapping [start, end) on same room or same videoAccount
    def check_overlap(field_name: str, label: str) -> None:
        buckets: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
        for ev in events:
            val = ev[field_name]
            if not ev["date"] or not val:
                continue
            # Ignore legacy tag suffix when checking actual account collision
            norm_val = val.replace("(旧)", "")
            buckets.setdefault((ev["date"], norm_val), []).append(ev)

        for group in buckets.values():
            if len(group) < 2:
                continue
            for i in range(len(group)):
                for j in range(i + 1, len(group)):
                    a, b = group[i], group[j]
                    a_s, a_e = time_to_mins(a["start"]), time_to_mins(a["end"])
                    b_s, b_e = time_to_mins(b["start"]), time_to_mins(b["end"])
                    if a_s is None or b_s is None:
                        continue
                    a_end = a_e if (a_e is not None and a_e > a_s) else a_s + 60
                    b_end = b_e if (b_e is not None and b_e > b_s) else b_s + 60
                    if a_s < b_end and b_s < a_end:
                        msg_a = f"与【{b['displayTitle']}】({b['start']}-{b['end']}) 时段重叠（相同{label}：{a[field_name]}）"
                        msg_b = f"与【{a['displayTitle']}】({a['start']}-{a['end']}) 时段重叠（相同{label}：{b[field_name]}）"
                        if not any(b["displayTitle"] in r and label in r for r in a["conflictReasons"]):
                            a["conflictReasons"].append(msg_a)
                        if not any(a["displayTitle"] in r and label in r for r in b["conflictReasons"]):
                            b["conflictReasons"].append(msg_b)

    check_overlap("room", "直播间")
    check_overlap("videoAccount", "视频号账号")
    check_overlap("host", "主持人")

    for ev in events:
        ev["isConflict"] = bool(ev["conflictReasons"])
        ev["hasAnomaly"] = bool(ev["anomalyReasons"]) or ev["isConflict"]

    events.sort(key=lambda e: (e["date"] or "9999-99-99", e["start"] or "99:99", e["room"], e["displayTitle"]))
    return events


def escape_ics(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def fold_ics_line(line: str) -> str:
    """Fold RFC 5545 lines longer than 75 octets."""
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return line
    chunks: List[str] = []
    cur = ""
    limit = 75
    for ch in line:
        if len((cur + ch).encode("utf-8")) > limit:
            chunks.append(cur)
            cur = " " + ch
            limit = 75
        else:
            cur += ch
    if cur:
        chunks.append(cur)
    return "\r\n".join(chunks)


def generate_ics(events: List[Dict[str, Any]], cal_name: str = "直播排期日历") -> str:
    now_utc = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//DingTalk Livestream Calendar//Auto Sync//CN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape_ics(cal_name)}",
        "X-WR-TIMEZONE:Asia/Shanghai",
        "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
        "X-PUBLISHED-TTL:PT30M",
        "BEGIN:VTIMEZONE",
        "TZID:Asia/Shanghai",
        "BEGIN:STANDARD",
        "DTSTART:19700101T000000",
        "TZOFFSETFROM:+0800",
        "TZOFFSETTO:+0800",
        "TZNAME:CST",
        "END:STANDARD",
        "END:VTIMEZONE",
    ]

    for ev in events:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", ev["date"]):
            continue
        date_compact = ev["date"].replace("-", "")
        start_hm = ev["start"] or "09:00"
        end_hm = ev["end"] or start_hm
        s_mins = time_to_mins(start_hm) or 540
        e_mins = time_to_mins(end_hm)
        if e_mins is None or e_mins <= s_mins:
            e_mins = min(s_mins + 60, 23 * 60 + 59)
            end_hm = f"{e_mins // 60:02d}:{e_mins % 60:02d}"

        dt_start = f"{date_compact}T{start_hm.replace(':', '')}00"
        dt_end = f"{date_compact}T{end_hm.replace(':', '')}00"
        room_tag = ROOM_SHORT_MAP.get(ev["room"], ev["room"] or "待定")
        prefix = "[冲突] " if ev["isConflict"] else ""
        summary = f"{prefix}[{room_tag}] {ev['displayTitle']}"

        accounts = " / ".join(
            [x for x in [f"视频号:{ev['videoAccount']}" if ev["videoAccount"] else "", f"APP:{ev['appAccount']}" if ev["appAccount"] else ""] if x]
        )
        desc_parts = [
            f"直播类型：{ev['type'] or '未分类'}",
            f"直播间：{ev['room'] or '未分配'}",
            f"讲师：{ev['speaker'] or '待定'} | 主持人：{ev['host'] or '待定'} | 运营：{ev['ops'] or '待定'}",
            f"老师邀约状态：{ev['inviteStatus'] or '未填写'}",
            f"开播账号：{accounts or '待定'}",
        ]
        if ev["conflictReasons"]:
            desc_parts.append("冲突提醒：" + "；".join(ev["conflictReasons"]))
        if ev["anomalyReasons"]:
            desc_parts.append("数据提醒：" + "；".join(ev["anomalyReasons"]))

        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:dingtalk-live-{ev['id']}@schedule",
                f"DTSTAMP:{now_utc}",
                f"DTSTART;TZID=Asia/Shanghai:{dt_start}",
                f"DTEND;TZID=Asia/Shanghai:{dt_end}",
                fold_ics_line(f"SUMMARY:{escape_ics(summary)}"),
                fold_ics_line(f"LOCATION:{escape_ics(ev['room'] or '待定')}"),
                fold_ics_line(f"DESCRIPTION:{escape_ics(chr(10).join(desc_parts))}"),
                f"CATEGORIES:{escape_ics(ev['type'] or '直播')}",
                "END:VEVENT",
            ]
        )

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def compute_content_hash(events: List[Dict[str, Any]], source_mode: str, source_url: str) -> str:
    canonical = json.dumps(
        {"sourceMode": source_mode, "sourceUrl": source_url, "events": events},
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def run_crypto_helper(mode: str, text: str, password: str) -> str:
    helper = Path(__file__).resolve().parent / "encrypt_aes_gcm.mjs"
    env = dict(os.environ)
    env["CALENDAR_PASSWORD"] = password
    proc = subprocess.run(
        ["node", str(helper), mode],
        input=text,
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"AES-GCM {mode} 失败: {proc.stderr.strip()}")
    return proc.stdout


def write_outputs(
    events: List[Dict[str, Any]],
    out_dir: Path,
    source_mode: str,
    source_url: str,
    password: str = "",
    force: bool = False,
) -> bool:
    """Write encrypted or plaintext calendar data. Returns True if files were updated."""
    data_dir = out_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    json_path = data_dir / "schedule.json"
    js_path = data_dir / "schedule-data.js"
    enc_path = data_dir / "schedule.enc.json"
    ics_path = out_dir / "calendar.ics"

    content_hash = compute_content_hash(events, source_mode, source_url)

    if password:
        # Remove any leftover plaintext artifacts so secrets never leak to public Pages
        for stale in (json_path, js_path, ics_path):
            if stale.exists():
                stale.unlink()

        if not force and enc_path.exists():
            try:
                prev_plain = run_crypto_helper("decrypt", enc_path.read_text(encoding="utf-8"), password)
                prev = json.loads(prev_plain)
                if (prev.get("meta") or {}).get("contentHash") == content_hash:
                    return False
            except Exception:
                # Password changed or file corrupted -> re-encrypt
                pass

        synced_at = dt.datetime.now(SHANGHAI_TZ).strftime("%Y-%m-%d %H:%M:%S")
        payload = {
            "meta": {
                "syncedAt": synced_at,
                "timezone": "Asia/Shanghai",
                "sourceMode": source_mode,
                "sourceUrl": source_url,
                "contentHash": content_hash,
                "encrypted": True,
                "total": len(events),
                "conflicts": sum(1 for e in events if e["isConflict"]),
                "anomalies": sum(1 for e in events if e["hasAnomaly"]),
            },
            "events": events,
        }
        plain_json = json.dumps(payload, ensure_ascii=False)
        encrypted_json = run_crypto_helper("encrypt", plain_json, password)
        enc_path.write_text(encrypted_json, encoding="utf-8")
        return True

    # Plaintext mode (when CALENDAR_PASSWORD is not configured)
    if enc_path.exists():
        enc_path.unlink()

    if not force and json_path.exists() and js_path.exists() and ics_path.exists():
        try:
            prev = json.loads(json_path.read_text(encoding="utf-8"))
            if (prev.get("meta") or {}).get("contentHash") == content_hash:
                return False
        except Exception:
            pass

    synced_at = dt.datetime.now(SHANGHAI_TZ).strftime("%Y-%m-%d %H:%M:%S")
    payload = {
        "meta": {
            "syncedAt": synced_at,
            "timezone": "Asia/Shanghai",
            "sourceMode": source_mode,
            "sourceUrl": source_url,
            "contentHash": content_hash,
            "encrypted": False,
            "total": len(events),
            "conflicts": sum(1 for e in events if e["isConflict"]),
            "anomalies": sum(1 for e in events if e["hasAnomaly"]),
        },
        "events": events,
    }

    json_text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    json_path.write_text(json_text, encoding="utf-8")
    js_path.write_text(f"window.__SCHEDULE_DATA__ = {json_text};\n", encoding="utf-8")

    ics_text = generate_ics(events)
    ics_path.write_text(ics_text, encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="同步钉钉 AI 表格或本地 CSV 到日历 JSON（支持 AES-256-GCM 加密）与 ICS")
    parser.add_argument("--csv", type=Path, default=None, help="强制从指定 CSV 文件生成（跳过钉钉 API）")
    parser.add_argument("--out", type=Path, default=Path("docs"), help="输出目录（默认 docs）")
    parser.add_argument("--password", type=str, default=None, help="启用 AES-256-GCM 加密的访问密码（默认读取 CALENDAR_PASSWORD）")
    parser.add_argument("--require-encryption", action="store_true", help="强制要求加密密码，防止意外明文发布")
    parser.add_argument("--force", action="store_true", help="即使内容无变化也强制重新写入文件")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv(repo_root / ".env")

    out_dir = args.out if args.out.is_absolute() else (repo_root / args.out)
    source_url = os.getenv("DINGTALK_SOURCE_URL", DEFAULT_SOURCE_URL)
    password = (args.password if args.password is not None else os.getenv("CALENDAR_PASSWORD", "")).strip()

    if args.require_encryption and not password:
        print("[error] 已开启 --require-encryption，但未设置 CALENDAR_PASSWORD，已中止以防明文泄露", file=sys.stderr)
        return 1

    app_key = os.getenv("DINGTALK_APP_KEY", "").strip()
    app_secret = os.getenv("DINGTALK_APP_SECRET", "").strip()
    operator_id = os.getenv("DINGTALK_OPERATOR_ID", "").strip()
    user_id = os.getenv("DINGTALK_USER_ID", "").strip()
    mobile = os.getenv("DINGTALK_MOBILE", "").strip()
    base_id = os.getenv("DINGTALK_BASE_ID", DEFAULT_BASE_ID).strip() or DEFAULT_BASE_ID
    sheet_id = os.getenv("DINGTALK_SHEET_ID", DEFAULT_SHEET_ID).strip() or DEFAULT_SHEET_ID

    use_api = args.csv is None and bool(app_key and app_secret and (operator_id or user_id or mobile))

    if use_api:
        print(f"[info] 正在连接钉钉 AI 表格 API (baseId={base_id}, sheetId={sheet_id})...")
        token = get_dingtalk_access_token(app_key, app_secret)
        if not operator_id and user_id:
            print(f"[info] 正在通过 userid({user_id}) 查询操作人 unionId...")
            operator_id = resolve_union_id_by_userid(token, user_id)
        elif not operator_id and mobile:
            print(f"[info] 正在通过手机号查询操作人 unionId...")
            operator_id = resolve_union_id_by_mobile(token, mobile)
        raw_rows = fetch_dingtalk_records(token, base_id, sheet_id, operator_id)
        source_mode = "dingtalk-api"
        print(f"[info] 成功从钉钉拉取 {len(raw_rows)} 条原始记录")
    else:
        csv_path = args.csv if args.csv else (repo_root / "data" / "schedule.csv")
        if not csv_path.exists():
            if (out_dir / "data" / "schedule.enc.json").exists():
                print("[info] 未配置钉钉 API 且无本地 CSV，保留现有加密排期文件直接部署")
                return 0
            print(f"[error] 未配置钉钉 API 密钥，且未找到回退 CSV 文件: {csv_path}", file=sys.stderr)
            return 1
        print(f"[info] 使用 CSV 数据源生成日历: {csv_path}")
        raw_rows = load_csv_rows(csv_path)
        source_mode = "csv-fallback" if args.csv is None else "csv-manual"

    events = build_events(raw_rows)
    changed = write_outputs(
        events,
        out_dir,
        source_mode=source_mode,
        source_url=source_url,
        password=password,
        force=args.force,
    )

    conflicts = sum(1 for e in events if e["isConflict"])
    undated = sum(1 for e in events if not e["date"])
    target_desc = f"{out_dir / 'data' / 'schedule.enc.json'}（AES-256-GCM 加密）" if password else f"{out_dir / 'data' / 'schedule.json'} 与 {out_dir / 'calendar.ics'}"
    if changed:
        print(f"[ok] 已生成 {target_desc} | 共 {len(events)} 场直播，冲突 {conflicts} 场，缺日期 {undated} 场")
    else:
        print(f"[ok] 排期内容无变化，跳过写入（避免无效 commit）| 共 {len(events)} 场直播，冲突 {conflicts} 场，缺日期 {undated} 场")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
